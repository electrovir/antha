import {
    type AnthaAssetModState,
    type AssetLoader,
    createAnthaAssetMod,
    defineAsset,
} from '@antha/asset';
import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {randomInteger, wait} from '@augment-vir/common';
import {createUtcFullDate} from 'date-vir';
import {css, html} from 'element-vir';
import {type AnthaDemo} from '../demo.js';

const maxProgress = 100;

const slowAsset = defineAsset({
    assetName: 'slow asset',
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
});

async function loadSlowAsset({
    assetLoader,
}: Readonly<{
    assetLoader: AssetLoader;
}>) {
    const loadSession = assetLoader.createLoadSession();

    await assetLoader.bulkLoadAssets(
        [
            slowAsset,
        ],
        {
            loadSession,
        },
    );
    loadSession.complete();
}

export const assetLoadingDemo: AnthaDemo = {
    demoName: 'Asset Loading Screen',
    demoPathId: 'asset-loading-screen',
    demoSortDate: createUtcFullDate('2026-03-24'),
    engine() {
        return new AnthaEngine({
            mods: [
                createAnthaAssetMod(),
                defineAnthaMod<
                    AnthaAssetModState & {
                        loadStarted: boolean;
                    }
                >({
                    modName: 'slow-asset-loader',
                    async execute({state, engine}) {
                        if (
                            state.assetLoader &&
                            (!state.loadStarted ||
                                (state.assetLoader.loadState?.completedAt &&
                                    state.assetLoader.loadState.completedAt + 10_000 <
                                        engine.totalMs))
                        ) {
                            if (state.loadStarted) {
                                console.info('reloading assets');
                                await state.assetLoader.unloadAssets([slowAsset]);
                            } else {
                                state.loadStarted = true;
                            }
                            void loadSlowAsset({
                                assetLoader: state.assetLoader,
                            });
                        }

                        if (state.assetLoader?.loadState?.isLoading) {
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
