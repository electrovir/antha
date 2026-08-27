import {type Asset} from '@antha/asset';
import {defineAnthaMod, SkipExecution} from '@antha/engine';
import {loadAnthaAssets} from '@antha/entity-2d';
import {Assets} from '@antha/graphics-2d';
import {Store} from 'indexed-vir';
import {HangarEntity} from '../entities/hangar.entity.js';
import {PlayerShipEntity} from '../entities/player-ship.entity.js';
import {type FullExampleGameState} from '../game-state.js';
import {emptySaveState, type SaveState, saveStateShape} from '../save-state.js';

// cspell:words airstrike airstrikeplat
const saveStateKey = 'save-state';
const fontDefinitions = [
    {
        family: 'AirStrikePlat',
        src: '/fonts/airstrikeplat.woff2',
    },
    {
        family: 'AirStrike',
        src: '/fonts/airstrike.woff2',
    },
] as const;

const fontsAsset: Asset<ReadonlyArray<FontFace | FontFace[]>> = {
    assetName: 'Fonts',
    maxProgress: fontDefinitions.length,
    async load({incrementProgressCallback}) {
        const fonts = await Promise.all(
            fontDefinitions.map(async (fontDefinition) => {
                const font = await Assets.load<FontFace | FontFace[]>({
                    alias: fontDefinition.family,
                    src: fontDefinition.src,
                    data: {
                        family: fontDefinition.family,
                        weights: [
                            'normal',
                        ],
                    },
                });

                incrementProgressCallback();

                return font;
            }),
        );

        return {
            value: fonts,
        };
    },
};

export class ExampleSaveStateStore {
    protected readonly store = new Store('example-game-save-state');

    public async storeState(state: SaveState) {
        await this.store.setItem(saveStateKey, state, saveStateShape);
    }

    public async loadState() {
        return await this.store.getItem(saveStateKey, saveStateShape);
    }
}

function createSaveStateAsset({
    saveStateStore,
    state,
}: Readonly<{
    saveStateStore: ExampleSaveStateStore;
    state: Partial<FullExampleGameState>;
}>): Asset<SaveState> {
    return {
        assetName: 'Save data',
        maxProgress: 1,
        async load({incrementProgressCallback}) {
            const saveState = (await saveStateStore.loadState()) || emptySaveState;
            state.saveState = saveState;
            incrementProgressCallback();

            return {
                value: saveState,
            };
        },
    };
}

export const saveStateMod = defineAnthaMod<FullExampleGameState>({
    modName: 'save-state',
    execute({state}) {
        const assetLoader = state.assetLoader;

        if (!assetLoader) {
            return SkipExecution;
        }

        if (!state.saveStateStore) {
            state.saveStateStore = new ExampleSaveStateStore();
        }

        if (!state.saveState && !state.loadPromise) {
            const saveStateStore = state.saveStateStore;
            const loadSession = assetLoader.createLoadSession();

            state.loadPromise = loadAnthaAssets(
                {
                    assetLoader,
                    entities: [
                        HangarEntity,
                        PlayerShipEntity,
                    ],
                    assets: [
                        fontsAsset,
                        createSaveStateAsset({
                            saveStateStore,
                            state,
                        }),
                    ],
                },
                {
                    maxParallelism: 1,
                    loadSession,
                },
            ).then(() => {
                loadSession.complete();
            });
        }

        return undefined;
    },
});
