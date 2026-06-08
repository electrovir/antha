import {defineAnthaMod} from '@antha/engine';
import {assert} from '@augment-vir/assert';
import {getOrSet, type PartialWithUndefined} from '@augment-vir/common';
import {css, html, onDomCreated, unsafeCSS, type CSSResult} from 'element-vir';
import {Application as PixiApplication, type ApplicationOptions} from 'pixi.js';

export {Application as PixiApplication} from 'pixi.js';

/**
 * Engine State for {@link createAnthaGraphics2dMod}.
 *
 * @category Internal
 */
export type AnthaGraphics2dModState = {
    pixi: Partial<{
        pixiApplication: PixiApplication;
        canvas: HTMLCanvasElement;
    }>;
};

/**
 * Options for {@link createAnthaGraphics2dMod}.
 *
 * @category Internal
 */
export type AnthaGraphics2dModOptions = PartialWithUndefined<{
    /** Options for PixiJS init. */
    pixiOptions: Partial<ApplicationOptions>;
    /** If this is provided, the mod will not create its own canvas. */
    canvas: HTMLCanvasElement;
    extraCanvasStyles: CSSResult | string;
    extraCanvasWrapperStyles: CSSResult | string;
    dynamicCanvasSize: boolean;
}>;

/**
 * Default values for {@link AnthaGraphics2dModOptions}.
 *
 * @category Internal
 */
export const defaultPixiOptions = {
    background: 'black',
    height: 1000,
    width: 1000,
    antialias: true,
    powerPreference: 'high-performance',
} satisfies Partial<ApplicationOptions>;

/**
 * A mod that manages a PixiJS application and its canvas.
 *
 * @category Pre-Built Mods
 */
export function createAnthaGraphics2dMod(
    modOptions?: Readonly<AnthaGraphics2dModOptions> | undefined,
) {
    const pixiApplicationOptions = {
        ...defaultPixiOptions,
        canvas: undefined as undefined | HTMLCanvasElement,
        ...modOptions?.pixiOptions,
    };

    return defineAnthaMod<AnthaGraphics2dModState>({
        modName: 'antha-graphics-2d',
        cleanup({state}) {
            state.pixi?.pixiApplication?.destroy(true);
        },
        async execute({state}) {
            const pixiState = getOrSet(state, 'pixi', () => {
                return {};
            });

            const canvas = pixiApplicationOptions.canvas || pixiState.canvas;

            if (!pixiState.pixiApplication && canvas) {
                const pixiApplication = new PixiApplication();
                await pixiApplication.init({
                    ...pixiApplicationOptions,
                    canvas,
                    ...(modOptions?.dynamicCanvasSize && {
                        resizeTo: window,
                    }),
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
                              z-index: -1;
                              position: absolute;
                              inset: 0;
                              display: flex;
                              justify-content: center;
                              align-items: center;
                              overflow: hidden;
                              container-type: size;
                              ${unsafeCSS(modOptions?.extraCanvasWrapperStyles)}
                          `}
                      >
                          <canvas
                              style=${css`
                                  box-sizing: border-box;
                                  ${modOptions?.dynamicCanvasSize
                                      ? css`
                                            width: 100%;
                                            height: 100%;
                                        `
                                      : css`
                                            width: min(100cqw, calc(100cqh * ${aspectRatio}));
                                            aspect-ratio: ${aspectRatio};
                                        `}
                                  ${unsafeCSS(modOptions?.extraCanvasStyles)}
                              `}
                              id="antha-graphics-2d"
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
