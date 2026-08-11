import {css, defineElement, html} from 'element-vir';
import {DeviceInputType, type GamepadInputDetails} from 'input-device-handler';
import {type GamepadLayout} from '../../../index.js';
import {VirGamepadAxe} from './vir-gamepad-axe.element.js';
import {VirGamepadButton} from './vir-gamepad-button.element.js';

export const VirGamepadInput = defineElement<{
    gamepadInput: Readonly<GamepadInputDetails>;
    gamepadBrand: string | undefined;
    gamepadLayout: Readonly<GamepadLayout> | undefined;
}>()({
    tagName: 'vir-gamepad-input',
    hostClasses: {
        'vir-gamepad-input-circle': ({inputs}) =>
            inputs.gamepadInput.inputType === DeviceInputType.Button,
    },
    styles: ({hostClasses}) => css`
        :host {
            display: flex;
        }

        ${hostClasses['vir-gamepad-input-circle'].selector} {
            border-radius: 50%;
        }
    `,
    render({inputs}) {
        if (inputs.gamepadInput.inputType === DeviceInputType.Axe) {
            return html`
                <${VirGamepadAxe.assign(inputs)}></${VirGamepadAxe}>
            `;
        } else if ((inputs.gamepadInput.inputType as DeviceInputType) === DeviceInputType.Button) {
            return html`
                <${VirGamepadButton.assign(inputs)}></${VirGamepadButton}>
            `;
        } else {
            return `Invalid gamepad type received: ${inputs.gamepadInput.inputType}`;
        }
    },
});
