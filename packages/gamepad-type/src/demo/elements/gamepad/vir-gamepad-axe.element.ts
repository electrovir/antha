import {css, defineElement, html} from 'element-vir';
import {type GamepadInputDetails} from 'input-device-handler';
import {noNativeSpacing} from 'vira';
import {type GamepadLayout} from '../../../index.js';
import {getGamepadBrandColor} from '../../gamepad-brand-color.js';

export const VirGamepadAxe = defineElement<{
    gamepadInput: Readonly<GamepadInputDetails>;
    gamepadBrand: string | undefined;
    gamepadLayout: Readonly<GamepadLayout> | undefined;
}>()({
    tagName: 'vir-gamepad-axe',
    cssVars: {
        'vir-gamepad-axe-color': getGamepadBrandColor(undefined),
    },
    styles: ({cssVars}) => {
        return css`
            :host {
                display: block;
                width: 200px;
                border: 2px solid ${cssVars['vir-gamepad-axe-color'].value};
                text-align: center;
                position: relative;
                background-color: white;
            }

            .progress {
                z-index: 1;
                position: absolute;
                top: 0;
                bottom: 0;
                left: 50%;
                right: 50%;
                border: 1px solid ${cssVars['vir-gamepad-axe-color'].value};
                background-color: ${cssVars['vir-gamepad-axe-color'].value};
            }

            p {
                ${noNativeSpacing};
                position: relative;
                z-index: 10;
            }
        `;
    },
    render({inputs, host}) {
        host.style.setProperty(
            '--vir-gamepad-axe-color',
            getGamepadBrandColor(inputs.gamepadBrand),
        );

        const progressPercents =
            inputs.gamepadInput.value >= 0
                ? {
                      left: 50,
                      right: 50 - inputs.gamepadInput.value * 50,
                  }
                : {
                      left: 50 + inputs.gamepadInput.value * 50,
                      right: 50,
                  };

        const progressStyle = css`
            left: ${progressPercents.left}%;
            right: ${progressPercents.right}%;
        `;
        const inputName =
            inputs.gamepadLayout?.inputMappings[inputs.gamepadInput.inputName] ||
            inputs.gamepadInput.inputName;

        return html`
            <div class="progress" style=${progressStyle}></div>
            <p class="axe-words">${inputName}</p>
            <p>${inputs.gamepadInput.value.toFixed(1)}</p>
        `;
    },
});
