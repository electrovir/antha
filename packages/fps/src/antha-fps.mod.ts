import {defineAnthaMod} from '@antha/engine';
import {check} from '@augment-vir/assert';
import {getOrSet, round, type PartialWithUndefined} from '@augment-vir/common';
import {colorCss} from '@electrovir/color';
import {css, html} from 'element-vir';
import {viraThemeDarkOverride} from 'vira';

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
 * Options for {@link createAnthaFpsMod}.
 *
 * @category Internal
 */
export type AnthaFpsModOptions = PartialWithUndefined<
    {
        /** How frequently the FPS display updates, in milliseconds. */
        fpsUpdateIntervalMs: number;
    } & Omit<ShowCountersState, 'fpsStutters'>
>;

/**
 * A pre-built mod that renders the render loop's FPS in the top left of the screen.
 *
 * @category Pre-Built Mods
 */
export function createAnthaFpsMod(options?: Readonly<AnthaFpsModOptions> | undefined) {
    return defineAnthaMod<ShowCountersState>({
        modName: 'antha-fps',
        frequency: {
            durationMs: options?.fpsUpdateIntervalMs || 500,
        },
        initState: {
            debugFps: !!options?.debugFps,
            hideFps: !!options?.hideFps,
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
                            ${fpsStutters.map((stutter) => {
                                return html`
                                    <span>${Math.round(stutter)}</span>
                                `;
                            })}
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
                            z-index: ${999_999_999_999};
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
