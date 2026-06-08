import {assert} from '@augment-vir/assert';
import {describe, it, testWeb} from '@augment-vir/test';
import {html} from 'element-vir';
import {InputDirection} from '../raw-inputs/raw-input.js';
import {AnthaBindingAssignmentsDebug} from './antha-binding-assignments-debug.element.js';

describe(AnthaBindingAssignmentsDebug.tagName, () => {
    it('renders with undefined binding assignments', async () => {
        const fixture = await testWeb.render(html`
            <${AnthaBindingAssignmentsDebug.assign({
                bindingAssignments: undefined,
            })}></${AnthaBindingAssignmentsDebug}>
        `);

        assert.instanceOf(fixture, AnthaBindingAssignmentsDebug);

        testWeb.cleanupRender();
    });

    it('renders with keyboard binding assignments', async () => {
        const fixture = await testWeb.render(html`
            <${AnthaBindingAssignmentsDebug.assign({
                bindingAssignments: {
                    '1': {
                        moveUp: [
                            {
                                deviceKey: 'keyboard',
                                inputName: 'button-keyW',
                                direction: InputDirection.Positive,
                            },
                        ],
                    },
                },
            })}></${AnthaBindingAssignmentsDebug}>
        `);

        assert.instanceOf(fixture, AnthaBindingAssignmentsDebug);

        testWeb.cleanupRender();
    });

    it('renders with gamepad binding assignments', async () => {
        const fixture = await testWeb.render(html`
            <${AnthaBindingAssignmentsDebug.assign({
                bindingAssignments: {
                    '1': {
                        moveUp: [
                            {
                                deviceKey: '0',
                                inputName: 'button-12',
                                direction: InputDirection.Positive,
                            },
                        ],
                    },
                },
            })}></${AnthaBindingAssignmentsDebug}>
        `);

        assert.instanceOf(fixture, AnthaBindingAssignmentsDebug);

        testWeb.cleanupRender();
    });

    it('renders with empty binding assignments', async () => {
        const fixture = await testWeb.render(html`
            <${AnthaBindingAssignmentsDebug.assign({
                bindingAssignments: {},
            })}></${AnthaBindingAssignmentsDebug}>
        `);

        assert.instanceOf(fixture, AnthaBindingAssignmentsDebug);

        testWeb.cleanupRender();
    });
});
