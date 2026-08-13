import {getObjectTypedKeys} from '@augment-vir/common';
import {css, defineElement, defineElementEvent, html, listen} from 'element-vir';
import {type GamepadDevice, type GamepadInputValue} from 'input-device-handler';
import {
    type GamepadLayout,
    type GamepadModelMap,
    findMatchingGamepadModel,
} from '../../../index.js';
import {VirGamepadInput} from './vir-gamepad-input.element.js';

export const VirGamepadInputs = defineElement<{
    gamepad: Readonly<GamepadDevice>;
    gamepadLayout: Readonly<GamepadLayout> | undefined;
    gamepadModelMap: Readonly<GamepadModelMap>;
}>()({
    tagName: 'vir-gamepad-inputs',
    events: {
        gamepadInputClick: defineElementEvent<Readonly<GamepadInputValue>>(),
    },
    styles: css`
        :host {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .inputs {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }

        ${VirGamepadInput} {
            cursor: pointer;
            border: 1px solid transparent;
        }

        ${VirGamepadInput}:hover {
            border-color: black;
        }

        .prefix.warning {
            color: red;
        }

        .prefix {
            font-weight: bold;
        }

        .prefix.info {
            color: dodgerblue;
        }
    `,
    render({inputs, dispatch, events}) {
        const {gamepadBrand} = findMatchingGamepadModel({
            gamepad: inputs.gamepad.deviceName,
            gamepadModelMap: inputs.gamepadModelMap,
        });

        const buttons = inputs.gamepad.deviceDetails.buttons.map((gamepadInput) => {
            return html`
                <${VirGamepadInput.assign({
                    gamepadBrand,
                    gamepadInput,
                    gamepadLayout: inputs.gamepadLayout,
                })}
                    ${listen('click', () => {
                        dispatch(
                            new events.gamepadInputClick({
                                details: gamepadInput,
                                deviceKey: inputs.gamepad.deviceKey,
                                deviceName: inputs.gamepad.deviceName,
                                deviceType: inputs.gamepad.deviceType,
                                inputName: gamepadInput.inputName,
                                inputValue: gamepadInput.value,
                            }),
                        );
                    })}
                ></${VirGamepadInput}>
            `;
        });

        const axes = inputs.gamepad.deviceDetails.axes.map((gamepadInput) => {
            return html`
                <${VirGamepadInput.assign({
                    gamepadBrand,
                    gamepadInput,
                    gamepadLayout: inputs.gamepadLayout,
                })}
                    ${listen('click', () => {
                        dispatch(
                            new events.gamepadInputClick({
                                details: gamepadInput,
                                deviceKey: inputs.gamepad.deviceKey,
                                deviceName: inputs.gamepad.deviceName,
                                deviceType: inputs.gamepad.deviceType,
                                inputName: gamepadInput.inputName,
                                inputValue: gamepadInput.value,
                            }),
                        );
                    })}
                ></${VirGamepadInput}>
            `;
        });

        const notesTemplate = inputs.gamepadLayout?.notes
            ? getObjectTypedKeys(inputs.gamepadLayout.notes).map((noteType) => {
                  const note = inputs.gamepadLayout?.notes?.[noteType];

                  if (!note) {
                      return '';
                  }

                  const prefix = noteType === 'info' ? 'Note' : 'WARNING';

                  return html`
                      <p class="notes">
                          <span class="prefix ${noteType}">${prefix}:</span>
                          ${note}
                      </p>
                  `;
              })
            : '';

        return html`
            ${notesTemplate}
            <div class="inputs">${buttons}</div>
            <div class="inputs">${axes}</div>
        `;
    },
});
