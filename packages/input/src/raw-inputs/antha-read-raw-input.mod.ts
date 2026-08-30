import {defineAnthaMod} from '@antha/engine';
import {
    defaultGamepadLayouts,
    defaultGamepadModelMap,
    findMatchingGamepadLayout,
    findMatchingGamepadModel,
    modelInputNameOverrides,
    type GamepadBrandMap,
    type GamepadLayout,
    type GamepadModelMap,
} from '@antha/gamepad-type';
import {assertWrap, check} from '@augment-vir/assert';
import {
    mapObject,
    type PartialWithUndefined,
    type SelectFrom,
    type SetRequired,
    type Values,
} from '@augment-vir/common';
import {html} from 'element-vir';
import {
    InputDeviceHandler,
    isGamepadDeviceKey,
    type InputDeviceHandlerOptions,
    type InputDeviceKey,
} from 'input-device-handler';
import {AnthaRawInputDebug} from './antha-raw-input-debug.element.js';
import {
    calculateInputDirection,
    mapToSimpleDevicesMap,
    type RawInput,
    type RawInputs,
    type SimpleInputDevicesMap,
} from './raw-input.js';

/**
 * Options for {@link createAnthaReadRawInputMod}.
 *
 * @category Internal
 */
export type AnthaReadRawInputModOptions = PartialWithUndefined<{
    /**
     * A device handler to insert into the game state. If not provided, the mod will create a device
     * handler on its own.
     */
    deviceHandler: AnthaReadRawInputModState['deviceHandler'];
    /**
     * Used only when constructing an internal deviceHandler, which only happens if `deviceHandler`
     * is not provided in these options.
     */
    deviceHandlerOptions: Omit<InputDeviceHandlerOptions, 'startLoopImmediately'>;
    debugRawInputs: AnthaReadRawInputModState['debugRawInputs'];
    startRawInputConsumer: AnthaReadRawInputModState['rawInputConsumer'];
}>;

/**
 * All state used by and set by `createAnthaReadRawInputMod`.
 *
 * @category Internal
 */
export type AnthaReadRawInputModState = {
    deviceHandler: Pick<InputDeviceHandler, 'readAllDevices'>;
    rawInputs: RawInputs;
    /** Identifies the part of the game that owns newly started raw inputs. */
    rawInputConsumer: string | undefined;
    currentInputDevices: SimpleInputDevicesMap;
    /**
     * If no model map is provided, the built-in defaults from
     * [gamepad-type](https://www.npmjs.com/package/gamepad-type) are used. If a model map is
     * provided, make sure to also include the default model map (`defaultGamepadModelMap` from
     * gamepad-type) if you want it (as it will not be automatically appended to your provided
     * map).
     */
    gamepadModelMap: GamepadModelMap;
    /**
     * If no gamepad layouts are provided, the built-in defaults from
     * [gamepad-type](https://www.npmjs.com/package/gamepad-type) are used. If layouts are provided,
     * make sure to also include the default layouts (`defaultGamepadLayouts` from gamepad-type) if
     * you want them (as they will not be automatically appended to your provided layouts).
     */
    gamepadLayouts: GamepadLayout[];
    /**
     * If no brand map is provided, the built-in defaults from
     * [gamepad-type](https://www.npmjs.com/package/gamepad-type) are used. If a brand map is
     * provided, make sure to also include the default brand map (`defaultGamepadBrandMap` from
     * gamepad-type) if you want it (as it will not be automatically appended to your provided
     * map).
     */
    gamepadBrandMap: GamepadBrandMap;
    /** If set to true, raw inputs are printed on the screen. */
    debugRawInputs: boolean;
};

/**
 * A pre-built mod that reads all current devices and device inputs and sets both on the state.
 *
 * @category Pre-Built Mods
 */
export function createAnthaReadRawInputMod(options: Readonly<AnthaReadRawInputModOptions> = {}) {
    return defineAnthaMod<AnthaReadRawInputModState>({
        modName: 'antha-read-raw-input',
        initState: {
            debugRawInputs: !!options.debugRawInputs,
            rawInputConsumer: options.startRawInputConsumer,
        },
        execute({state, msSinceLastExecute}) {
            if (!state.deviceHandler) {
                state.deviceHandler =
                    options.deviceHandler ||
                    new InputDeviceHandler({
                        ...options.deviceHandlerOptions,
                        startLoopImmediately: false,
                    });
            }

            const {currentDevices, rawInputs} = readRawInputs(
                {
                    ...state,
                    deviceHandler: assertWrap.isDefined(state.deviceHandler),
                },
                {
                    msSinceLastExecute,
                },
            );
            state.rawInputs = rawInputs;
            state.currentInputDevices = currentDevices;

            if (state.debugRawInputs) {
                return html`
                    <${AnthaRawInputDebug.assign({
                        rawInputs: state.rawInputs,
                    })}></${AnthaRawInputDebug}>
                `;
            } else {
                return undefined;
            }
        },
    });
}

