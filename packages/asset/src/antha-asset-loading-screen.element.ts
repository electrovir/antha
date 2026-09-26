import {addSuffix} from '@augment-vir/common';
import {attachOnResize, css, defineElement, html} from 'element-vir';
import {setCssVarValue} from 'lit-css-vars';
import {type AnthaAssetModOptions} from './antha-asset.mod.js';
import {calculateVirtualViewport} from './virtual-viewport.js';

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

function updateLoadingScreenScale({
    hostElement,
    loadingScreenElement,
    options,
    screenSize,
}: Readonly<{
    hostElement: HTMLElement;
    loadingScreenElement: HTMLElement;
    options: Readonly<AnthaAssetModOptions>;
    screenSize: Readonly<Pick<DOMRectReadOnly, 'height' | 'width'>>;
}>) {
    const renderScale = hostElement.style.zoom
        ? undefined
        : calculateVirtualViewport({
              screenSize,
              virtualHeight: options.virtualHeight,
              virtualWidth: options.virtualWidth,
          })?.scale;

    if (renderScale == undefined) {
        loadingScreenElement.style.removeProperty('zoom');
    } else {
        /** `zoom` rather than `transform: scale()` keeps text sharp. */
        loadingScreenElement.style.zoom = String(renderScale);
    }
}

/**
 * Default loading screen element rendered by the Antha asset mod while assets are being loaded.
 *
 * @category Internal
 */
export const AnthaAssetLoadingScreen = defineElement<{
    hostElement: HTMLElement;
    options: Readonly<AnthaAssetModOptions>;
    progressPercent: number;
    dotCount: number;
    completed: boolean;
    currentResourceName: string | undefined;
    loadingScreenFadeMs: number;
}>()({
    tagName: 'antha-asset-loading-screen',
    state(): {
        resizeObserver: ResizeObserver | undefined;
    } {
        return {
            resizeObserver: undefined,
        };
    },
    cssVars: {
        'antha-asset-loading-screen-fade-ms': addSuffix({
            value: defaultLoadingScreenFadeMs,
            suffix: 'ms',
        }),
    },
    hostClasses: {
        'antha-asset-loading-screen-completed'({inputs}) {
            return inputs.completed;
        },
    },
    init({host, inputs, updateState}) {
        const {resizeObserver} = attachOnResize(inputs.hostElement, ({contentRect}) => {
            updateLoadingScreenScale({
                hostElement: inputs.hostElement,
                loadingScreenElement: host,
                options: inputs.options,
                screenSize: contentRect,
            });
        });

        updateState({
            resizeObserver,
        });
    },
    cleanup({state}) {
        state.resizeObserver?.disconnect();
    },
    styles({cssVars, hostClasses}) {
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
