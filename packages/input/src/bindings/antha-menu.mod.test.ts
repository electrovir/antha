import {AnthaEngine} from '@antha/engine';
import {LocalPlayerPosition} from '@antha/util';
import {assert, assertWrap} from '@augment-vir/assert';
import {awaitedBlockingMap, typedObjectFromEntries} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {
    NavAction,
    NavController,
    NavDirection,
    NavEntry,
    NavValue,
    type CurrentNavEntry,
    type NavigationInputs,
} from 'device-navigation';
import {pushAnthaMenuState} from './antha-menu-state.js';
import {createAnthaMenuMod, MenuNavBinding, type AnthaMenuModState} from './antha-menu.mod.js';
import {type ActiveBinding, type PlayersActiveBindings} from './player-bindings.js';

type RecordingNavController = NavController & {
    calls: string[];
    navigationInputs: NavigationInputs[];
};

class TestNavEntry extends NavEntry {
    public setActiveForTest() {
        this.setNavValue(NavValue.Active);
    }
}

function createActiveBinding({
    holdDurationMs = 0,
    lastActDurationMs = 0,
    actCount = 0,
    value = 1,
}: Readonly<
    Partial<{
        holdDurationMs: number;
        lastActDurationMs: number;
        actCount: number;
        value: number;
    }>
> = {}): ActiveBinding {
    return {
        holdDuration: {
            milliseconds: holdDurationMs,
        },
        rawInputs: [],
        value,
        actCount,
        lastActDuration: {
            milliseconds: lastActDurationMs,
        },
    };
}

function createRecordingNavController() {
    const navController = new NavController(
        document.createElement('div'),
    ) satisfies NavController as RecordingNavController;

    navController.calls = [];
    navController.navigationInputs = [];
    navController.enterInto = () => {
        navController.calls.push('enter');

        return {
            success: false,
            direction: undefined,
            navAction: NavAction.Enter,
            reason: 'test nav tree is empty',
        };
    };
    navController.exitOutOf = () => {
        navController.calls.push('exit');

        return {
            success: false,
            direction: undefined,
            navAction: NavAction.Exit,
            reason: 'test nav tree is empty',
        };
    };
    navController.deactivate = () => {
        navController.calls.push('deactivate');

        return {
            success: false,
            direction: undefined,
            navAction: NavAction.Activate,
            reason: 'test nav tree is empty',
        };
    };
    navController.navigatePibling = (navigationInputs) => {
        const {direction} = navigationInputs;
        navController.calls.push(`pibling-${direction}`);
        navController.navigationInputs.push(navigationInputs);

        return {
            success: false,
            direction,
            navAction: NavAction.Pibling,
            reason: 'test nav tree is empty',
        };
    };
    navController.navigate = (navigationInputs) => {
        const {direction} = navigationInputs;
        navController.calls.push(`navigate-${direction}`);
        navController.navigationInputs.push(navigationInputs);

        return {
            success: false,
            direction,
            navAction: NavAction.Navigate,
            reason: 'test nav tree is empty',
        };
    };

    return navController;
}

async function runMenuNav({
    activeBindings,
    allowedPlayerMenuNavigation,
    blockPerpendicularNavigation = false,
    navController = createRecordingNavController(),
    isInMenu = true,
}: Readonly<{
    activeBindings?: PlayersActiveBindings | undefined;
    allowedPlayerMenuNavigation?: AnthaMenuModState['allowedPlayerMenuNavigation'];
    blockPerpendicularNavigation?: boolean | undefined;
    navController?: RecordingNavController | undefined;
    isInMenu?: boolean | undefined;
}>) {
    const engine = new AnthaEngine<AnthaMenuModState>({
        initState: {
            isInMenu,
            navController,
            allowedPlayerMenuNavigation,
            ...(activeBindings && {
                activeBindings,
            }),
            menuNavOptions: {
                repeatThreshold: {
                    milliseconds: 50,
                },
                repeatInterval: {
                    milliseconds: 10,
                },
                minimumDirectionalInputValue: 0.8,
                allowWrapping: false,
                blockPerpendicularNavigation,
            },
        },
        mods: [
            createAnthaMenuMod({
                repeatThreshold: {
                    milliseconds: 50,
                },
                repeatInterval: {
                    milliseconds: 10,
                },
                minimumDirectionalInputValue: 0.8,
                allowWrapping: false,
                blockPerpendicularNavigation,
            }),
        ],
    });

    await engine.runSingleTick();

    return {
        engine,
        navController,
    };
}

