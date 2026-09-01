import {defineAnthaMod} from '@antha/engine';
import {addSuffix, type PartialWithUndefined} from '@augment-vir/common';
import {css, defineElement, html} from 'element-vir';
import {setCssVarValue} from 'lit-css-vars';
import {AssetLoader} from './asset-loader.js';

/**
 * State for {@link AnthaAssetMod}.
 *
 * @category Internal
 */
export type AnthaAssetModState = {
    assetLoader: AssetLoader;
};

/**
 * Configuration options for {@link createAnthaAssetMod}.
 *
 * @category Internal
 */
export type AnthaAssetModOptions = PartialWithUndefined<{
    /**
     * If set to `true`, the default loading screen is not rendered. Loading-session state remains
     * available for a custom loading screen.
     *
     * @default false
     */
    hideLoadingScreen: boolean;
    /**
     * Duration in milliseconds for the default loading screen's fade-out animation.
     *
     * @default defaultLoadingScreenFadeMs
     */
    loadingScreenFadeMs: number;
}>;

/**
 * Duration in milliseconds for the loading screen fade-out animation.
 *
 * @category Internal
 */
export const defaultLoadingScreenFadeMs = 1000;
/**
 * Duration in milliseconds for the progress bar grow transition.
 *
 * @category Internal
 */
export const loadingScreenProgressGrowMs = 200;

/**
 * Default loading screen element rendered by the Antha asset mod while assets are being loaded.
 *
 * @category Internal
 */
export const AnthaAssetLoadingScreen = defineElement<{
    progressPercent: number;
    dotCount: number;
    completed: boolean;
    currentResourceName: string | undefined;
    loadingScreenFadeMs: number;
}>()({
    tagName: 'antha-asset-loading-screen',
    cssVars: {
        'antha-asset-loading-screen-fade-ms': addSuffix({
            value: defaultLoadingScreenFadeMs,
            suffix: 'ms',
        }),
    },
    hostClasses: {
        'antha-asset-loading-screen-completed': ({inputs}) => inputs.completed,
    },
    styles: ({cssVars, hostClasses}) => {
        return css`
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
                transition: opacity ${cssVars['antha-asset-loading-screen-fade-ms'].value} ease-in;
            }

            .loading-text {
                font-size: 24px;
                position: relative;
            }

            .dots {
                font-family: monospace;
                position: absolute;
                left: 100%;
                bottom: 0;
            }

            .progress-track {
                width: 300px;
                height: 1em;
                overflow: hidden;
                border: 4px solid white;
            }

            .current-resource-name {
                font-size: 14px;
                opacity: 0.7;
            }

            .progress-fill {
                height: 100%;
                background-color: white;
                transition: width ${loadingScreenProgressGrowMs}ms ease-in;
            }

            ${hostClasses['antha-asset-loading-screen-completed'].selector} {
                opacity: 0;
            }
        `;
    },
    render({host, inputs, cssVars}) {
        setCssVarValue({
            forCssVar: cssVars['antha-asset-loading-screen-fade-ms'],
            onElement: host,
            toValue: addSuffix({
                value: inputs.loadingScreenFadeMs,
                suffix: 'ms',
            }),
        });

        const dotCount = inputs.dotCount % 4;
        const dots = '.'.repeat(dotCount) + '\u00A0'.repeat(3 - dotCount);

        return html`
            <span class="loading-text">
                Loading
                <span class="dots">${dots}</span>
            </span>
            <div>
                <span class="current-resource-name">
                    ${inputs.currentResourceName ||
                    html`
                        &nbsp;
                    `}
                </span>
                <div class="progress-track">
                    <div
                        class="progress-fill"
                        style=${css`
                            width: ${inputs.progressPercent}%;
                        `}
                    ></div>
                </div>
            </div>
        `;
    },
});

/**
 * The Antha Asset mod, created by {@link createAnthaAssetMod}.
 *
 * @category Pre-Built Mods
 */
export type AnthaAssetMod = ReturnType<typeof createAnthaAssetMod>;

/**
 * Name for the mod {@link AnthaAssetMod}.
 *
 * @category Internal
 */
export const anthaAssetModName = 'antha-asset';

/**
 * Creates the Antha asset mod which manages asset loading and an optional loading screen overlay.
 *
 * @category Pre-Built Mods
 */
export function createAnthaAssetMod(options: Readonly<AnthaAssetModOptions> = {}) {
    const configuredLoadingScreenFadeMs = options.loadingScreenFadeMs ?? defaultLoadingScreenFadeMs;

    return defineAnthaMod<AnthaAssetModState>({
        modName: anthaAssetModName,
        async cleanup({state}) {
            await state.assetLoader?.destroy();
        },
        execute({state, engine}) {
            if (!state.assetLoader) {
                state.assetLoader = new AssetLoader({
                    logger: engine.log,
                });
            }

            state.assetLoader.advanceLoadState({
                currentTick: engine.currentTick,
                engineTime: engine.engineTime,
            });

            if (options.hideLoadingScreen) {
                return;
            }

            const loadState = state.assetLoader.loadState;

            if (
                loadState &&
                (loadState.completedAt == undefined ||
                    engine.engineTime <= loadState.completedAt + configuredLoadingScreenFadeMs)
            ) {
                const progressPercent =
                    loadState.total > 0 ? (loadState.current / loadState.total) * 100 : 0;

                return html`
                    <${AnthaAssetLoadingScreen.assign({
                        progressPercent,
                        dotCount: Math.floor(engine.engineTime / 500) % 4,
                        completed: loadState.completedAt != undefined,
                        currentResourceName: loadState.currentResourceName,
                        loadingScreenFadeMs: configuredLoadingScreenFadeMs,
                    })}></${AnthaAssetLoadingScreen}>
                `;
            }

            return undefined;
        },
    });
}
