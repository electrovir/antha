import {mapObjectValues, type SelectFrom} from '@augment-vir/common';
import {type Duration, type DurationUnit} from 'date-vir';
import {
    type AllDevices,
    type InputDevice,
    type InputDeviceKey,
    type InputValueWrapper,
} from 'input-device-handler';

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
 * An individual raw input. Used in `createAnthaReadRawInputMod` and {@link RawInputs}.
 *
 * @category Internal
 */
export type RawInput = Omit<InputValueWrapper<InputDeviceKey, any>, 'details'> & {
    /** An identifier set by a game when it claims this input. */
    consumedBy: string | undefined;
    /** True when this input belongs to a different raw input consumer. */
    isIgnoredByConsumer: boolean;
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
 * All raw inputs for all devices. Used in `createAnthaReadRawInputMod` and
 * `AnthaReadRawInputModState`.
 *
 * @category Internal
 */
export type RawInputs = Partial<Record<InputDeviceKey, {[InputName in string]: RawInput}>>;

/**
 * An input device object. A simpler version of `InputDevice` from the [`input-device-handler`
 * package](https://www.npmjs.com/package/input-device-handler). Used in
 * `createAnthaReadRawInputMod` and {@link SimpleInputDevicesMap}.
 *
 * @category Internal
 */
export type SimpleInputDevice = Pick<InputDevice, 'deviceKey' | 'deviceName' | 'deviceType'>;

/**
 * A collection of all current simple input devices. Used in `createAnthaReadRawInputMod` and
 * `AnthaReadRawInputModState`.
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
