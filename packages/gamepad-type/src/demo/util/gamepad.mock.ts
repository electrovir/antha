import {
    DeviceInputType,
    type GamepadDevice,
    GamepadInputDeviceKey,
    InputDeviceType,
} from 'input-device-handler';

const mockSwitchProGamepad: Readonly<GamepadDevice> = {
    currentInputs: {
        'button-0': {
            deviceKey: GamepadInputDeviceKey.Gamepad4,
            deviceName: 'Pro Controller Extended Gamepad',
            deviceType: InputDeviceType.Gamepad,
            details: {
                inputType: DeviceInputType.Button,
                inputName: 'button-0',
                value: 1,
            },
            inputName: 'button-0',
            inputValue: 1,
        },
        'axe-0': {
            deviceKey: GamepadInputDeviceKey.Gamepad4,
            deviceName: 'Pro Controller Extended Gamepad',
            deviceType: InputDeviceType.Gamepad,
            details: {
                inputType: DeviceInputType.Axe,
                inputName: 'axe-0',
                value: 0,
            },
            inputName: 'axe-0',
            inputValue: 0,
        },
        'axe-1': {
            deviceKey: GamepadInputDeviceKey.Gamepad4,
            deviceName: 'Pro Controller Extended Gamepad',
            deviceType: InputDeviceType.Gamepad,
            details: {
                inputType: DeviceInputType.Axe,
                inputName: 'axe-1',
                value: 0,
            },
            inputName: 'axe-1',
            inputValue: 0,
        },
    },
    deviceDetails: {
        deviceKey: GamepadInputDeviceKey.Gamepad4,
        inputsByName: {
            'axe-0': {
                inputName: 'axe-0',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
            'axe-1': {
                inputName: 'axe-1',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
            'axe-2': {
                inputName: 'axe-2',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
            'axe-3': {
                inputName: 'axe-3',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
            'button-0': {
                inputName: 'button-0',
                inputType: DeviceInputType.Button,
                value: 1,
            },
            'button-1': {
                inputName: 'button-1',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-2': {
                inputName: 'button-2',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-3': {
                inputName: 'button-3',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-4': {
                inputName: 'button-4',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-5': {
                inputName: 'button-5',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-6': {
                inputName: 'button-6',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-7': {
                inputName: 'button-7',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-8': {
                inputName: 'button-8',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-9': {
                inputName: 'button-9',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-10': {
                inputName: 'button-10',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-11': {
                inputName: 'button-11',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-12': {
                inputName: 'button-12',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-13': {
                inputName: 'button-13',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-14': {
                inputName: 'button-14',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-15': {
                inputName: 'button-15',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-16': {
                inputName: 'button-16',
                value: 0,
                inputType: DeviceInputType.Button,
            },
        },
        axes: [
            {
                inputName: 'axe-0',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
            {
                inputName: 'axe-1',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
            {
                inputName: 'axe-2',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
            {
                inputName: 'axe-3',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
        ],
        buttons: [
            {
                inputName: 'button-0',
                inputType: DeviceInputType.Button,
                value: 1,
            },
            {
                inputName: 'button-1',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-2',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-3',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-4',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-5',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-6',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-7',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-8',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-9',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-10',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-11',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-12',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-13',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-14',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-15',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-16',
                value: 0,
                inputType: DeviceInputType.Button,
            },
        ],
        isConnected: true,
        gamepadName: 'Pro Controller Extended Gamepad',
        mapping: 'standard',
        serialized: true,
        timestamp: 23_640.422582875,
    },
    deviceName: 'Pro Controller Extended Gamepad',
    deviceKey: GamepadInputDeviceKey.Gamepad4,
    deviceType: InputDeviceType.Gamepad,
};

/** Needs a better mock still */
const mockXboxWirelessGamepad: Readonly<GamepadDevice> = {
    currentInputs: {
        'button-0': {
            deviceKey: GamepadInputDeviceKey.Gamepad4,
            deviceName: 'Xbox Wireless Controller Extended Gamepad',
            deviceType: InputDeviceType.Gamepad,
            details: {
                inputType: DeviceInputType.Button,
                inputName: 'button-0',
                value: 1,
            },
            inputName: 'button-0',
            inputValue: 1,
        },
        'axe-0': {
            deviceKey: GamepadInputDeviceKey.Gamepad4,
            deviceName: 'Xbox Wireless Controller Extended Gamepad',
            deviceType: InputDeviceType.Gamepad,
            details: {
                inputType: DeviceInputType.Axe,
                inputName: 'axe-0',
                value: 0,
            },
            inputName: 'axe-0',
            inputValue: 0,
        },
        'axe-1': {
            deviceKey: GamepadInputDeviceKey.Gamepad4,
            deviceName: 'Xbox Wireless Controller Extended Gamepad',
            deviceType: InputDeviceType.Gamepad,
            details: {
                inputType: DeviceInputType.Axe,
                inputName: 'axe-1',
                value: 0,
            },
            inputName: 'axe-1',
            inputValue: 0,
        },
    },
    deviceDetails: {
        deviceKey: GamepadInputDeviceKey.Gamepad4,
        inputsByName: {
            'axe-0': {
                inputName: 'axe-0',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
            'axe-1': {
                inputName: 'axe-1',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
            'axe-2': {
                inputName: 'axe-2',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
            'axe-3': {
                inputName: 'axe-3',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
            'button-0': {
                inputName: 'button-0',
                inputType: DeviceInputType.Button,
                value: 1,
            },
            'button-1': {
                inputName: 'button-1',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-2': {
                inputName: 'button-2',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-3': {
                inputName: 'button-3',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-4': {
                inputName: 'button-4',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-5': {
                inputName: 'button-5',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-6': {
                inputName: 'button-6',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-7': {
                inputName: 'button-7',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-8': {
                inputName: 'button-8',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-9': {
                inputName: 'button-9',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-10': {
                inputName: 'button-10',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-11': {
                inputName: 'button-11',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-12': {
                inputName: 'button-12',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-13': {
                inputName: 'button-13',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-14': {
                inputName: 'button-14',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-15': {
                inputName: 'button-15',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-16': {
                inputName: 'button-16',
                value: 0,
                inputType: DeviceInputType.Button,
            },
        },
        axes: [
            {
                inputName: 'axe-0',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
            {
                inputName: 'axe-1',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
            {
                inputName: 'axe-2',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
            {
                inputName: 'axe-3',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
        ],
        buttons: [
            {
                inputName: 'button-0',
                inputType: DeviceInputType.Button,
                value: 1,
            },
            {
                inputName: 'button-1',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-2',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-3',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-4',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-5',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-6',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-7',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-8',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-9',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-10',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-11',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-12',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-13',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-14',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-15',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-16',
                value: 0,
                inputType: DeviceInputType.Button,
            },
        ],
        isConnected: true,
        gamepadName: 'Xbox Wireless Controller Extended Gamepad',
        mapping: 'standard',
        serialized: true,
        timestamp: 23_640.422582875,
    },
    deviceName: 'Xbox Wireless Controller Extended Gamepad',
    deviceKey: GamepadInputDeviceKey.Gamepad4,
    deviceType: InputDeviceType.Gamepad,
};

/** Needs a better mock still */
const mockPlayStationDualSenseGamepad: Readonly<GamepadDevice> = {
    currentInputs: {
        'button-0': {
            deviceKey: GamepadInputDeviceKey.Gamepad4,
            deviceName: 'DualSense Wireless Controller Extended Gamepad',
            deviceType: InputDeviceType.Gamepad,
            details: {
                inputType: DeviceInputType.Button,
                inputName: 'button-0',
                value: 1,
            },
            inputName: 'button-0',
            inputValue: 1,
        },
        'axe-0': {
            deviceKey: GamepadInputDeviceKey.Gamepad4,
            deviceName: 'DualSense Wireless Controller Extended Gamepad',
            deviceType: InputDeviceType.Gamepad,
            details: {
                inputType: DeviceInputType.Axe,
                inputName: 'axe-0',
                value: 0,
            },
            inputName: 'axe-0',
            inputValue: 0,
        },
        'axe-1': {
            deviceKey: GamepadInputDeviceKey.Gamepad4,
            deviceName: 'DualSense Wireless Controller Extended Gamepad',
            deviceType: InputDeviceType.Gamepad,
            details: {
                inputType: DeviceInputType.Axe,
                inputName: 'axe-1',
                value: 0,
            },
            inputName: 'axe-1',
            inputValue: 0,
        },
    },
    deviceDetails: {
        deviceKey: GamepadInputDeviceKey.Gamepad4,
        inputsByName: {
            'axe-0': {
                inputName: 'axe-0',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
            'axe-1': {
                inputName: 'axe-1',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
            'axe-2': {
                inputName: 'axe-2',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
            'axe-3': {
                inputName: 'axe-3',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
            'button-0': {
                inputName: 'button-0',
                inputType: DeviceInputType.Button,
                value: 1,
            },
            'button-1': {
                inputName: 'button-1',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-2': {
                inputName: 'button-2',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-3': {
                inputName: 'button-3',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-4': {
                inputName: 'button-4',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-5': {
                inputName: 'button-5',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-6': {
                inputName: 'button-6',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-7': {
                inputName: 'button-7',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-8': {
                inputName: 'button-8',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-9': {
                inputName: 'button-9',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-10': {
                inputName: 'button-10',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-11': {
                inputName: 'button-11',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-12': {
                inputName: 'button-12',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-13': {
                inputName: 'button-13',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-14': {
                inputName: 'button-14',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-15': {
                inputName: 'button-15',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            'button-16': {
                inputName: 'button-16',
                value: 0,
                inputType: DeviceInputType.Button,
            },
        },
        axes: [
            {
                inputName: 'axe-0',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
            {
                inputName: 'axe-1',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
            {
                inputName: 'axe-2',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
            {
                inputName: 'axe-3',
                inputType: DeviceInputType.Axe,
                value: 0,
            },
        ],
        buttons: [
            {
                inputName: 'button-0',
                inputType: DeviceInputType.Button,
                value: 1,
            },
            {
                inputName: 'button-1',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-2',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-3',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-4',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-5',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-6',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-7',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-8',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-9',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-10',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-11',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-12',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-13',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-14',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-15',
                value: 0,
                inputType: DeviceInputType.Button,
            },
            {
                inputName: 'button-16',
                value: 0,
                inputType: DeviceInputType.Button,
            },
        ],
        isConnected: true,
        gamepadName: 'DualSense Wireless Controller Extended Gamepad',
        mapping: 'standard',
        serialized: true,
        timestamp: 23_640.422582875,
    },
    deviceName: 'DualSense Wireless Controller Extended Gamepad',
    deviceKey: GamepadInputDeviceKey.Gamepad4,
    deviceType: InputDeviceType.Gamepad,
};

export const mockGamepads = [
    mockSwitchProGamepad,
    mockXboxWirelessGamepad,
    mockPlayStationDualSenseGamepad,
] as const satisfies ReadonlyArray<Readonly<GamepadDevice>>;
