import {createAnthaAssetMod} from '@antha/asset';
import {AnthaEngine} from '@antha/engine';
import {
    createAnthaInputBindingsMod,
    createAnthaMenuNavMod,
    createAnthaReadRawInputMod,
} from '@antha/input';
import {exampleGameMod} from './mods/example-game.mod.js';
import {examplePauseMenuMod} from './mods/pause-menu.mod.js';
import {saveStateMod} from './mods/save-state.mod.js';

export function createExampleGame() {
    return new AnthaEngine({
        mods: [
            createAnthaAssetMod(),
            saveStateMod,
            exampleGameMod,
            examplePauseMenuMod,
            // createAnthaFpsMod(),
            createAnthaReadRawInputMod({
                // debugRawInputs: true,
            }),
            createAnthaInputBindingsMod({
                debugActiveBindings: true,
            }),
            createAnthaMenuNavMod({
                alwaysRequireFocused: true,
                allowWrapping: false,
            }),
        ],
    });
}