describe(createAnthaMenuMod.name, () => {
    it('allows menu navigation only for explicitly allowed players', async () => {
        const navController = createRecordingNavController();
        const allowedBinding = createActiveBinding();
        const deniedBinding = createActiveBinding();

        await runMenuNav({
            activeBindings: {
                [LocalPlayerPosition.One]: {
                    [MenuNavBinding.MenuRight]: allowedBinding,
                },
                [LocalPlayerPosition.Two]: {
                    [MenuNavBinding.MenuLeft]: deniedBinding,
                },
            },
            allowedPlayerMenuNavigation: {
                [LocalPlayerPosition.One]: true,
            },
            navController,
        });

        assert.deepEquals(
            {
                calls: navController.calls,
                allowedBinding,
                deniedBinding,
            },
            {
                calls: [
                    `navigate-${NavDirection.Right}`,
                ],
                allowedBinding: createActiveBinding({
                    actCount: 1,
                    lastActDurationMs: 0,
                }),
                deniedBinding: createActiveBinding(),
            },
        );
    });

    it('does not consume inactive menu controls for denied players', async () => {
        const navController = createRecordingNavController();
        const deniedEnterBinding = createActiveBinding({
            holdDurationMs: 120,
        });
        const {engine} = await runMenuNav({
            activeBindings: {
                [LocalPlayerPosition.Two]: {
                    [MenuNavBinding.MenuEnter]: deniedEnterBinding,
                },
            },
            allowedPlayerMenuNavigation: {
                [LocalPlayerPosition.One]: true,
            },
            isInMenu: false,
            navController,
        });

        engine.state.isInMenu = true;

        await engine.runSingleTick();

        assert.deepEquals(
            {
                calls: navController.calls,
                deniedEnterBinding,
            },
            {
                calls: [],
                deniedEnterBinding: createActiveBinding({
                    holdDurationMs: 120,
                }),
            },
        );
    });

    it('forwards perpendicular navigation settings', async () => {
        const navController = createRecordingNavController();

        const {engine} = await runMenuNav({
            activeBindings: {
                [LocalPlayerPosition.One]: {
                    [MenuNavBinding.MenuRight]: createActiveBinding(),
                },
            },
            blockPerpendicularNavigation: true,
            navController,
        });

        assert.deepEquals(
            {
                blockPerpendicularNavigation:
                    engine.state.menuNavOptions?.blockPerpendicularNavigation,
                navigationInputs: navController.navigationInputs,
            },
            {
                blockPerpendicularNavigation: true,
                navigationInputs: [
                    {
                        allowWrapping: false,
                        blockPerpendicularNavigation: true,
                        direction: NavDirection.Right,
                    },
                ],
            },
        );
    });

    it('fires a new active binding regardless of sampled hold duration', async () => {
        const mod = createAnthaMenuMod({
            repeatThreshold: {
                milliseconds: 500,
            },
        });

        const engine = new AnthaEngine<AnthaMenuModState>({
            mods: [
                mod,
            ],
        });

        engine.state.isInMenu = true;
        engine.state.activeBindings = {
            [LocalPlayerPosition.One]: {
                [MenuNavBinding.MenuRight]: {
                    holdDuration: {
                        milliseconds: 120,
                    },
                    rawInputs: [],
                    value: 1,
                    actCount: 0,
                    lastActDuration: {
                        milliseconds: 0,
                    },
                },
            },
        };

        await engine.runSingleTick();

        const activeBinding = assertWrap.isDefined(
            engine.state.activeBindings[LocalPlayerPosition.One]?.[MenuNavBinding.MenuRight],
        );

        assert.deepEquals(activeBinding, {
            holdDuration: {
                milliseconds: 120,
            },
            rawInputs: [],
            value: 1,
            actCount: 1,
            lastActDuration: {
                milliseconds: 120,
            },
        });
    });

    it('recovers when the current nav entry was removed from the nav tree', async () => {
        const hostElement = document.createElement('div');
        const navController = new NavController(hostElement, {
            alwaysRequireFocused: true,
        });
        const staleNavEntry = new NavEntry(document.createElement('button'), navController, {});
        const removeDisconnectListenerCalls: true[] = [];
        const currentNavEntry: CurrentNavEntry = {
            entry: staleNavEntry,
            navAction: NavAction.Focus,
            position: {
                ancestorChain: [],
                node: {
                    root: true,
                    children: [],
                },
                nodeCoords: {
                    x: 0,
                    y: 0,
                },
            },
            removeDisconnectListener() {
                removeDisconnectListenerCalls.push(true);
            },
        };

        navController.currentNavEntry = currentNavEntry;

        const engine = new AnthaEngine<AnthaMenuModState>({
            hostElement,
            initState: {
                isInMenu: true,
                navController,
                activeBindings: {
                    [LocalPlayerPosition.One]: {
                        [MenuNavBinding.MenuRight]: {
                            holdDuration: {
                                milliseconds: 0,
                            },
                            rawInputs: [],
                            value: 1,
                            actCount: 0,
                            lastActDuration: {
                                milliseconds: 0,
                            },
                        },
                    },
                },
            },
            mods: [
                createAnthaMenuMod(),
            ],
        });

        await engine.runSingleTick();

        assert.isUndefined(navController.currentNavEntry);
        assert.isLengthExactly(removeDisconnectListenerCalls, 1);
    });

    it('does nothing when menu nav is inactive', async () => {
        const navController = createRecordingNavController();

        await runMenuNav({
            isInMenu: false,
            navController,
            activeBindings: {
                [LocalPlayerPosition.One]: {
                    [MenuNavBinding.MenuEnter]: createActiveBinding(),
                },
            },
        });

        assert.deepEquals(navController.calls, []);
    });

    it('does nothing before bindings are available', async () => {
        const navController = createRecordingNavController();

        await runMenuNav({
            navController,
        });

        assert.deepEquals(navController.calls, []);
    });

    it('requires held enter and exit bindings to be released before opening a menu', async () => {
        const navController = createRecordingNavController();
        const enterBinding = createActiveBinding({
            holdDurationMs: 120,
        });
        const exitBinding = createActiveBinding({
            holdDurationMs: 120,
        });
        const {engine} = await runMenuNav({
            isInMenu: false,
            navController,
            activeBindings: {
                [LocalPlayerPosition.One]: {
                    [MenuNavBinding.MenuEnter]: enterBinding,
                    [MenuNavBinding.MenuExit]: exitBinding,
                },
            },
        });

        assert.deepEquals(
            {
                enterBinding,
                exitBinding,
            },
            {
                enterBinding: createActiveBinding({
                    actCount: 1,
                    holdDurationMs: 120,
                    lastActDurationMs: 120,
                }),
                exitBinding: createActiveBinding({
                    actCount: 1,
                    holdDurationMs: 120,
                    lastActDurationMs: 120,
                }),
            },
        );

        engine.state.isInMenu = true;

        await engine.runSingleTick();

        assert.deepEquals(navController.calls, []);
    });

    it('ignores non-menu binding names', async () => {
        const navController = createRecordingNavController();

        await runMenuNav({
            navController,
            activeBindings: {
                [LocalPlayerPosition.One]: {
                    other: createActiveBinding(),
                },
            },
        });

        assert.deepEquals(navController.calls, []);
    });

    it('requires the default minimum directional input value before navigating', async () => {
        const navController = createRecordingNavController();
        const engine = new AnthaEngine<AnthaMenuModState>({
            initState: {
                activeBindings: {
                    [LocalPlayerPosition.One]: {
                        [MenuNavBinding.MenuRight]: createActiveBinding({
                            value: 0.79,
                        }),
                    },
                },
                isInMenu: true,
                navController,
            },
            mods: [
                createAnthaMenuMod(),
            ],
        });

        await engine.runSingleTick();

        assert.deepEquals(navController.calls, []);
    });

    it('waits longer before repeating directional navigation by default', async () => {
        const navController = createRecordingNavController();
        const engine = new AnthaEngine<AnthaMenuModState>({
            initState: {
                activeBindings: {
                    [LocalPlayerPosition.One]: {
                        [MenuNavBinding.MenuRight]: createActiveBinding({
                            actCount: 1,
                            holdDurationMs: 600,
                        }),
                    },
                },
                isInMenu: true,
                navController,
            },
            mods: [
                createAnthaMenuMod(),
            ],
        });

        await engine.runSingleTick();

        assert.deepEquals(navController.calls, []);
    });

    it('waits for repeat threshold before acting again', async () => {
        const navController = createRecordingNavController();
        const activeBinding = createActiveBinding({
            holdDurationMs: 40,
            actCount: 1,
        });

        await runMenuNav({
            navController,
            activeBindings: {
                [LocalPlayerPosition.One]: {
                    [MenuNavBinding.MenuRight]: activeBinding,
                },
            },
        });

        assert.deepEquals(
            {
                calls: navController.calls,
                activeBinding,
            },
            {
                calls: [],
                activeBinding: createActiveBinding({
                    holdDurationMs: 40,
                    actCount: 1,
                }),
            },
        );
    });

    it('repeats after threshold and interval have passed', async () => {
        const navController = createRecordingNavController();
        const activeBinding = createActiveBinding({
            holdDurationMs: 120,
            lastActDurationMs: 70,
            actCount: 1,
        });

        await runMenuNav({
            navController,
            activeBindings: {
                [LocalPlayerPosition.One]: {
                    [MenuNavBinding.MenuRight]: activeBinding,
                },
            },
        });

        assert.deepEquals(
            {
                calls: navController.calls,
                activeBinding,
            },
            {
                calls: [
                    `navigate-${NavDirection.Right}`,
                ],
                activeBinding: createActiveBinding({
                    holdDurationMs: 120,
                    lastActDurationMs: 120,
                    actCount: 2,
                }),
            },
        );
    });

    it('does not repeat enter or exit bindings', async () => {
        const enterNavController = createRecordingNavController();
        const exitNavController = createRecordingNavController();
        const enterBinding = createActiveBinding({
            holdDurationMs: 120,
            lastActDurationMs: 70,
            actCount: 1,
        });
        const exitBinding = createActiveBinding({
            holdDurationMs: 120,
            lastActDurationMs: 70,
            actCount: 1,
        });

        await runMenuNav({
            navController: enterNavController,
            activeBindings: {
                [LocalPlayerPosition.One]: {
                    [MenuNavBinding.MenuEnter]: enterBinding,
                },
            },
        });
        await runMenuNav({
            navController: exitNavController,
            activeBindings: {
                [LocalPlayerPosition.One]: {
                    [MenuNavBinding.MenuExit]: exitBinding,
                },
            },
        });

        assert.deepEquals(
            {
                enter: {
                    calls: enterNavController.calls,
                    binding: enterBinding,
                },
                exit: {
                    calls: exitNavController.calls,
                    binding: exitBinding,
                },
            },
            {
                enter: {
                    calls: [],
                    binding: createActiveBinding({
                        holdDurationMs: 120,
                        lastActDurationMs: 70,
                        actCount: 1,
                    }),
                },
                exit: {
                    calls: [],
                    binding: createActiveBinding({
                        holdDurationMs: 120,
                        lastActDurationMs: 70,
                        actCount: 1,
                    }),
                },
            },
        );
    });

    it('dispatches enter and exit bindings first', async () => {
        const enterNavController = createRecordingNavController();
        const exitNavController = createRecordingNavController();

        await runMenuNav({
            navController: enterNavController,
            activeBindings: {
                [LocalPlayerPosition.One]: {
                    [MenuNavBinding.MenuEnter]: createActiveBinding(),
                    [MenuNavBinding.MenuRight]: createActiveBinding(),
                },
            },
        });
        await runMenuNav({
            navController: exitNavController,
            activeBindings: {
                [LocalPlayerPosition.One]: {
                    [MenuNavBinding.MenuExit]: createActiveBinding(),
                    [MenuNavBinding.MenuRight]: createActiveBinding(),
                },
            },
        });

        assert.deepEquals(
            {
                enter: enterNavController.calls,
                exit: exitNavController.calls,
            },
            {
                enter: [
                    'enter',
                ],
                exit: [
                    'exit',
                ],
            },
        );
    });

    it('deactivates active nav entries when enter is released', async () => {
        const navController = createRecordingNavController();
        const activeNavEntry = new TestNavEntry(
            document.createElement('button'),
            navController,
            {},
        );
        activeNavEntry.setActiveForTest();
        navController.currentNavEntry = {
            entry: activeNavEntry,
            navAction: NavAction.Activate,
            position: {
                ancestorChain: [],
                node: {
                    root: true,
                    children: [],
                },
                nodeCoords: {
                    x: 0,
                    y: 0,
                },
            },
            removeDisconnectListener() {},
        };

        await runMenuNav({
            navController,
            activeBindings: {
                [LocalPlayerPosition.One]: {
                    [MenuNavBinding.MenuRight]: createActiveBinding(),
                },
            },
        });

        assert.deepEquals(navController.calls, [
            'deactivate',
            `navigate-${NavDirection.Right}`,
        ]);
    });

    it('dispatches section navigation bindings', async () => {
        const nextNavController = createRecordingNavController();
        const previousNavController = createRecordingNavController();
        const bothNavController = createRecordingNavController();

        await runMenuNav({
            navController: nextNavController,
            activeBindings: {
                [LocalPlayerPosition.One]: {
                    [MenuNavBinding.MenuSectionNext]: createActiveBinding(),
                },
            },
        });
        await runMenuNav({
            navController: previousNavController,
            activeBindings: {
                [LocalPlayerPosition.One]: {
                    [MenuNavBinding.MenuSectionPrevious]: createActiveBinding(),
                },
            },
        });
        await runMenuNav({
            navController: bothNavController,
            activeBindings: {
                [LocalPlayerPosition.One]: {
                    [MenuNavBinding.MenuSectionNext]: createActiveBinding(),
                    [MenuNavBinding.MenuSectionPrevious]: createActiveBinding(),
                },
            },
        });

        assert.deepEquals(
            {
                next: nextNavController.calls,
                previous: previousNavController.calls,
                both: bothNavController.calls,
            },
            {
                next: [
                    `pibling-${NavDirection.Right}`,
                ],
                previous: [
                    `pibling-${NavDirection.Left}`,
                ],
                both: [],
            },
        );
    });

    it('dispatches vertical and horizontal navigation bindings', async () => {
        const upRightNavController = createRecordingNavController();
        const downLeftNavController = createRecordingNavController();
        const opposedNavController = createRecordingNavController();

        await runMenuNav({
            navController: upRightNavController,
            activeBindings: {
                [LocalPlayerPosition.One]: {
                    [MenuNavBinding.MenuUp]: createActiveBinding(),
                    [MenuNavBinding.MenuRight]: createActiveBinding(),
                },
            },
        });
        await runMenuNav({
            navController: downLeftNavController,
            activeBindings: {
                [LocalPlayerPosition.One]: {
                    [MenuNavBinding.MenuDown]: createActiveBinding(),
                    [MenuNavBinding.MenuLeft]: createActiveBinding(),
                },
            },
        });
        await runMenuNav({
            navController: opposedNavController,
            activeBindings: {
                [LocalPlayerPosition.One]: {
                    [MenuNavBinding.MenuUp]: createActiveBinding(),
                    [MenuNavBinding.MenuDown]: createActiveBinding(),
                    [MenuNavBinding.MenuLeft]: createActiveBinding(),
                    [MenuNavBinding.MenuRight]: createActiveBinding(),
                },
            },
        });

        assert.deepEquals(
            {
                upRight: upRightNavController.calls,
                downLeft: downLeftNavController.calls,
                opposed: opposedNavController.calls,
            },
            {
                upRight: [
                    `navigate-${NavDirection.Up}`,
                    `navigate-${NavDirection.Right}`,
                ],
                downLeft: [
                    `navigate-${NavDirection.Down}`,
                    `navigate-${NavDirection.Left}`,
                ],
                opposed: [],
            },
        );
    });
});

