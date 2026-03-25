import {type PartialWithUndefined} from '@augment-vir/common';
import {css, defineAnthaMod, defineElement, html} from 'antha';
import {AnthaAssetLoader, AnthaAssetLoaderProgressUpdateEvent} from './asset-loader.js';

/**
 * Engine state for the Antha asset mod loading screen.
 *
 * @category Internal
 */
export type AnthaAssetLoaderModLoadingScreenState = {
    /** The total number to load. Once `current` reaches this, loading is considered complete. */
    total: number;
    /**
     * The current number of loaded assets. Once this reaches `total`, the loading is considered
     * complete.
     */
    current: number;
    completedAt: DOMHighResTimeStamp | undefined;
};

export type AnthaAssetLoaderModState = {
    assetLoader: AnthaAssetLoader;
    isShowingLoadingScreen: boolean;
    loadingScreenState: AnthaAssetLoaderModLoadingScreenState | undefined;
};

export type AnthaAssetLoaderModOptions = PartialWithUndefined<{
    /**
     * If set to `true`, the default loading screen is not rendered. You should probably make your
     * own loading screen in that case.
     *
     * @default false
     */
    hideLoadingScreen: boolean;
}>;

export const loadingScreenFadeMs = 1000;
export const loadingScreenProgressGrowMs = 200;

export const AnthaAssetLoadingScreen = defineElement<{
    progressPercent: number;
    dotCount: number;
    completed: boolean;
}>()({
    tagName: 'antha-asset-loading-screen',
    hostClasses: {
        'antha-asset-loading-screen-completed': ({inputs}) => inputs.completed,
    },
    styles: ({hostClasses}) => css`
        :host {
            position: fixed;
            inset: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background-color: black;
            color: white;
            z-index: 9999;
            gap: 24px;
            opacity: 1;
            transition: opacity ${loadingScreenFadeMs}ms ease-in;
        }

        .loading-text {
            font-size: 24px;
            margin-right: -24px;
        }

        .dots {
            font-family: monospace;
        }

        .progress-track {
            width: 300px;
            height: 1em;
            overflow: hidden;
            border: 4px solid white;
        }

        .progress-fill {
            height: 100%;
            background-color: white;
            transition: width ${loadingScreenProgressGrowMs}ms ease-in;
        }

        ${hostClasses['antha-asset-loading-screen-completed'].selector} {
            opacity: 0;
        }
    `,
    render({inputs}) {
        const dotCount = inputs.dotCount % 4;
        const dots = '.'.repeat(dotCount) + '\u00A0'.repeat(3 - dotCount);

        return html`
            <span class="loading-text">
                Loading
                <span class="dots">${dots}</span>
            </span>
            <div class="progress-track">
                <div
                    class="progress-fill"
                    style=${css`
                        width: ${inputs.progressPercent}%;
                    `}
                ></div>
            </div>
        `;
    },
});

export function createAnthaAssetLoaderMod(options: Readonly<AnthaAssetLoaderModOptions> = {}) {
    return defineAnthaMod<AnthaAssetLoaderModState>({
        modName: 'antha-asset-loader',
        async cleanup({state}) {
            await state.assetLoader?.destroy();
            state.loadingScreenState = undefined;
            state.isShowingLoadingScreen = false;
        },
        execute({state, engine}) {
            if (!state.assetLoader) {
                state.assetLoader = new AnthaAssetLoader({
                    logger: engine.log,
                });

                if (!options.hideLoadingScreen) {
                    state.assetLoader.listen(AnthaAssetLoaderProgressUpdateEvent, (event) => {
                        if (event.detail.complete) {
                            state.loadingScreenState = {
                                current: 1,
                                total: 1,
                                completedAt: engine.totalMs,
                            };
                            state.isShowingLoadingScreen = false;
                        } else {
                            state.isShowingLoadingScreen = true;
                            state.loadingScreenState = {
                                current: event.detail.current,
                                total: event.detail.total,
                                completedAt: undefined,
                            };
                        }
                    });
                }
            }

            if (!options.hideLoadingScreen) {
                return;
            }

            const shouldShowLoadingScreen = state.loadingScreenState?.completedAt
                ? engine.totalMs <= state.loadingScreenState.completedAt + loadingScreenFadeMs
                : true;

            if (state.loadingScreenState && shouldShowLoadingScreen) {
                const progressPercent =
                    state.loadingScreenState.total > 0
                        ? (state.loadingScreenState.current / state.loadingScreenState.total) * 100
                        : 0;

                return html`
                    <${AnthaAssetLoadingScreen.assign({
                        progressPercent,
                        dotCount: Math.floor(engine.totalMs / 500) % 4,
                        completed: !!state.loadingScreenState.completedAt,
                    })}></${AnthaAssetLoadingScreen}>
                `;
            } else {
                return undefined;
            }
        },
    });
}
