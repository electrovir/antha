import {assert} from '@augment-vir/assert';
import {getOrSet, type PartialWithUndefined} from '@augment-vir/common';
import {css, type CSSResult, defineAnthaMod, html, onDomCreated, unsafeCSS} from 'antha';
import {Application, type ApplicationOptions} from 'pixi.js';

/**
 * Engine State for {@link createPixiCanvasMod}.
 *
 * @category Internal
 */
export type AnthaPixiCanvasModState = {
    pixi: Partial<{
        pixiApplication: Application;
        canvas: HTMLCanvasElement;
    }>;
    debugPixiJs: boolean;
};

/**
 * Options for {@link createPixiCanvasMod}.
 *
 * @category Internal
 */
export type AnthaPixiCanvasModOptions = PartialWithUndefined<{
    /** Options for PixiJS init. */
    pixiOptions: Partial<Omit<ApplicationOptions, 'canvas'>>;
    /** If this is provided, the mod will not create its own canvas. */
    canvas: HTMLCanvasElement;
    debug: boolean;
    extraCanvasStyles: CSSResult | string;
    extraCanvasWrapperStyles: CSSResult | string;
}>;

/**
 * Default values for {@link AnthaPixiCanvasModOptions}.
 *
 * @category Internal
 */
export const defaultPixiOptions = {
    background: 'black',
    height: 1000,
    width: 1000,
    antialias: true,
} satisfies Partial<ApplicationOptions>;

/**
 * A mod that manages a PixiJS application and its canvas.
 *
 * @category Pre-Built Mods
 */
export function createPixiCanvasMod(modOptions?: Readonly<AnthaPixiCanvasModOptions> | undefined) {
    const pixiApplicationOptions = {
        ...defaultPixiOptions,
        canvas: undefined as undefined | HTMLCanvasElement,
        ...modOptions?.pixiOptions,
    };

    return defineAnthaMod<AnthaPixiCanvasModState>({
        async execute({state}) {
            if (state.debugPixiJs == undefined) {
                state.debugPixiJs = !!modOptions?.debug;
            }

            const pixiState = getOrSet(state, 'pixi', () => {
                return {};
            });

            const canvas = pixiApplicationOptions.canvas || pixiState.canvas;

            if (!pixiState.pixiApplication && canvas) {
                const pixiApplication = new Application();
                await pixiApplication.init({
                    ...pixiApplicationOptions,
                    canvas,
                });
                pixiState.pixiApplication = pixiApplication;
            }

            const aspectRatio = pixiApplicationOptions.width / pixiApplicationOptions.height;

            return pixiApplicationOptions.canvas
                ? undefined
                : html`
                      <div
                          style=${css`
                              box-sizing: border-box;
                              position: absolute;
                              inset: 0;
                              display: flex;
                              justify-content: center;
                              align-items: center;
                              overflow: hidden;
                              container-type: size;
                              ${pixiApplicationOptions.background
                                  ? css`
                                        background-color: ${unsafeCSS(
                                            pixiApplicationOptions.background,
                                        )};
                                    `
                                  : css``}
                              ${unsafeCSS(modOptions?.extraCanvasWrapperStyles)}
                          `}
                      >
                          <canvas
                              style=${css`
                                  box-sizing: border-box;
                                  width: min(100cqw, calc(100cqh * ${aspectRatio}));
                                  aspect-ratio: ${aspectRatio};
                                  ${unsafeCSS(modOptions?.extraCanvasStyles)}
                              `}
                              id="pixi-canvas"
                              ${onDomCreated((element) => {
                                  assert.instanceOf(element, HTMLCanvasElement);
                                  if (!pixiState.canvas) {
                                      pixiState.canvas = element;
                                  }
                              })}
                          ></canvas>
                      </div>
                  `;
        },
    });
}