enum TestMenuKey {
    Options = 'options',
    Pause = 'pause',
}

describe(`${createAnthaMenuMod.name} menu state`, () => {
    it('consumes pause/back inputs and switches menu state and input consumers', async () => {
        const engine = new AnthaEngine<AnthaMenuModState<TestMenuKey>>({
            initState: {
                navController: createRecordingNavController(),
                activeBindings: {
                    [LocalPlayerPosition.One]: {
                        [MenuNavBinding.OpenPauseMenu]: createActiveBinding({
                            holdDurationMs: 40,
                        }),
                    },
                },
                allowedPlayerMenuNavigation: undefined,
                isInMenu: false,
                menuState: undefined,
                rawInputConsumer: 'game',
            },
            mods: [
                createAnthaMenuMod<TestMenuKey>({
                    menuState: {
                        pauseMenuKey: TestMenuKey.Pause,
                        menuInputConsumerName: 'menu',
                    },
                }),
            ],
        });

        await engine.runSingleTick();

        assert.deepEquals(
            {
                activeMenu: engine.state.menuState?.menuHistory.at(-1),
                isInMenu: engine.state.isInMenu,
                lastActDuration:
                    engine.state.activeBindings?.[LocalPlayerPosition.One]?.[
                        MenuNavBinding.OpenPauseMenu
                    ]?.lastActDuration,
                openedBy: engine.state.menuState?.openedBy,
                openPauseMenuActCount:
                    engine.state.activeBindings?.[LocalPlayerPosition.One]?.[
                        MenuNavBinding.OpenPauseMenu
                    ]?.actCount,
                rawInputConsumer: engine.state.rawInputConsumer,
            },
            {
                activeMenu: TestMenuKey.Pause,
                isInMenu: true,
                lastActDuration: {
                    milliseconds: 40,
                },
                openedBy: {
                    activeBinding: {
                        ...createActiveBinding({
                            holdDurationMs: 40,
                        }),
                        actCount: 1,
                        lastActDuration: {
                            milliseconds: 40,
                        },
                    },
                    playerPosition: LocalPlayerPosition.One,
                },
                openPauseMenuActCount: 1,
                rawInputConsumer: 'menu',
            },
        );

        engine.state.menuState = {
            menuHistory: [
                TestMenuKey.Pause,
                TestMenuKey.Options,
            ],
            openedBy: undefined,
        };
        engine.state.activeBindings = {
            [LocalPlayerPosition.One]: {
                [MenuNavBinding.MenuExit]: createActiveBinding({
                    holdDurationMs: 40,
                }),
            },
        };

        await engine.runSingleTick();

        assert.deepEquals(
            {
                isInMenu: engine.state.isInMenu,
                menuExitActCount:
                    engine.state.activeBindings[LocalPlayerPosition.One]?.[MenuNavBinding.MenuExit]
                        ?.actCount,
                menuState: engine.state.menuState,
                rawInputConsumer: engine.state.rawInputConsumer,
            },
            {
                isInMenu: true,
                menuExitActCount: 1,
                menuState: {
                    menuHistory: [
                        TestMenuKey.Pause,
                    ],
                    openedBy: undefined,
                },
                rawInputConsumer: 'menu',
            },
        );

        engine.state.menuState = {
            menuHistory: [
                TestMenuKey.Pause,
            ],
            openedBy: undefined,
        };
        engine.state.activeBindings = {
            [LocalPlayerPosition.One]: {
                [MenuNavBinding.MenuExit]: createActiveBinding({
                    holdDurationMs: 40,
                }),
            },
        };

        await engine.runSingleTick();

        /** The earlier assignment narrows `menuState`, so its `undefined` result is checked apart. */
        assert.isUndefined(engine.state.menuState);
        assert.deepEquals(
            {
                isInMenu: engine.state.isInMenu,
                rawInputConsumer: engine.state.rawInputConsumer,
            },
            {
                isInMenu: false,
                rawInputConsumer: 'game',
            },
        );

        await engine.reset();
    });

    it('does not transition with missing or idle player bindings', async () => {
        const engine = new AnthaEngine<AnthaMenuModState<TestMenuKey>>({
            initState: {
                navController: createRecordingNavController(),
                allowedPlayerMenuNavigation: undefined,
                isInMenu: false,
                menuState: undefined,
                rawInputConsumer: 'game',
            },
            mods: [
                createAnthaMenuMod<TestMenuKey>({
                    menuState: {
                        pauseMenuKey: TestMenuKey.Pause,
                        menuInputConsumerName: 'menu',
                    },
                }),
            ],
        });

        await engine.runSingleTick();

        assert.deepEquals(
            {
                activeMenu: engine.state.menuState?.menuHistory.at(-1),
                isInMenu: engine.state.isInMenu,
                rawInputConsumer: engine.state.rawInputConsumer,
            },
            {
                activeMenu: undefined,
                isInMenu: false,
                rawInputConsumer: 'game',
            },
        );

        engine.state.activeBindings = {
            [LocalPlayerPosition.One]: {},
        };
        await engine.runSingleTick();

        assert.deepEquals(
            {
                activeMenu: engine.state.menuState?.menuHistory.at(-1),
                isInMenu: engine.state.isInMenu,
                rawInputConsumer: engine.state.rawInputConsumer,
            },
            {
                activeMenu: undefined,
                isInMenu: false,
                rawInputConsumer: 'game',
            },
        );

        await engine.reset();
    });

    it('ignores navigation for players excluded from menu controls', async () => {
        const engine = new AnthaEngine<AnthaMenuModState<TestMenuKey>>({
            initState: {
                navController: createRecordingNavController(),
                activeBindings: {
                    [LocalPlayerPosition.One]: {
                        [MenuNavBinding.OpenPauseMenu]: createActiveBinding({
                            holdDurationMs: 40,
                        }),
                    },
                },
                allowedPlayerMenuNavigation: {
                    [LocalPlayerPosition.One]: false,
                },
                isInMenu: false,
                menuState: undefined,
                rawInputConsumer: 'game',
            },
            mods: [
                createAnthaMenuMod<TestMenuKey>({
                    menuState: {
                        pauseMenuKey: TestMenuKey.Pause,
                        menuInputConsumerName: 'menu',
                    },
                }),
            ],
        });

        await engine.runSingleTick();

        assert.deepEquals(
            {
                activeMenu: engine.state.menuState?.menuHistory.at(-1),
                openPauseMenuActCount:
                    engine.state.activeBindings?.[LocalPlayerPosition.One]?.[
                        MenuNavBinding.OpenPauseMenu
                    ]?.actCount,
                rawInputConsumer: engine.state.rawInputConsumer,
            },
            {
                activeMenu: undefined,
                openPauseMenuActCount: 0,
                rawInputConsumer: 'game',
            },
        );

        await engine.reset();
    });

    it('exits a nested nav group before closing the menu', async () => {
        const navController = createRecordingNavController();
        navController.exitOutOf = () => {
            navController.calls.push('exit');

            return {
                success: true,
                defaulted: false,
                wrapped: false,
                newElement: document.createElement('div'),
                direction: undefined,
                navAction: NavAction.Exit,
                coords: {
                    x: 0,
                    y: 0,
                },
            };
        };
        const engine = new AnthaEngine<AnthaMenuModState<TestMenuKey>>({
            initState: {
                navController,
                activeBindings: {
                    [LocalPlayerPosition.One]: {
                        [MenuNavBinding.MenuExit]: createActiveBinding(),
                    },
                },
                allowedPlayerMenuNavigation: undefined,
                isInMenu: true,
                menuState: {
                    menuHistory: [
                        TestMenuKey.Pause,
                    ],
                    openedBy: undefined,
                },
                rawInputConsumer: 'menu',
            },
            mods: [
                createAnthaMenuMod<TestMenuKey>({
                    menuState: {
                        pauseMenuKey: TestMenuKey.Pause,
                        menuInputConsumerName: 'menu',
                    },
                }),
            ],
        });

        await engine.runSingleTick();

        assert.deepEquals(
            {
                calls: navController.calls,
                menuExitActCount:
                    engine.state.activeBindings?.[LocalPlayerPosition.One]?.[
                        MenuNavBinding.MenuExit
                    ]?.actCount,
                menuState: engine.state.menuState,
            },
            {
                calls: [
                    'exit',
                ],
                menuExitActCount: 1,
                menuState: {
                    menuHistory: [
                        TestMenuKey.Pause,
                    ],
                    openedBy: undefined,
                },
            },
        );

        await engine.reset();
    });

    async function runHeldMenuPress({
        heldBindings,
        menuHistory,
    }: Readonly<{
        heldBindings: ReadonlyArray<MenuNavBinding>;
        menuHistory: ReadonlyArray<TestMenuKey>;
    }>) {
        const engine = new AnthaEngine<AnthaMenuModState<TestMenuKey>>({
            initState: {
                navController: createRecordingNavController(),
                activeBindings: {
                    [LocalPlayerPosition.One]: typedObjectFromEntries(
                        heldBindings.map((binding) => {
                            return [
                                binding,
                                createActiveBinding(),
                            ];
                        }),
                    ),
                },
                allowedPlayerMenuNavigation: undefined,
                isInMenu: true,
                menuState: {
                    menuHistory: [
                        ...menuHistory,
                    ],
                    openedBy: undefined,
                },
                rawInputConsumer: 'menu',
            },
            mods: [
                createAnthaMenuMod<TestMenuKey>({
                    menuState: {
                        pauseMenuKey: TestMenuKey.Pause,
                        menuInputConsumerName: 'menu',
                    },
                }),
            ],
        });

        const menuStates = await awaitedBlockingMap(
            [
                0,
                1,
            ],
            async () => {
                await engine.runSingleTick();
                return engine.state.menuState;
            },
        );

        await engine.reset();

        return menuStates;
    }

    it('backs out of the last menu without reopening pause while the key is held', async () => {
        assert.deepEquals(
            await runHeldMenuPress({
                heldBindings: [
                    MenuNavBinding.OpenPauseMenu,
                    MenuNavBinding.MenuExit,
                ],
                menuHistory: [
                    TestMenuKey.Pause,
                ],
            }),
            [
                undefined,
                undefined,
            ],
        );
    });

    it('closes every menu without reopening pause while the key is held', async () => {
        assert.deepEquals(
            await runHeldMenuPress({
                heldBindings: [
                    MenuNavBinding.OpenPauseMenu,
                    MenuNavBinding.CloseAllMenus,
                    MenuNavBinding.MenuExit,
                ],
                menuHistory: [
                    TestMenuKey.Pause,
                    TestMenuKey.Options,
                ],
            }),
            [
                undefined,
                undefined,
            ],
        );
    });

    it('restores an unset consumer when menus opened by code close', async () => {
        const engine = new AnthaEngine<AnthaMenuModState<TestMenuKey>>({
            initState: {
                navController: createRecordingNavController(),
                allowedPlayerMenuNavigation: undefined,
                isInMenu: false,
                menuState: undefined,
                rawInputConsumer: undefined,
            },
            mods: [
                createAnthaMenuMod<TestMenuKey>({
                    menuState: {
                        pauseMenuKey: TestMenuKey.Pause,
                        menuInputConsumerName: 'menu',
                    },
                }),
            ],
        });

        engine.state.menuState = pushAnthaMenuState<TestMenuKey>(undefined, TestMenuKey.Options);
        await engine.runSingleTick();

        assert.strictEquals(engine.state.rawInputConsumer, 'menu');

        engine.state.menuState = undefined;
        await engine.runSingleTick();

        /** The earlier assertion narrows `rawInputConsumer`, so its reset is checked apart. */
        assert.isUndefined(engine.state.rawInputConsumer);
        assert.isFalse(engine.state.isInMenu);

        await engine.reset();
    });
});
