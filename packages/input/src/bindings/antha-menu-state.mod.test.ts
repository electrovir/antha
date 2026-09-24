import {AnthaEngine} from '@antha/engine';
import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {MenuNavBinding} from './antha-menu-nav.mod.js';
import {
    createAnthaMenuStateMod,
    getAnthaMenuReturnState,
    getAnthaMenuStateForNavigation,
    type AnthaMenuStateModState,
} from './antha-menu-state.mod.js';

enum TestMenuKey {
    Options = 'options',
    Pause = 'pause',
}

type TestMenuState = AnthaMenuStateModState<TestMenuKey>;

function createActiveBinding() {
    return {
        actCount: 0,
        holdDuration: {
            milliseconds: 40,
        },
        lastActDuration: {
            milliseconds: 0,
        },
        rawInputs: [],
        value: 1,
    };
}

describe(getAnthaMenuReturnState.name, () => {
    it('returns an empty path when the current state is missing', () => {
        assert.deepEquals(getAnthaMenuReturnState<TestMenuKey>(undefined), {
            activeMenu: undefined,
            returnTo: [],
        });
    });
});

describe(getAnthaMenuStateForNavigation.name, () => {
    it('opens pause and returns to a parent menu or closes menu mode', () => {
        assert.deepEquals(
            getAnthaMenuStateForNavigation({
                menuExitWasTriggered: false,
                menuState: undefined,
                openPauseMenuWasTriggered: true,
                pauseMenu: TestMenuKey.Pause,
            }),
            {
                activeMenu: TestMenuKey.Pause,
                returnTo: [],
            },
        );
        assert.deepEquals(
            getAnthaMenuStateForNavigation({
                menuExitWasTriggered: true,
                menuState: {
                    activeMenu: TestMenuKey.Options,
                    returnTo: [TestMenuKey.Pause],
                },
                openPauseMenuWasTriggered: false,
                pauseMenu: TestMenuKey.Pause,
            }),
            {
                activeMenu: TestMenuKey.Pause,
                returnTo: [],
            },
        );
        assert.deepEquals(
            getAnthaMenuStateForNavigation({
                menuExitWasTriggered: true,
                menuState: {
                    activeMenu: TestMenuKey.Pause,
                    returnTo: [],
                },
                openPauseMenuWasTriggered: false,
                pauseMenu: TestMenuKey.Pause,
            }),
            {
                activeMenu: undefined,
                returnTo: [],
            },
        );
    });

    it('does not transition when no pause or back binding was triggered', () => {
        assert.isUndefined(
            getAnthaMenuStateForNavigation({
                menuExitWasTriggered: false,
                menuState: undefined,
                openPauseMenuWasTriggered: false,
                pauseMenu: TestMenuKey.Pause,
            }),
        );
        assert.isUndefined(
            getAnthaMenuStateForNavigation({
                menuExitWasTriggered: false,
                menuState: {
                    activeMenu: TestMenuKey.Options,
                    returnTo: [TestMenuKey.Pause],
                },
                openPauseMenuWasTriggered: false,
                pauseMenu: TestMenuKey.Pause,
            }),
        );
    });
});

describe(createAnthaMenuStateMod.name, () => {
    it('consumes pause/back inputs and switches menu state and input consumers', async () => {
        const engine = new AnthaEngine<TestMenuState>({
            initState: {
                activeBindings: {
                    '1': {
                        [MenuNavBinding.OpenPauseMenu]: createActiveBinding(),
                    },
                },
                allowedPlayerMenuNavigation: undefined,
                isInMenu: false,
                menuState: undefined,
                rawInputConsumer: 'game',
            },
            mods: [
                createAnthaMenuStateMod<TestMenuKey>({
                    pauseMenuKey: TestMenuKey.Pause,
                    gameInputConsumerName: 'game',
                    menuInputConsumerName: 'menu',
                }),
            ],
        });

        await engine.runSingleTick();

        assert.deepEquals(
            {
                activeMenu: engine.state.menuState?.activeMenu,
                isInMenu: engine.state.isInMenu,
                lastActDuration:
                    engine.state.activeBindings?.['1']?.[MenuNavBinding.OpenPauseMenu]
                        ?.lastActDuration,
                openPauseMenuActCount:
                    engine.state.activeBindings?.['1']?.[MenuNavBinding.OpenPauseMenu]?.actCount,
                rawInputConsumer: engine.state.rawInputConsumer,
            },
            {
                activeMenu: TestMenuKey.Pause,
                isInMenu: true,
                lastActDuration: {
                    milliseconds: 40,
                },
                openPauseMenuActCount: 1,
                rawInputConsumer: 'menu',
            },
        );

        engine.state.menuState = {
            activeMenu: TestMenuKey.Options,
            returnTo: [TestMenuKey.Pause],
        };
        engine.state.activeBindings = {
            '1': {
                [MenuNavBinding.MenuExit]: createActiveBinding(),
            },
        };

        await engine.runSingleTick();

        assert.deepEquals(
            {
                activeMenu: engine.state.menuState.activeMenu,
                isInMenu: engine.state.isInMenu,
                menuExitActCount:
                    engine.state.activeBindings['1']?.[MenuNavBinding.MenuExit]?.actCount,
                rawInputConsumer: engine.state.rawInputConsumer,
            },
            {
                activeMenu: TestMenuKey.Pause,
                isInMenu: true,
                menuExitActCount: 1,
                rawInputConsumer: 'menu',
            },
        );

        engine.state.menuState = {
            activeMenu: TestMenuKey.Pause,
            returnTo: [],
        };
        engine.state.activeBindings = {
            '1': {
                [MenuNavBinding.MenuExit]: createActiveBinding(),
            },
        };

        await engine.runSingleTick();

        assert.deepEquals(
            {
                activeMenu: engine.state.menuState.activeMenu,
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

    it('does not transition with missing or idle player bindings', async () => {
        const engine = new AnthaEngine<TestMenuState>({
            initState: {
                allowedPlayerMenuNavigation: undefined,
                isInMenu: false,
                menuState: undefined,
                rawInputConsumer: 'game',
            },
            mods: [
                createAnthaMenuStateMod<TestMenuKey>({
                    pauseMenuKey: TestMenuKey.Pause,
                    gameInputConsumerName: 'game',
                    menuInputConsumerName: 'menu',
                }),
            ],
        });

        await engine.runSingleTick();

        assert.deepEquals(
            {
                activeMenu: engine.state.menuState?.activeMenu,
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
            '1': {},
        };
        await engine.runSingleTick();

        assert.deepEquals(
            {
                activeMenu: engine.state.menuState?.activeMenu,
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
        const engine = new AnthaEngine<TestMenuState>({
            initState: {
                activeBindings: {
                    '1': {
                        [MenuNavBinding.OpenPauseMenu]: createActiveBinding(),
                    },
                },
                allowedPlayerMenuNavigation: {
                    '1': false,
                },
                isInMenu: false,
                menuState: undefined,
                rawInputConsumer: 'game',
            },
            mods: [
                createAnthaMenuStateMod<TestMenuKey>({
                    pauseMenuKey: TestMenuKey.Pause,
                    gameInputConsumerName: 'game',
                    menuInputConsumerName: 'menu',
                }),
            ],
        });

        await engine.runSingleTick();

        assert.deepEquals(
            {
                activeMenu: engine.state.menuState?.activeMenu,
                openPauseMenuActCount:
                    engine.state.activeBindings?.['1']?.[MenuNavBinding.OpenPauseMenu]?.actCount,
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
});
