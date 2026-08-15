import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {type AnthaAssetModState, createAnthaAssetMod, defineAsset} from '../index.js';

type GameState = AnthaAssetModState & {
    hasLoadedTitle: boolean;
};

const titleAsset = defineAsset({
    name: 'title',
    maxProgress: 1,
    load({incrementProgressCallback}) {
        incrementProgressCallback();

        return {
            value: 'Antha',
        };
    },
});
const engine = new AnthaEngine<GameState>({
    initState: {
        hasLoadedTitle: false,
    },
    mods: [
        createAnthaAssetMod(),
        defineAnthaMod<GameState>({
            modName: 'game-logic',
            async execute({state}) {
                if (state.assetLoader && !state.hasLoadedTitle) {
                    state.hasLoadedTitle = true;
                    await state.assetLoader.bulkLoadAssets([
                        titleAsset,
                    ]);
                }
            },
        }),
    ],
});

engine.startLoop();