/**
 * The mod returned by {@link createAnthaReadRawInputMod}.
 *
 * @category Internal
 */
export type AnthaReadRawInputMod = ReturnType<typeof createAnthaReadRawInputMod>;

/**
 * Reads raw inputs from a `InputDeviceHandler`. This is the core internals of
 * {@link createAnthaReadRawInputMod}.
 *
 * @category Internal
 */
export function readRawInputs(
    state: SetRequired<
        SelectFrom<
            Partial<AnthaReadRawInputModState>,
            {
                rawInputs: true;
                rawInputConsumer: true;
                deviceHandler: true;
                gamepadLayouts: true;
                gamepadBrandMap: true;
                gamepadModelMap: true;
            }
        >,
        'deviceHandler'
    >,
    {
        msSinceLastExecute,
    }: Readonly<{
        msSinceLastExecute: number;
    }>,
) {
    const currentDevices = state.deviceHandler.readAllDevices();

    const rawInputs: RawInputs = mapObject(currentDevices, (deviceKey: InputDeviceKey, device) => {
        const deviceInputs: Values<RawInputs> = {};

        Object.values(device.currentInputs).forEach((currentInput) => {
            const direction = calculateInputDirection(currentInput.inputValue);

            const potentialPreviousRawInput =
                state.rawInputs?.[deviceKey]?.[currentInput.inputName];
            const previousRawInput =
                potentialPreviousRawInput?.direction === direction
                    ? potentialPreviousRawInput
                    : undefined;
            const consumedBy = previousRawInput
                ? previousRawInput.consumedBy
                : state.rawInputConsumer;

            const duration = {
                milliseconds: previousRawInput
                    ? Math.round(previousRawInput.duration.milliseconds + msSinceLastExecute)
                    : 0,
            };

            const layout = isGamepadDeviceKey(deviceKey)
                ? findMatchingGamepadLayout({
                      layouts: state.gamepadLayouts || defaultGamepadLayouts,
                      gamepad: {
                          deviceName: device.deviceName,
                      },
                      gamepadModelMap: state.gamepadModelMap || defaultGamepadModelMap,
                  })
                : undefined;

            const model = isGamepadDeviceKey(deviceKey)
                ? findMatchingGamepadModel({
                      gamepad: {
                          deviceName: device.deviceName,
                      },
                      gamepadBrandMap: state.gamepadBrandMap,
                      gamepadModelMap: state.gamepadModelMap,
                  })
                : undefined;

            const mappedInputName: string | undefined =
                layout?.inputMappings[currentInput.inputName];
            const modelInputName = getModelInputNameOverride({
                mappedInputName,
                gamepadModel: model?.gamepadModel,
            });

            const rawInput: RawInput = {
                consumedBy,
                mapped: {
                    deviceName: model?.gamepadModel || device.deviceName,
                    gamepadBrand: model?.gamepadBrand,
                    inputName: mappedInputName || currentInput.inputName,
                },
                deviceKey,
                deviceName: device.deviceName,
                deviceType: device.deviceType,
                direction,
                duration,
                inputName: currentInput.inputName,
                inputValue: currentInput.inputValue,
                isIgnoredByConsumer:
                    !!state.rawInputConsumer &&
                    !!consumedBy &&
                    consumedBy !== state.rawInputConsumer,
            };

            if (mappedInputName) {
                deviceInputs[mappedInputName] = rawInput;
            }
            if (modelInputName) {
                deviceInputs[modelInputName] = rawInput;
            }

            deviceInputs[currentInput.inputName] = rawInput;
        });

        return {
            key: deviceKey,
            value: deviceInputs,
        };
    });

    return {
        rawInputs,
        currentDevices: mapToSimpleDevicesMap(currentDevices),
    };
}

function getModelInputNameOverride({
    mappedInputName,
    gamepadModel,
}: Readonly<{
    mappedInputName: string | undefined;
    gamepadModel: string | undefined;
}>): string | undefined {
    if (
        !mappedInputName ||
        !gamepadModel ||
        !check.isKeyOf(gamepadModel, modelInputNameOverrides)
    ) {
        return undefined;
    }

    const inputNameOverrides = modelInputNameOverrides[gamepadModel];

    return check.isKeyOf(mappedInputName, inputNameOverrides)
        ? inputNameOverrides[mappedInputName]
        : undefined;
}
