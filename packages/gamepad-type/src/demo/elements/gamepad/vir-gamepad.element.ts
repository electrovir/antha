import {css, defineElement, html} from 'element-vir';
import {type GamepadDevice} from 'input-device-handler';
import {type GamepadLayout, type GamepadModelMap} from '../../../index.js';
import {VirGamepadInputs} from './vir-gamepad-inputs.element.js';
import {VirGamepadName} from './vir-gamepad-name.element.js';

export const VirGamepad = defineElement<{
    gamepad: Readonly<GamepadDevice>;
    gamepadIndex: number;
    gamepadLayout: Readonly<GamepadLayout> | undefined;
    gamepadModelMap: Readonly<GamepadModelMap>;
}>()({
    tagName: 'vir-gamepad',
    styles: css`
        :host {
            display: flex;
            background-color: white;
            color: black;
            gap: 16px;
            flex-wrap: wrap;
            align-items: flex-start;
        }

        ${VirGamepadName} {
            flex-grow: 1;
            flex-basis: 600px;
        }

        ${VirGamepadInputs} {
            flex-grow: 1000000;
            flex-shrink: 1;
            flex-basis: 300px;
        }
    `,
    render({inputs}) {
        return html`
            <${VirGamepadName.assign({
                gamepad: inputs.gamepad,
                gamepadIndex: inputs.gamepadIndex,
                gamepadModelMap: inputs.gamepadModelMap,
            })}></${VirGamepadName}>
            <${VirGamepadInputs.assign({
                gamepad: inputs.gamepad,
                gamepadLayout: inputs.gamepadLayout,
                gamepadModelMap: inputs.gamepadModelMap,
            })}></${VirGamepadInputs}>
        `;
    },
});
