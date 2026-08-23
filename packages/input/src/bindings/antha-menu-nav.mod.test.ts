import {AnthaEngine} from '@antha/engine';
import {assert, assertWrap} from '@augment-vir/assert';
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
import {createAnthaMenuNavMod, MenuNavBinding, type MenuNavModState} from './antha-menu-nav.mod.js';
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
    blockPerpendicularNavigation = false,
    navController = createRecordingNavController(),
    isInMenu = true,
}: Readonly<{
    activeBindings?: PlayersActiveBindings | undefined;
    blockPerpendicularNavigation?: boolean | undefined;
    navController?: RecordingNavController | undefined;
    isInMenu?: boolean | undefined;
}>) {
    const engine = new AnthaEngine<MenuNavModState>({
        initState: {
            isInMenu,
            navController,
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
            createAnthaMenuNavMod({
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

describe(createAnthaMenuNavMod.name, () => {
    it('forwards perpendicular navigation settings', async () => {
        const navController = createRecordingNavController();

        const {engine} = await runMenuNav({
            activeBindings: {
                '1': {
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
        const mod = createAnthaMenuNavMod({
            repeatThreshold: {
                milliseconds: 500,
            },
        });

        const engine = new AnthaEngine<MenuNavModState>({
            mods: [
                mod,
            ],
        });

        engine.state.isInMenu = true;
        engine.state.activeBindings = {
            '1': {
                [MenuNavBinding.MenuRight]: {
                    holdDuration: {
                        milliseconds: 120,
                    },
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
            engine.state.activeBindings['1']?.[MenuNavBinding.MenuRight],
        );

        assert.deepEquals(activeBinding, {
            holdDuration: {
                milliseconds: 120,
            },
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

        const engine = new AnthaEngine<MenuNavModState>({
            hostElement,
            initState: {
                isInMenu: true,
                navController,
                activeBindings: {
                    '1': {
                        [MenuNavBinding.MenuRight]: {
                            holdDuration: {
                                milliseconds: 0,
                            },
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
                createAnthaMenuNavMod(),
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
                '1': {
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
                '1': {
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
                '1': {
                    other: createActiveBinding(),
                },
            },
        });

        assert.deepEquals(navController.calls, []);
    });

    it('requires the default minimum directional input value before navigating', async () => {
        const navController = createRecordingNavController();
        const engine = new AnthaEngine<MenuNavModState>({
            initState: {
                activeBindings: {
                    '1': {
                        [MenuNavBinding.MenuRight]: createActiveBinding({
                            value: 0.79,
                        }),
                    },
                },
                isInMenu: true,
                navController,
            },
            mods: [
                createAnthaMenuNavMod(),
            ],
        });

        await engine.runSingleTick();

        assert.deepEquals(navController.calls, []);
    });

    it('waits longer before repeating directional navigation by default', async () => {
        const navController = createRecordingNavController();
        const engine = new AnthaEngine<MenuNavModState>({
            initState: {
                activeBindings: {
                    '1': {
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
                createAnthaMenuNavMod(),
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
                '1': {
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
                '1': {
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
                '1': {
                    [MenuNavBinding.MenuEnter]: enterBinding,
                },
            },
        });
        await runMenuNav({
            navController: exitNavController,
            activeBindings: {
                '1': {
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
                '1': {
                    [MenuNavBinding.MenuEnter]: createActiveBinding(),
                    [MenuNavBinding.MenuRight]: createActiveBinding(),
                },
            },
        });
        await runMenuNav({
            navController: exitNavController,
            activeBindings: {
                '1': {
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
                '1': {
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
                '1': {
                    [MenuNavBinding.MenuSectionNext]: createActiveBinding(),
                },
            },
        });
        await runMenuNav({
            navController: previousNavController,
            activeBindings: {
                '1': {
                    [MenuNavBinding.MenuSectionPrevious]: createActiveBinding(),
                },
            },
        });
        await runMenuNav({
            navController: bothNavController,
            activeBindings: {
                '1': {
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
                '1': {
                    [MenuNavBinding.MenuUp]: createActiveBinding(),
                    [MenuNavBinding.MenuRight]: createActiveBinding(),
                },
            },
        });
        await runMenuNav({
            navController: downLeftNavController,
            activeBindings: {
                '1': {
                    [MenuNavBinding.MenuDown]: createActiveBinding(),
                    [MenuNavBinding.MenuLeft]: createActiveBinding(),
                },
            },
        });
        await runMenuNav({
            navController: opposedNavController,
            activeBindings: {
                '1': {
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
