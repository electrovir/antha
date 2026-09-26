import {AnthaEngine, type AnthaMod} from '@antha/engine';
import {createAnthaFpsMod} from '@antha/fps';
import {randomInteger, wait} from '@augment-vir/common';
import {createUtcFullDate} from 'date-vir';
import {css, defineElement, html, listen} from 'element-vir';
import {defineTypedEvent} from 'typed-event-target';
import {type AnthaDemo} from '../demo.js';

class TriggerStutterEvent extends defineTypedEvent('trigger-stutter') {}

const AnthaTriggerStutter = defineElement<{
    engine: AnthaEngine;
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
                    inputs.engine.dispatch(new TriggerStutterEvent());
                })}
            >
                Trigger Stutter
            </button>
        `;
    },
});

const randomStutterMod: AnthaMod = {
    modName: 'demo-random-stutter',
    trigger: {
        event: TriggerStutterEvent,
        executeImmediately: true,
    },
    async execute({engine, executionTrigger}) {
        if (executionTrigger.events?.length) {
            await wait({
                milliseconds: randomInteger({
                    min: 100,
                    max: 1500,
                }),
            });
        }

        return html`
            <${AnthaTriggerStutter.assign({
                engine,
            })}></${AnthaTriggerStutter}>
        `;
    },
};

export const stutterDetectionDemo: AnthaDemo = {
    demoName: 'Stutter Detection',
    demoPathId: 'stutter-detection',
    demoSortDate: createUtcFullDate('2026-04-05'),
    engine() {
        return new AnthaEngine({
            mods: [
                createAnthaFpsMod({
                    debugFps: true,
                }),
                randomStutterMod,
            ],
        });
    },
};
