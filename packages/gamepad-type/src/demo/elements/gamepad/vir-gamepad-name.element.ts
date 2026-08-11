import {assert} from '@augment-vir/assert';
import {getEnumValues, getObjectTypedValues} from '@augment-vir/common';
import {css, defineElement, defineElementEvent, html, listen, onDomCreated} from 'element-vir';
import {type GamepadDevice} from 'input-device-handler';
import {noNativeFormStyles, noNativeSpacing} from 'vira';
import {
    type GamepadModelMap,
    PredefinedGamepadModel,
    findMatchingGamepadModel,
} from '../../../index.js';
import {getGamepadBrandColor} from '../../gamepad-brand-color.js';
import {kebabCaseToNameCase} from '../../util/casing.js';

const createNewGamepadModelValue = 'create new gamepad model';

export const VirGamepadName = defineElement<{
    gamepad: Readonly<GamepadDevice>;
    gamepadIndex: number;
    gamepadModelMap: Readonly<GamepadModelMap>;
}>()({
    tagName: 'vir-gamepad-name',
    cssVars: {
        'vir-gamepad-name-gamepad-brand-color': getGamepadBrandColor(undefined),
    },
    events: {
        editMappingsClick: defineElementEvent<void>(),
        gamepadModelOverride: defineElementEvent<string>(),
        createNewModel: defineElementEvent<void>(),
    },
    styles: ({cssVars}) => css`
        :host {
            border-radius: 24px;
            padding: 32px;
            gap: 16px;
            display: flex;
            flex-direction: column;
            background-color: ${cssVars['vir-gamepad-name-gamepad-brand-color'].value};
            border: 2px solid ${cssVars['vir-gamepad-name-gamepad-brand-color'].value};
            background-image: linear-gradient(
                hsla(0, 0%, 100%, 0.8),
                hsla(0, 0%, 100%, 0) 75px,
                hsla(0, 0%, 0%, 0.01) 75px,
                hsla(0, 0%, 100%, 0)
            );
            text-shadow: 0 2px 4px hsla(0, 0%, 100%, 0.7);
            box-shadow: inset 0 5px 20px hsla(0, 0%, 100%, 0.9);
        }

        h2,
        p {
            ${noNativeSpacing}
        }

        h2 {
            font-size: 2em;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .subtitle {
            color: #575757;
        }

        .subtitle:hover {
            color: black;
        }

        button {
            ${noNativeFormStyles};
            align-self: center;
            transition: 100ms;
            border: 1px solid ${cssVars['vir-gamepad-name-gamepad-brand-color'].value};
            background-color: white;
            padding: 4px 8px;
            font: inherit;
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
        }

        button:hover,
        button:active {
            color: ${cssVars['vir-gamepad-name-gamepad-brand-color'].value};
            background-color: black;
        }

        select {
            ${noNativeFormStyles};
            flex-grow: 1;
            padding: 2px 4px;
            cursor: pointer;
            width: 0;
            font: inherit;
        }
    `,
    render({inputs, host, dispatch, events}) {
        const {gamepadBrand, gamepadModel, gamepadModelDescription} = findMatchingGamepadModel({
            gamepad: inputs.gamepad,
            gamepadModelMap: inputs.gamepadModelMap,
        });
        host.style.setProperty(
            '--vir-gamepad-name-gamepad-brand-color',
            getGamepadBrandColor(gamepadBrand),
        );

        const gamepadModelOptions: ReadonlyArray<string> = Array.from(
            new Set([
                ...getEnumValues(PredefinedGamepadModel),
                ...getObjectTypedValues(inputs.gamepadModelMap),
            ]),
        );

        const gamepadTypeSelectTemplate = html`
            <select
                ${onDomCreated((element) => {
                    /**
                     * For some Reason the `?selected` attribute on the below `<option>` elements
                     * doesn't work here on Firefox.
                     */
                    assert.instanceOf(element, HTMLSelectElement);

                    if (gamepadModel) {
                        element.value = gamepadModel;
                    }
                })}
                ${listen('change', (event) => {
                    const element = event.currentTarget;
                    assert.instanceOf(element, HTMLSelectElement);
                    const value = element.value;

                    if (value === createNewGamepadModelValue) {
                        dispatch(new events.createNewModel());
                        if (gamepadModel) {
                            element.value = gamepadModel;
                        } else {
                            element.value = '';
                        }
                    } else {
                        dispatch(new events.gamepadModelOverride(value));
                    }
                })}
            >
                ${gamepadModelOptions.map(
                    (model) => html`
                        <option ?selected=${gamepadModel === model} value=${model}>
                            ${kebabCaseToNameCase(model)}
                        </option>
                    `,
                )}
                <option value=${createNewGamepadModelValue}>&gt; Enter New Gamepad Model</option>
            </select>
        `;

        return html`
            <h2>
                <span>${inputs.gamepadIndex}:</span>
                ${gamepadTypeSelectTemplate}
            </h2>
            <p class="subtitle">
                "${inputs.gamepad.deviceName}"
                <br />
                <br />
                ${gamepadModelDescription}
            </p>
            <button
                ${listen('click', () => {
                    dispatch(new events.editMappingsClick());
                })}
            >
                Edit Mappings
            </button>
        `;
    },
});
