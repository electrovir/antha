import {css, defineAnthaMod, html} from '@antha/engine';
import {check} from '@augment-vir/assert';
import {
    getOrSet,
    mergeDefinedProperties,
    round,
    type PartialWithUndefined,
    type RequiredAndNotNull,
} from '@augment-vir/common';
import {colorCss} from '@electrovir/color';
import {viraThemeDarkOverride} from 'vira';
import {type AnthaPixiCanvasModState} from './antha-pixi-canvas.mod.js';

/**
 * The z-index CSS property applied to the pixi-canvas mod's `<canvas>` element.
 *
 * @category Internal
 */
export const pixiCanvasZIndex = 1_000_000;

/**
 * State for showing counters.
 *
 * @category Internal
 */
export type ShowCountersState = {
    /**
     * Show a FPS (frames per second) counter.
     *
     * @default false
     */
    hideFps: boolean;
    /** If `true`, FPS stutters are shown under the counter. */
    debugFps: boolean;
    /** Stores FPS stutters when `debugFps` is turned on. */
    fpsStutters: number[];
};

/**
 * Options for {@link createAnthaPixiFpsMod}.
 *
 * @category Internal
 */
export type PixiFpsModOptions = PartialWithUndefined<
    {
        /** How frequently the FPS display updates, in milliseconds. */
        fpsUpdateIntervalMs: number;
    } & Omit<ShowCountersState, 'fpsFrameCount' | 'fpsStutters'>
>;

/**
 * Default options for {@link createAnthaPixiFpsMod}.
 *
 * @category Internal
 */
export const defaultPixiFpsModOptions = {
    fpsUpdateIntervalMs: 500,
    hideFps: false,
    debugFps: false,
} as const satisfies Required<PixiFpsModOptions>;

/**
 * A pre-built mod that renders the Pixi application's FPS in the top left of the screen. Requires
 * that a pixi canvas mod (see {@link AnthaPixiCanvasModState}) is also in use so that
 * `state.pixi.pixiApplication` is available.
 *
 * @category Pre-Built Mods
 */
export function createAnthaPixiFpsMod(modOptions?: Readonly<PixiFpsModOptions> | undefined) {
    const options: Readonly<RequiredAndNotNull<PixiFpsModOptions>> = mergeDefinedProperties<
        RequiredAndNotNull<PixiFpsModOptions>
    >(defaultPixiFpsModOptions, modOptions);

    return defineAnthaMod<AnthaPixiCanvasModState & ShowCountersState>({
        modName: 'antha-pixi-fps',
        initState: {
            hideFps: options.hideFps,
            debugFps: options.debugFps,
        },
        frequency: {
            durationMs: options.fpsUpdateIntervalMs,
        },
        executeImmediately: true,
        execute({state, msSinceLastExecute, ticksSinceLastExecute}) {
            const fpsStutters = getOrSet(state, 'fpsStutters', () => []);

            const elapsedSeconds = msSinceLastExecute / 1000;
            const fps =
                elapsedSeconds > 0
                    ? round(ticksSinceLastExecute / elapsedSeconds, {
                          digits: 1,
                      })
                    : 0;

            if (state.debugFps && fps > 0 && fps < 55) {
                fpsStutters.push(fps);
                if (fpsStutters.length > 10) {
                    fpsStutters.splice(0, fpsStutters.length - 10);
                }
            }

            const counters = [
                !state.hideFps &&
                    html`
                        <div
                            title="Ticks Per Second"
                            style=${css`
                                ${colorCss(
                                    viraThemeDarkOverride.asTheme.colors[
                                        'vira-pink-foreground-body'
                                    ],
                                )}
                                padding: 1px 3px;
                            `}
                        >
                            ${Math.round(fps).toFixed(0)} FPS
                        </div>
                    `,
                state.debugFps &&
                    fpsStutters.length > 0 &&
                    html`
                        <div
                            title="FPS Stutters"
                            style=${css`
                                ${colorCss(
                                    viraThemeDarkOverride.asTheme.colors[
                                        'vira-yellow-foreground-body'
                                    ],
                                )}
                                padding: 1px 3px;
                                display: flex;
                                flex-direction: column;
                            `}
                        >
                            ${fpsStutters.map(
                                (stutter) => html`
                                    <span>${Math.round(stutter)}</span>
                                `,
                            )}
                        </div>
                    `,
            ].filter(check.isTruthy);

            if (counters.length) {
                return html`
                    <div
                        style=${css`
                            position: absolute;
                            top: 0;
                            left: 0;
                            font-family: monospace;
                            font-size: 14px;
                            pointer-events: none;
                            z-index: ${pixiCanvasZIndex};
                        `}
                    >
                        ${counters}
                    </div>
                `;
            } else {
                return undefined;
            }
        },
    });
}
