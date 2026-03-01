import {assertWrap} from '@augment-vir/assert';
import {round} from '@augment-vir/common';
import {colorCss} from '@electrovir/color';
import {AnthaEngine, type AnthaMod} from 'antha';
import {createUtcFullDate} from 'date-vir';
import {css, html} from 'element-vir';
import {viraAnimationDurations, viraTheme, viraThemeDarkOverride} from 'vira';
import {type AnthaDemo} from '../demo.js';

const tickCounterMod: AnthaMod = {
    execute({currentTick}) {
        return html`
            <div
                class="stat"
                style=${css`
                    position: absolute;
                    top: calc(50% - 30px);
                    left: 50%;
                    transform: translate(-50%, -100%);
                    font-family: monospace;
                    font-size: 1.2em;
                `}
            >
                <span class="label">Ticks</span>
                <span class="value">${currentTick}</span>
            </div>
        `;
    },
};

const tpsTrackerMod: AnthaMod<{
    tps: number;
}> = {
    frequency: {
        durationMs: 1000,
    },
    executeImmediately: true,
    execute({state, msSinceLastExecute, ticksSinceLastExecute}) {
        const elapsedSeconds = msSinceLastExecute / 1000;

        state.tps =
            elapsedSeconds > 0
                ? round(ticksSinceLastExecute / elapsedSeconds, {
                      digits: 1,
                  })
                : 0;

        return html`
            <div
                style=${css`
                    font-family: monospace;
                    font-size: 1.2em;
                    position: absolute;
                    top: 0;
                    left: 0;
                    padding: 1px 3px;
                    ${colorCss(viraThemeDarkOverride.asTheme.colors['vira-green-foreground-body'])}
                `}
            >
                ${state.tps}
            </div>
        `;
    },
};

const colorCyclePairs = [
    viraTheme.colors['vira-red-on-self-body'],
    viraTheme.colors['vira-orange-on-self-body'],
    viraTheme.colors['vira-yellow-on-self-body'],
    viraTheme.colors['vira-green-on-self-body'],
    viraTheme.colors['vira-teal-on-self-body'],
    viraTheme.colors['vira-blue-on-self-body'],
    viraTheme.colors['vira-purple-on-self-body'],
    viraTheme.colors['vira-pink-on-self-body'],
];

const colorCyclerMod: AnthaMod<{
    colorIndex: number;
}> = {
    frequency: {
        ticks: 50,
    },
    executeImmediately: true,
    execute({state, frequency}) {
        state.colorIndex = ((state.colorIndex || 0) + 1) % colorCyclePairs.length;
        const colorPair = assertWrap.isDefined(colorCyclePairs[state.colorIndex || 0]);

        return html`
            <div
                style=${css`
                    position: absolute;
                    top: calc(50% + 30px);
                    left: 50%;
                    transform: translate(-50%, 0%);
                    padding: 12px;
                    border-radius: 6px;
                    text-align: center;
                    font-weight: bold;
                    transition: ${viraAnimationDurations['vira-pretty-animation-duration'].value};
                    ${colorCss(colorPair)}
                `}
            >
                Color cycles every ${frequency?.ticks} ticks
            </div>
        `;
    },
};

export const basicEngineDemo: AnthaDemo = {
    demoName: 'Basic Engine Usage',
    demoPathId: 'basic',
    sortDate: createUtcFullDate('2026-02-27T08:59:47.000Z'),
    engine() {
        return new AnthaEngine({
            mods: [
                tickCounterMod,
                tpsTrackerMod,
                colorCyclerMod,
            ],
        });
    },
};
