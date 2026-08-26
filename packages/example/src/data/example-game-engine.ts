import {createAnthaAssetMod, createAnthaBootstrapMod} from '@antha/asset';
import {AnthaEngine} from '@antha/engine';
import {type ExampleGameBootstrapModule} from './example-game.bootstrap.js';
import {type FullExampleGameState} from './game-state.js';

export function createExampleGame() {
    return new AnthaEngine<FullExampleGameState>({
        mods: [
            createAnthaAssetMod(),
            createAnthaBootstrapMod<ExampleGameBootstrapModule, FullExampleGameState>({
                assetName: 'Example game code',
                async loadModule() {
                    return await import('./example-game.bootstrap.js');
                },
                bootstrap({module, state}) {
                    return module.bootstrapExampleGame({
                        state,
                    });
                },
            }),
        ],
    });
}
