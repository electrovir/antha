import {
    createAnthaAssetLoaderMod,
    type AnthaAsset,
    type AnthaAssetLoaderModState,
} from '@antha/asset';
import {randomInteger, wait} from '@augment-vir/common';
import {AnthaEngine, css, defineAnthaMod, html} from 'antha';
import {createUtcFullDate} from 'date-vir';
import {type AnthaDemo} from '../demo.js';

const maxProgress = 100;

const slowAsset: AnthaAsset<undefined> = {
    name: 'slow asset',
    maxProgress,
    async load({incrementProgressCallback}) {
        for (let step = 0; step < maxProgress; step++) {
            await wait({
                milliseconds: randomInteger({
                    min: 10,
                    max: 200,
                }),
            });
            incrementProgressCallback();
        }

        return {
            value: 'done',
        };
    },
};

export const assetLoadingDemo: AnthaDemo = {
    demoName: 'Asset Loading Screen',
    demoPathId: 'asset-loading-screen',
    demoSortDate: createUtcFullDate('2026-03-24'),
    engine() {
        return new AnthaEngine({
            mods: [
                createAnthaAssetLoaderMod(),
                defineAnthaMod<
                    AnthaAssetLoaderModState & {
                        loadStarted: boolean;
                    }
                >({
                    modName: 'slow-asset-loader',
                    async execute({state, engine}) {
                        if (state.assetLoader && !state.loadStarted) {
                            state.loadStarted = true;
                            void state.assetLoader.bulkLoadAssets([
                                {
                                    asset: slowAsset,
                                    params: undefined,
                                },
                            ]);
                        }

                        if (
                            state.assetLoader &&
                            state.loadingScreenState?.completedAt &&
                            state.loadingScreenState.completedAt + 10_000 < engine.totalMs
                        ) {
                            console.info('reloading assets');
                            await state.assetLoader.unloadAssets([slowAsset]);
                            void state.assetLoader.bulkLoadAssets([
                                {
                                    asset: slowAsset,
                                    params: undefined,
                                },
                            ]);
                        }

                        if (state.isShowingLoadingScreen) {
                            return undefined;
                        } else {
                            return html`
                                <div
                                    style=${css`
                                        width: 100%;
                                        height: 100%;
                                        display: flex;
                                        justify-content: center;
                                        align-items: center;
                                    `}
                                >
                                    Load complete!
                                </div>
                            `;
                        }
                    },
                }),
            ],
        });
    },
};
