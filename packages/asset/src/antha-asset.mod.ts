import {defineAnthaMod} from '@antha/engine';
import {type PartialWithUndefined} from '@augment-vir/common';
import {html} from 'element-vir';
import {
    AnthaAssetLoadingScreen,
    defaultLoadingScreenFadeMs,
} from './antha-asset-loading-screen.element.js';
import {AssetLoader} from './asset-loader.js';
import {
    type AnthaVirtualViewportOptions,
    type AnthaVirtualViewportState,
} from './virtual-viewport.js';

export {
    AnthaAssetLoadingScreen,
    defaultLoadingScreenFadeMs,
    loadingScreenProgressGrowMs,
} from './antha-asset-loading-screen.element.js';

/**
 * State for {@link AnthaAssetMod}.
 *
 * @category Internal
 */
export type AnthaAssetModState = AnthaVirtualViewportState & {
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
}> &
    PartialWithUndefined<AnthaVirtualViewportOptions>;

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
        execute({hostElement, state, engine}) {
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
                        hostElement,
                        options,
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
