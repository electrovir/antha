import {assert} from '@augment-vir/assert';
import {describe, it, testWeb} from '@augment-vir/test';
import {html} from 'element-vir';
import {InputDeviceKey, InputDeviceType} from 'input-device-handler';
import {AnthaRawInputDebug} from './antha-raw-input-debug.element.js';
import {InputDirection} from './raw-input.js';

describe(AnthaRawInputDebug.tagName, () => {
    it('renders with empty inputs', async () => {
        const fixture = await testWeb.render(html`
            <${AnthaRawInputDebug.assign({
                rawInputs: {},
            })}></${AnthaRawInputDebug}>
        `);

        assert.instanceOf(fixture, AnthaRawInputDebug);

        testWeb.cleanupRender();
    });

    it('renders devices with inputs', async () => {
        const fixture = await testWeb.render(html`
            <${AnthaRawInputDebug.assign({
                rawInputs: {
                    keyboard: {
                        'button-keyW': {
                            consumedBy: undefined,
                            isIgnoredByConsumer: false,
                            inputName: 'button-keyW',
                            inputValue: 1,
                            direction: InputDirection.Positive,
                            duration: {
                                milliseconds: 100,
                            },
                            deviceKey: InputDeviceKey.Keyboard,
                            deviceName: 'keyboard',
                            deviceType: InputDeviceType.Keyboard,
                            mapped: {
                                deviceName: 'keyboard',
                                inputName: 'button-keyW',
                                gamepadBrand: undefined,
                            },
                        },
                    },
                },
            })}></${AnthaRawInputDebug}>
        `);

        assert.instanceOf(fixture, AnthaRawInputDebug);

        testWeb.cleanupRender();
    });

    it('renders devices with no current values', async () => {
        const fixture = await testWeb.render(html`
            <${AnthaRawInputDebug.assign({
                rawInputs: {
                    keyboard: {},
                },
            })}></${AnthaRawInputDebug}>
        `);

        assert.instanceOf(fixture, AnthaRawInputDebug);

        testWeb.cleanupRender();
    });
});
