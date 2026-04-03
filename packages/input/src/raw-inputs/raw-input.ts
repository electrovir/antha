import {mapObjectValues, type PartialWithUndefined, type SelectFrom} from '@augment-vir/common';
import {type Duration, type DurationUnit} from 'date-vir';
import {type GamepadBrandMap, type GamepadLayout, type GamepadModelMap} from 'gamepad-type';
import {
    type AllDevices,
    type InputDevice,
    type InputDeviceHandler,
    type InputDeviceHandlerOptions,
    type InputDeviceKey,
    type InputValueWrapper,
} from 'input-device-handler';
import {createAnthaReadRawInputMod} from './antha-read-raw-input.mod.js';

/**
 * All possible directions of an input value.
 *
 * @category Internal
 */
export enum InputDirection {
    /** Right at 0. */
    Flat = 'flat',
    Negative = 'negative',
    Positive = 'positive',
}

/**
 * Calculate the {@link InputDirection} value of an input value.
 *
 * @category Internal
 */
export function calculateInputDirection(inputValue: number): InputDirection {
    if (inputValue === 0) {
        return InputDirection.Flat;
    } else if (inputValue < 0) {
        return InputDirection.Negative;
    } else {
        return InputDirection.Positive;
    }
}

/**
 * An individual raw input. Used in {@link createAnthaReadRawInputMod} and {@link RawInputs}.
 *
 * @category Internal
 */
export type RawInput = Omit<InputValueWrapper<InputDeviceKey, any>, 'details'> & {
    mapped: SelectFrom<
        InputValueWrapper<InputDeviceKey, any>,
        {
            /**
             * `deviceName` is mapped by `gamepadModelMap`. If no mapping exists, this will always
             * be set to the original `deviceName`.
             */
            deviceName: true;
            /**
             * `deviceKey` is mapped by `gamepadLayouts`. If no mapping exists, this will always be
             * set to the original `inputName`.
             */
            inputName: true;
        }
    > & {
        /** This will only be populated for gamepad devices. */
        gamepadBrand: undefined | string;
    };

    /** The raw input's direction. */
    direction: InputDirection;
    /** How long this input has been held down in the current direction. */
    duration: Duration<DurationUnit.Milliseconds>;
};

/**
 * All raw inputs for all devices. Used in {@link createAnthaReadRawInputMod} and
 * {@link AnthaReadRawInputModState}.
 *
 * @category Internal
 */
export type RawInputs = Partial<Record<InputDeviceKey, {[InputName in string]: RawInput}>>;

/**
 * An input device object. A simpler version of `InputDevice` from the [`input-device-handler`
 * package](https://www.npmjs.com/package/input-device-handler). Used in
 * {@link createAnthaReadRawInputMod} and {@link SimpleInputDevicesMap}.
 *
 * @category Internal
 */
export type SimpleInputDevice = Pick<InputDevice, 'deviceKey' | 'deviceName' | 'deviceType'>;

/**
 * A collection of all current simple input devices. Used in {@link createAnthaReadRawInputMod} and
 * {@link AnthaReadRawInputModState}.
 *
 * @category Internal
 */
export type SimpleInputDevicesMap = Partial<Record<InputDeviceKey, SimpleInputDevice>>;

/**
 * Maps `AllDevices` to {@link SimpleInputDevicesMap}.
 *
 * @category Internal
 */
export function mapToSimpleDevicesMap(
    currentDevices: SelectFrom<
        AllDevices,
        {
            [Key in InputDeviceKey]?: {
                deviceName: true;
                deviceType: true;
            };
        }
    >,
): SimpleInputDevicesMap {
    return mapObjectValues(currentDevices, (deviceKey, device): SimpleInputDevice => {
        return {
            deviceKey,
            deviceName: device.deviceName,
            deviceType: device.deviceType,
        };
    });
}

/**
 * All state used by and set by {@link createAnthaReadRawInputMod}.
 *
 * @category Internal
 */
export type AnthaReadRawInputModState = {
    deviceHandler: Pick<InputDeviceHandler, 'readAllDevices'>;
    rawInputs: RawInputs;
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

export type AnthaReadRawInputModOptions = PartialWithUndefined<{
    /**
     * A device handler to insert into the game state. If not provided, the mod will create a device
     * handler on its own.
     */
    deviceHandler: AnthaReadRawInputModState['deviceHandler'];
    /**
     * Used only when constructing an internal deviceHandler, which only happens if `deviceHandler`
     * is not provided in these options. Note that, by default, `startLoopImmediately` is set to
     * `true`.
     */
    deviceHandlerOptions: InputDeviceHandlerOptions;
    debugRawInputs: AnthaReadRawInputModState['debugRawInputs'];
}>;
