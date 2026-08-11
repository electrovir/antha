import {classMap, css, defineElement, html} from 'element-vir';
import {DeviceInputType, type GamepadInputDetails} from 'input-device-handler';
import {type GamepadLayout} from '../../../index.js';
import {getGamepadBrandColor} from '../../gamepad-brand-color.js';

export const VirGamepadButton = defineElement<{
    gamepadInput: Readonly<GamepadInputDetails>;
    gamepadBrand: string | undefined;
    gamepadLayout: Readonly<GamepadLayout> | undefined;
}>()({
    tagName: 'vir-gamepad-button',
    cssVars: {
        'vir-gamepad-button-button-size': '75px',
        'vir-gamepad-button-color': getGamepadBrandColor(undefined),
    },
    styles: ({cssVars}) => css`
        :host {
            display: flex;
            position: relative;
            height: ${cssVars['vir-gamepad-button-button-size'].value};
            width: ${cssVars['vir-gamepad-button-button-size'].value};
            border: 2px solid ${cssVars['vir-gamepad-button-color'].value};
            box-sizing: border-box;
            border-radius: 50%;
        }

        .button-fill-wrapper {
            box-sizing: border-box;
            position: absolute;
            top: -1px;
            left: -1px;
            width: calc(100% + 2px);
            height: calc(100% + 2px);
            display: flex;
            justify-content: center;
            align-items: center;
        }

        .button-fill {
            box-sizing: border-box;
            width: 0%;
            height: 0%;
            pointer-events: none;
            opacity: 1;
            border-radius: 50%;
            background-color: ${cssVars['vir-gamepad-button-color'].value};
            border: 2px solid ${cssVars['vir-gamepad-button-color'].value};
            z-index: 1;
        }

        .no-fill {
            opacity: 0;
        }

        .button-name {
            z-index: 4;
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
        }
    `,
    render({inputs, host}) {
        if (inputs.gamepadInput.inputType !== DeviceInputType.Button) {
            throw new Error(`
                Incorrect input type '${inputs.gamepadInput.inputType}': expected
                '${DeviceInputType.Button}'.
            `);
        }
        host.style.setProperty(
            '--vir-gamepad-button-color',
            getGamepadBrandColor(inputs.gamepadBrand),
        );
        const buttonFillStyle = css`
            width: ${inputs.gamepadInput.value * 100}%;
            height: ${inputs.gamepadInput.value * 100}%;
        `;
        const inputName =
            inputs.gamepadLayout?.inputMappings[inputs.gamepadInput.inputName] ||
            inputs.gamepadInput.inputName;

        return html`
            <div class="button-fill-wrapper">
                <div
                    class="button-fill ${classMap({
                        'no-fill': !inputs.gamepadInput.value,
                    })}"
                    style=${buttonFillStyle}
                ></div>
            </div>
            <div class="button-name">${inputName}</div>
        `;
    },
});
