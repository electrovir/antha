import {AnthaEngine} from '@antha/engine';
import {MenuNavBinding, type ActiveBinding} from '@antha/input';
import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {examplePauseMenuMod, type ExamplePauseMenuModState} from './pause-menu.mod.js';

function createActiveBinding(): ActiveBinding {
    return {
        holdDuration: {
            milliseconds: 0,
        },
        rawInputs: [],
        value: 1,
        actCount: 0,
        lastActDuration: {
            milliseconds: 0,
        },
    };
}

describe(examplePauseMenuMod.modName, () => {
    it('opens the pause menu from the open pause menu action', async () => {
        const openPauseMenuBinding = createActiveBinding();
        const engine = new AnthaEngine<ExamplePauseMenuModState>({
            initState: {
                activeBindings: {
                    '1': {
                        [MenuNavBinding.OpenPauseMenu]: openPauseMenuBinding,
                    },
                },
            },
            mods: [
                examplePauseMenuMod,
            ],
        });

        await engine.runSingleTick();

        assert.deepEquals(
            {
                isInMenu: engine.state.isInMenu,
                isPaused: engine.state.isPaused,
                actCount: openPauseMenuBinding.actCount,
            },
            {
                isInMenu: true,
                isPaused: true,
                actCount: 1,
            },
        );
    });

    it('does not open the pause menu from menu exit', async () => {
        const exitBinding = createActiveBinding();
        const engine = new AnthaEngine<ExamplePauseMenuModState>({
            initState: {
                activeBindings: {
                    '1': {
                        [MenuNavBinding.MenuExit]: exitBinding,
                    },
                },
            },
            mods: [
                examplePauseMenuMod,
            ],
        });

        await engine.runSingleTick();

        assert.deepEquals(
            {
                isInMenu: engine.state.isInMenu,
                isPaused: engine.state.isPaused,
                actCount: exitBinding.actCount,
            },
            {
                isInMenu: false,
                isPaused: false,
                actCount: 0,
            },
        );
    });
});
