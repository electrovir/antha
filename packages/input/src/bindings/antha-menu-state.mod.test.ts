import {AnthaEngine} from '@antha/engine';
import {LocalPlayerPosition} from '@antha/util';
import {assert} from '@augment-vir/assert';
import {describe, it, itCases} from '@augment-vir/test';
import {MenuNavBinding} from './antha-menu-nav.mod.js';
import {
    createAnthaMenuStateMod,
    getAnthaMenuStateForNavigation,
    popAnthaMenuState,
    pushAnthaMenuState,
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

const testOpener = {
    activeBinding: createActiveBinding(),
    playerPosition: LocalPlayerPosition.Two,
};

describe(popAnthaMenuState.name, () => {
    it('clears the menu state when the current state is missing', () => {
        assert.isUndefined(popAnthaMenuState<TestMenuKey>(undefined));
    });
});

describe(pushAnthaMenuState.name, () => {
    it('opens a submenu that backs out to the current menu', () => {
        const pauseMenuState = {
            menuHistory: [
                TestMenuKey.Pause,
            ],
            openedBy: testOpener,
        };
        const submenuState = pushAnthaMenuState(pauseMenuState, TestMenuKey.Options);

        assert.deepEquals(submenuState, {
            menuHistory: [
                TestMenuKey.Pause,
                TestMenuKey.Options,
            ],
            openedBy: testOpener,
        });
        assert.deepEquals(popAnthaMenuState(submenuState), pauseMenuState);
        assert.isUndefined(popAnthaMenuState(pauseMenuState));
    });

    it('opens with no opener when no menu is open', () => {
        assert.deepEquals(pushAnthaMenuState<TestMenuKey>(undefined, TestMenuKey.Options), {
            menuHistory: [
                TestMenuKey.Options,
            ],
            openedBy: undefined,
        });
    });
});

describe(getAnthaMenuStateForNavigation.name, () => {
    const pauseMenuState = {
        menuHistory: [
            TestMenuKey.Pause,
        ],
        openedBy: testOpener,
    };
    const optionsMenuState = {
        menuHistory: [
            TestMenuKey.Pause,
            TestMenuKey.Options,
        ],
        openedBy: testOpener,
    };

    itCases(getAnthaMenuStateForNavigation<TestMenuKey>, [
        {
            it: 'opens the pause menu when no menu is active',
            input: {
                menuExitWasTriggered: false,
                menuState: undefined,
                openPauseMenuTrigger: testOpener,
                pauseMenu: TestMenuKey.Pause,
            },
            expect: {
                nextMenuState: pauseMenuState,
            },
        },
        {
            it: 'returns to the parent menu on back',
            input: {
                menuExitWasTriggered: true,
                menuState: optionsMenuState,
                openPauseMenuTrigger: undefined,
                pauseMenu: TestMenuKey.Pause,
            },
            expect: {
                nextMenuState: pauseMenuState,
            },
        },
        {
            it: 'closes the root menu on pause',
            input: {
                menuExitWasTriggered: false,
                menuState: pauseMenuState,
                openPauseMenuTrigger: testOpener,
                pauseMenu: TestMenuKey.Pause,
            },
            expect: {
                nextMenuState: undefined,
            },
        },
        {
            it: 'closes the root menu on back',
            input: {
                menuExitWasTriggered: true,
                menuState: pauseMenuState,
                openPauseMenuTrigger: undefined,
                pauseMenu: TestMenuKey.Pause,
            },
            expect: {
                nextMenuState: undefined,
            },
        },
        {
            it: 'ignores back when no menu is open',
            input: {
                menuExitWasTriggered: true,
                menuState: undefined,
                openPauseMenuTrigger: undefined,
                pauseMenu: TestMenuKey.Pause,
            },
            expect: undefined,
        },
        {
            it: 'ignores inactive navigation inputs in a submenu',
            input: {
                menuExitWasTriggered: false,
                menuState: optionsMenuState,
                openPauseMenuTrigger: undefined,
                pauseMenu: TestMenuKey.Pause,
            },
            expect: undefined,
        },
    ]);
});

describe(createAnthaMenuStateMod.name, () => {
    it('consumes pause/back inputs and switches menu state and input consumers', async () => {
        const engine = new AnthaEngine<TestMenuState>({
            initState: {
                activeBindings: {
                    [LocalPlayerPosition.One]: {
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
                        ...createActiveBinding(),
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
                [MenuNavBinding.MenuExit]: createActiveBinding(),
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
                [MenuNavBinding.MenuExit]: createActiveBinding(),
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
        const engine = new AnthaEngine<TestMenuState>({
            initState: {
                activeBindings: {
                    [LocalPlayerPosition.One]: {
                        [MenuNavBinding.OpenPauseMenu]: createActiveBinding(),
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
});
