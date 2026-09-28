import {LocalPlayerPosition} from '@antha/util';
import {assert} from '@augment-vir/assert';
import {describe, it, itCases} from '@augment-vir/test';
import {
    getAnthaMenuStateForNavigation,
    popAnthaMenuState,
    pushAnthaMenuState,
} from './antha-menu-state.js';

enum TestMenuKey {
    Options = 'options',
    Pause = 'pause',
}

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
