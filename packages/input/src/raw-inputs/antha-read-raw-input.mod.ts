import {defineAnthaMod, html} from '@antha/engine';
import {mapObject, type SelectFrom, type SetRequired, type Values} from '@augment-vir/common';
import {
    defaultGamepadLayouts,
    defaultGamepadModelMap,
    findMatchingGamepadLayout,
    findMatchingGamepadModel,
} from 'gamepad-type';
import {InputDeviceHandler, isGamepadDeviceKey, type InputDeviceKey} from 'input-device-handler';
import {AnthaRawInputDebug} from './antha-raw-input-debug.element.js';
import {
    calculateInputDirection,
    mapToSimpleDevicesMap,
    type AnthaReadRawInputModOptions,
    type AnthaReadRawInputModState,
    type RawInput,
    type RawInputs,
    type SimpleInputDevicesMap,
} from './raw-input.js';

/**
 * A pre-built mod that reads all current devices and device inputs and sets both on the state.
 *
 * @category Pre-Built Mods
 */
export function createAnthaReadRawInputMod(options: Readonly<AnthaReadRawInputModOptions> = {}) {
    return defineAnthaMod<AnthaReadRawInputModState>({
        modName: 'antha-read-raw-input',
        execute({state, msSinceLastExecute}) {
            if (options.debugRawInputs != undefined && state.debugRawInputs == undefined) {
                state.debugRawInputs = options.debugRawInputs;
            }

            if (!state.deviceHandler) {
                state.deviceHandler =
                    options.deviceHandler ||
                    new InputDeviceHandler({
                        startLoopImmediately: true,
                        ...options.deviceHandlerOptions,
                    });
            }

            const {currentDevices, rawInputs} = readRawInputs(
                state as SetRequired<typeof state, 'deviceHandler'>,
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

export type AnthaReadRawInputMod = ReturnType<typeof createAnthaReadRawInputMod>;

export function readRawInputs(
    state: SetRequired<
        SelectFrom<
            Partial<AnthaReadRawInputModState>,
            {
                rawInputs: true;
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
        /**
         * `mapObject` thinks that `rawDevice` is potentially `undefined` but it is wrong because
         * the input type uses `Partial`, not `| undefined`.
         */
        if (!device) {
            return;
        }

        const deviceInputs: Values<RawInputs> = {};

        Object.values(device.currentInputs).forEach((currentInput) => {
            const direction = calculateInputDirection(currentInput.inputValue);

            const previousRawInput = state.rawInputs?.[deviceKey]?.[currentInput.inputName];

            const duration =
                previousRawInput?.direction === direction
                    ? {
                          milliseconds: Math.round(
                              previousRawInput.duration.milliseconds + msSinceLastExecute,
                          ),
                      }
                    : {
                          milliseconds: 0,
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

            const rawInput: RawInput = {
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
            };

            if (mappedInputName) {
                deviceInputs[mappedInputName] = rawInput;
            }

            deviceInputs[currentInput.inputName] = rawInput;
        });

        return {
            key: deviceKey,
            value: deviceInputs,
        };
    });

    const simpleDevices: SimpleInputDevicesMap = mapToSimpleDevicesMap(currentDevices);

    return {
        rawInputs,
        currentDevices,
    };
}
