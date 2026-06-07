import {defineElement, html} from 'element-vir';
import {allDemos, allDemosByPathKey} from '../../data/all-demos.js';
import {createDemoRouter, defaultDemoRoute} from '../../data/demo-router.js';
import {AnthaDemoPage} from './antha-demo-page.element.js';
import {AnthaDemoPicker} from './antha-demo-picker.element.js';

export const AnthaDemoApp = defineElement()({
    tagName: 'antha-demo-app',
    state() {
        return {
            router: createDemoRouter(),
            currentRoute: defaultDemoRoute,
            cleanup: undefined as undefined | (() => void),
        };
    },
    init({state, updateState}) {
        state.cleanup?.();

        const unlistenToRoute = state.router.listen(true, (newRoute) => {
            updateState({
                currentRoute: newRoute,
            });
        });

        updateState({
            cleanup() {
                unlistenToRoute();
            },
        });
    },
    cleanup({state, updateState}) {
        state.cleanup?.();
        updateState({
            cleanup: undefined,
        });
    },
    render({state}) {
        const demoPathId = state.currentRoute.paths[0];
        const chosenDemo = (demoPathId && allDemosByPathKey[demoPathId]) || undefined;

        if (chosenDemo) {
            const demoNumber = allDemos.indexOf(chosenDemo) + 1;
            globalThis.document.title = `Antha Demo: ${demoNumber} ${chosenDemo.demoName}`;

            return html`
                <${AnthaDemoPage.assign({
                    demo: chosenDemo,
                    router: state.router,
                })}></${AnthaDemoPage}>
            `;
        } else {
            globalThis.document.title = 'Antha Demo';

            return html`
                <${AnthaDemoPicker.assign({
                    router: state.router,
                })}></${AnthaDemoPicker}>
            `;
        }
    },
});
