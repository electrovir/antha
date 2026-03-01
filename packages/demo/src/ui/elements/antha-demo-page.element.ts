import {type AnthaEngine, AnthaUi} from 'antha';
import {defineElement, html, nothing} from 'element-vir';
import {type RequireExactlyOne} from 'type-fest';
import {type AnthaDemo} from '../../data/demo.js';

export const AnthaDemoPage = defineElement<{
    demo: AnthaDemo;
}>()({
    tagName: 'antha-demo-page',
    state() {
        return {
            currentEngine: undefined as
                | undefined
                | ({
                      demoId: string;
                  } & RequireExactlyOne<{
                      element: HTMLElement;
                      engine: AnthaEngine;
                  }>),
        };
    },
    cleanup({state, updateState}) {
        state.currentEngine?.engine?.reset();

        updateState({
            currentEngine: undefined,
        });
    },
    render({inputs, state, updateState}) {
        if (inputs.demo.demoPathId !== state.currentEngine?.demoId) {
            updateState({
                currentEngine: {
                    demoId: inputs.demo.demoPathId,
                    engine: inputs.demo.engine?.(),
                    element: inputs.demo.element,
                } as typeof state.currentEngine,
            });
        }

        if (state.currentEngine?.element) {
            return html`
                <${inputs.demo.element}></${inputs.demo.element}>
            `;
        } else if (state.currentEngine?.engine) {
            return html`
                <${AnthaUi.assign({
                    engine: state.currentEngine.engine,
                })}></${AnthaUi}>
            `;
        } else {
            return nothing;
        }
    },
});
