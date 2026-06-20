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
} from 'device-navigation';
import {createAnthaMenuNavMod, MenuNavBinding, type MenuNavModState} from './antha-menu-nav.mod.js';
import {type ActiveBinding, type PlayersActiveBindings} from './player-bindings.js';

type RecordingNavController = NavController & {
    calls: string[];
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
}: Readonly<
    Partial<{
        holdDurationMs: number;
        lastActDurationMs: number;
        actCount: number;
    }>
> = {}): ActiveBinding {
    return {
        holdDuration: {
            milliseconds: holdDurationMs,
        },
        value: 1,
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
    navController.navigatePibling = ({direction}) => {
        navController.calls.push(`pibling-${direction}`);

        return {
            success: false,
            direction,
            navAction: NavAction.Pibling,
            reason: 'test nav tree is empty',
        };
    };
    navController.navigate = ({direction}) => {
        navController.calls.push(`navigate-${direction}`);

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
    navController = createRecordingNavController(),
    isInMenu = true,
}: Readonly<{
    activeBindings?: PlayersActiveBindings | undefined;
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
                allowWrapping: false,
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
                allowWrapping: false,
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
