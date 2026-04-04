import {describe, itCases} from '@augment-vir/test';
import {InputDeviceKey, InputDeviceType} from 'input-device-handler';
import {calculateInputDirection, InputDirection, mapToSimpleDevicesMap} from './raw-input.js';

describe(calculateInputDirection.name, () => {
    itCases(calculateInputDirection, [
        {
            it: 'returns Flat for zero',
            input: 0,
            expect: InputDirection.Flat,
        },
        {
            it: 'returns Negative for negative values',
            input: -0.5,
            expect: InputDirection.Negative,
        },
        {
            it: 'returns Positive for positive values',
            input: 1,
            expect: InputDirection.Positive,
        },
    ]);
});

describe(mapToSimpleDevicesMap.name, () => {
    itCases(mapToSimpleDevicesMap, [
        {
            it: 'maps devices to simple device objects',
            input: {
                keyboard: {
                    deviceName: 'keyboard',
                    deviceType: InputDeviceType.Keyboard,
                    currentInputs: {},
                    deviceDetails: undefined,
                    deviceKey: InputDeviceKey.Keyboard,
                },
            },
            expect: {
                keyboard: {
                    deviceKey: 'keyboard',
                    deviceName: 'keyboard',
                    deviceType: InputDeviceType.Keyboard,
                },
            },
        },
        {
            it: 'maps multiple devices',
            input: {
                keyboard: {
                    deviceName: 'keyboard',
                    deviceType: InputDeviceType.Keyboard,
                    currentInputs: {},
                    deviceDetails: undefined,
                    deviceKey: InputDeviceKey.Keyboard,
                },
                mouse: {
                    deviceName: 'keyboard',
                    deviceType: InputDeviceType.Mouse,
                    currentInputs: {},
                    deviceDetails: undefined,
                    deviceKey: InputDeviceKey.Mouse,
                },
            },
            expect: {
                keyboard: {
                    deviceKey: 'keyboard',
                    deviceName: 'keyboard',
                    deviceType: InputDeviceType.Keyboard,
                },
                mouse: {
                    deviceKey: 'mouse',
                    deviceName: 'keyboard',
                    deviceType: InputDeviceType.Mouse,
                },
            },
        },
    ]);
});
