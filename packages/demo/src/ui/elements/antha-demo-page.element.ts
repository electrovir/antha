import {pixiCanvasZIndex} from '@antha/pixi-canvas';
import {colorCss} from '@electrovir/color';
import {type AnthaEngine, AnthaUi} from 'antha';
import {css, defineElement, html, nothing} from 'element-vir';
import {themeDefaultKey} from 'theme-vir';
import {type RequireExactlyOne} from 'type-fest';
import {ViraLink, viraTheme} from 'vira';
import {type DemoRouter} from '../../data/demo-router.js';
import {type AnthaDemo} from '../../data/demo.js';

export const AnthaDemoPage = defineElement<{
    demo: AnthaDemo;
    router: DemoRouter;
}>()({
    tagName: 'antha-demo-page',
    styles: css`
        .overlay {
            position: absolute;
            bottom: 0;
            left: 0;
            ${colorCss(viraTheme.colors[themeDefaultKey])}
            border: 2px solid ${viraTheme.colors[themeDefaultKey].foreground.value};
            z-index: ${pixiCanvasZIndex + 1};
            padding: 4px 8px;
            border-top-right-radius: 4px;
            font-family: sans-serif;
        }
    `,
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
        void state.currentEngine?.engine?.reset();

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

        const content = state.currentEngine?.element
            ? html`
                  <${inputs.demo.element}></${inputs.demo.element}>
              `
            : state.currentEngine?.engine
              ? html`
                    <${AnthaUi.assign({
                        engine: state.currentEngine.engine,
                    })}></${AnthaUi}>
                `
              : nothing;

        return html`
            <${ViraLink.assign({
                route: {
                    router: inputs.router,
                    route: {
                        paths: [],
                    },
                },
            })}
                class="overlay"
            >
                ← Back
            </${ViraLink}>
            ${content}
        `;
    },
});
