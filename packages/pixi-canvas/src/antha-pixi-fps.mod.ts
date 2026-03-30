import {check} from '@augment-vir/assert';
import {
    mergeDefinedProperties,
    round,
    type PartialWithUndefined,
    type RequiredAndNotNull,
} from '@augment-vir/common';
import {colorCss} from '@electrovir/color';
import {css, defineAnthaMod, html, listen} from 'antha';
import {ViraButton, viraThemeDarkOverride} from 'vira';
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
    /** Show a FPS (frames per second) counter. */
    showFps: boolean;
    /** Show a TPS (ticks per second) counter. */
    showTps: boolean;
    /** If `true`, TPS stutters are shown under the counter. */
    debugTps: boolean;
    /** If `true`, a pause/play button shows up for playing / pausing the icon. */
    enableTickPause: boolean;
    /** Stores TPS stutters when `debugTps` is turned on. */
    tpsStutters: number[];
};

/**
 * Options for {@link createAnthaPixiFpsMod}.
 *
 * @category Internal
 */
export type PixiFpsModOptions = PartialWithUndefined<
    {
        /** How frequently the FPS display updates, in milliseconds. */
        updateIntervalMs: number;
    } & Omit<ShowCountersState, 'tpsStutters'>
>;

/**
 * Default options for {@link createAnthaPixiFpsMod}.
 *
 * @category Internal
 */
export const defaultPixiFpsModOptions = {
    updateIntervalMs: 500,
    showFps: true,
    showTps: true,
    debugTps: false,
    enableTickPause: false,
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
        frequency: {
            durationMs: options.updateIntervalMs,
        },
        executeImmediately: true,
        execute({state, engine, msSinceLastExecute, ticksSinceLastExecute}) {
            if (state.showFps == undefined) {
                state.showFps = options.showFps;
            }
            if (state.showTps == undefined) {
                state.showTps = options.showTps;
            }
            if (state.debugTps == undefined) {
                state.debugTps = options.debugTps;
            }
            if (state.tpsStutters == undefined) {
                state.tpsStutters = [];
            }

            const elapsedSeconds = msSinceLastExecute / 1000;
            const tps =
                elapsedSeconds > 0
                    ? round(ticksSinceLastExecute / elapsedSeconds, {
                          digits: 1,
                      })
                    : 0;

            const expectedTps = Math.floor(1000 / engine.options.tickDurationMs);

            if (state.debugTps && tps > 0 && tps < expectedTps * 0.98) {
                state.tpsStutters.push(tps);
                if (state.tpsStutters.length > 10) {
                    state.tpsStutters.splice(0, state.tpsStutters.length - 10);
                }
            }

            const counters = [
                state.enableTickPause
                    ? html`
                          <${ViraButton.assign({
                              text: engine.isLoopRunning ? 'X' : '>',
                          })}
                              ${listen('click', () => {
                                  if (engine.isLoopRunning) {
                                      engine.stopLoop();
                                  } else {
                                      engine.startLoop();
                                  }
                              })}
                          ></${ViraButton}>
                      `
                    : undefined,
                state.showFps &&
                    html`
                        <div
                            title="Frames Per Second"
                            style=${css`
                                ${colorCss(
                                    viraThemeDarkOverride.asTheme.colors[
                                        'vira-green-foreground-body'
                                    ],
                                )}
                                padding: 1px 3px;
                            `}
                        >
                            ${Math.round(state.pixi?.pixiApplication?.ticker.FPS || 0).toFixed(0)}
                            FPS
                        </div>
                    `,
                state.showTps &&
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
                            ${Math.round(tps).toFixed(0)} TPS
                        </div>
                    `,
                state.debugTps &&
                    state.tpsStutters.length > 0 &&
                    html`
                        <div
                            title="TPS Stutters"
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
                            ${state.tpsStutters.map(
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
