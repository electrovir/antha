import {html} from '@antha/engine';
import {assert} from '@augment-vir/assert';
import {describe, it, testWeb} from '@augment-vir/test';
import {AnthaActiveBindingsDebug} from './antha-active-bindings-debug.element.js';

describe(AnthaActiveBindingsDebug.tagName, () => {
    it('renders with undefined active bindings', async () => {
        const fixture = await testWeb.render(html`
            <${AnthaActiveBindingsDebug.assign({
                activeBindings: undefined,
            })}></${AnthaActiveBindingsDebug}>
        `);

        assert.instanceOf(fixture, AnthaActiveBindingsDebug);

        testWeb.cleanupRender();
    });

    it('renders with active bindings', async () => {
        const fixture = await testWeb.render(html`
            <${AnthaActiveBindingsDebug.assign({
                activeBindings: {
                    '1': {
                        moveUp: {
                            holdDuration: {
                                milliseconds: 100,
                            },
                            value: 1,
                            lastActDuration: {
                                milliseconds: 0,
                            },
                            actCount: 0,
                        },
                    },
                },
            })}></${AnthaActiveBindingsDebug}>
        `);

        assert.instanceOf(fixture, AnthaActiveBindingsDebug);

        testWeb.cleanupRender();
    });

    it('renders with empty active bindings', async () => {
        const fixture = await testWeb.render(html`
            <${AnthaActiveBindingsDebug.assign({
                activeBindings: {},
            })}></${AnthaActiveBindingsDebug}>
        `);

        assert.instanceOf(fixture, AnthaActiveBindingsDebug);

        testWeb.cleanupRender();
    });
});
