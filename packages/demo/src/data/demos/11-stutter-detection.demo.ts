import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {createAnthaPixiFpsMod} from '@antha/pixi-canvas';
import {randomInteger, wait} from '@augment-vir/common';
import {createUtcFullDate} from 'date-vir';
import {css, defineElement, html, listen} from 'element-vir';
import {type AnthaDemo} from '../demo.js';

type TriggerStutterState = {
    shouldStutter: boolean;
};

const AnthaTriggerStutter = defineElement<{
    state: Partial<TriggerStutterState>;
}>()({
    tagName: 'antha-trigger-stutter',
    styles: css`
        :host {
            display: flex;
            justify-content: center;
            width: 100%;
        }
    `,
    render({inputs}) {
        console.info('render');
        return html`
            <button
                ${listen('click', () => {
                    inputs.state.shouldStutter = true;
                })}
            >
                Trigger Stutter
            </button>
        `;
    },
});

const randomStutterMod = defineAnthaMod<TriggerStutterState>({
    modName: 'demo-random-stutter',
    execute: async ({state}) => {
        if (state.shouldStutter) {
            state.shouldStutter = false;
            await wait({
                milliseconds: randomInteger({
                    min: 100,
                    max: 1500,
                }),
            });
        }

        return html`
            <${AnthaTriggerStutter.assign({
                state,
            })}></${AnthaTriggerStutter}>
        `;
    },
});

export const stutterDetectionDemo: AnthaDemo = {
    demoName: 'Stutter Detection',
    demoPathId: 'stutter-detection',
    demoSortDate: createUtcFullDate('2026-04-05'),
    engine() {
        return new AnthaEngine({
            mods: [
                createAnthaPixiFpsMod({
                    debugFps: true,
                }),
                randomStutterMod,
            ],
        });
    },
};
