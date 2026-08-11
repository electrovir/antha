import {AnthaEngine} from '@antha/engine';
import {KnownInput, PredefinedGamepadModel} from '@antha/gamepad-type';
import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {
    DeviceInputType,
    GamepadInputDeviceKey,
    InputDeviceKey,
    InputDeviceType,
    type AllDevices,
    type SerializedGamepad,
} from 'input-device-handler';
import {
    createAnthaReadRawInputMod,
    readRawInputs,
    type AnthaReadRawInputModState,
} from './antha-read-raw-input.mod.js';
import {InputDirection, type RawInputs} from './raw-input.js';

function createMockDeviceHandler(devices: AllDevices = {}) {
    return {
        readAllDevices() {
            return devices;
        },
    };
}

const mockKeyboardEvent = {} as KeyboardEvent;
const mockSerializedGamepad = {} as SerializedGamepad;

describe(createAnthaReadRawInputMod.name, () => {
    it('initializes deviceHandler from options', async () => {
        const mockHandler = createMockDeviceHandler();

        const mod = createAnthaReadRawInputMod({
            deviceHandler: mockHandler,
        });

        const engine = new AnthaEngine<AnthaReadRawInputModState>({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();

        assert.isDefined(engine.state.deviceHandler);
        assert.isDefined(engine.state.rawInputs);
        assert.isDefined(engine.state.currentInputDevices);
    });

    it('does not overwrite an existing deviceHandler', async () => {
        const mockHandler = createMockDeviceHandler();

        const mod = createAnthaReadRawInputMod({
            deviceHandler: mockHandler,
        });

        const engine = new AnthaEngine<AnthaReadRawInputModState>({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();
        await engine.runSingleTick();

        assert.strictEquals(engine.state.deviceHandler, mockHandler);
    });

    it('returns undefined template when debugRawInputs is false', async () => {
        const mod = createAnthaReadRawInputMod({
            deviceHandler: createMockDeviceHandler(),
            debugRawInputs: false,
        });

        const engine = new AnthaEngine({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();

        assert.isUndefined(engine.currentTemplateMap.get(mod));
    });

    it('returns a debug template when debugRawInputs is true', async () => {
        const mod = createAnthaReadRawInputMod({
            deviceHandler: createMockDeviceHandler(),
            debugRawInputs: true,
        });

        const engine = new AnthaEngine({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();

        assert.isDefined(engine.currentTemplateMap.get(mod));
    });

    it('creates a device handler automatically when none is provided', async () => {
        const mod = createAnthaReadRawInputMod();

        const engine = new AnthaEngine<AnthaReadRawInputModState>({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();

        assert.isDefined(engine.state.deviceHandler);
    });

    it('renders debug element', async () => {
        const mod = createAnthaReadRawInputMod({
            deviceHandler: createMockDeviceHandler(),
            debugRawInputs: true,
        });

        const engine = new AnthaEngine({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();

        const template = engine.currentTemplateMap.get(mod);

        assert.isDefined(template);
    });
});

describe(readRawInputs.name, () => {
    it('reads inputs from a mock device handler', () => {
        const mockDevices: AllDevices = {
            keyboard: {
                deviceKey: InputDeviceKey.Keyboard,
                deviceName: 'keyboard',
                deviceType: InputDeviceType.Keyboard,
                deviceDetails: undefined,
                currentInputs: {
                    'button-keyW': {
                        inputName: 'button-keyW',
                        inputValue: 1,
                        details: {
                            keyboardEvent: mockKeyboardEvent,
                        },
                        deviceKey: InputDeviceKey.Keyboard,
                        deviceName: 'keyboard',
                        deviceType: InputDeviceType.Keyboard,
                    },
                },
            },
        };

        const result = readRawInputs(
            {
                deviceHandler: createMockDeviceHandler(mockDevices),
            },
            {
                msSinceLastExecute: 16,
            },
        );

        assert.isDefined(result.rawInputs);
        assert.isDefined(result.rawInputs.keyboard);
        assert.isDefined(result.currentDevices);
        assert.isDefined(result.currentDevices.keyboard);
    });

    it('calculates input direction and duration', () => {
        const mockDevices: AllDevices = {
            keyboard: {
                deviceKey: InputDeviceKey.Keyboard,
                deviceName: 'keyboard',
                deviceType: InputDeviceType.Keyboard,
                deviceDetails: undefined,
                currentInputs: {
                    'button-keyW': {
                        inputName: 'button-keyW',
                        inputValue: 1,
                        details: {
                            keyboardEvent: mockKeyboardEvent,
                        },
                        deviceKey: InputDeviceKey.Keyboard,
                        deviceName: 'keyboard',
                        deviceType: InputDeviceType.Keyboard,
                    },
                    'button-keyS': {
                        inputName: 'button-keyS',
                        inputValue: -0.5,
                        details: {
                            keyboardEvent: mockKeyboardEvent,
                        },
                        deviceKey: InputDeviceKey.Keyboard,
                        deviceName: 'keyboard',
                        deviceType: InputDeviceType.Keyboard,
                    },
                    'button-keyA': {
                        inputName: 'button-keyA',
                        inputValue: 0,
                        details: {
                            keyboardEvent: mockKeyboardEvent,
                        },
                        deviceKey: InputDeviceKey.Keyboard,
                        deviceName: 'keyboard',
                        deviceType: InputDeviceType.Keyboard,
                    },
                },
            },
        };

        const result = readRawInputs(
            {
                deviceHandler: createMockDeviceHandler(mockDevices),
            },
            {
                msSinceLastExecute: 16,
            },
        );

        const keyboard = result.rawInputs.keyboard;

        assert.isDefined(keyboard);
        assert.strictEquals(keyboard['button-keyW']?.direction, InputDirection.Positive);
        assert.strictEquals(keyboard['button-keyS']?.direction, InputDirection.Negative);
        assert.strictEquals(keyboard['button-keyA']?.direction, InputDirection.Flat);
    });

    it('accumulates duration when direction is maintained', () => {
        const mockDevices: AllDevices = {
            keyboard: {
                deviceKey: InputDeviceKey.Keyboard,
                deviceName: 'keyboard',
                deviceType: InputDeviceType.Keyboard,
                deviceDetails: undefined,
                currentInputs: {
                    'button-keyW': {
                        inputName: 'button-keyW',
                        inputValue: 1,
                        details: {
                            keyboardEvent: mockKeyboardEvent,
                        },
                        deviceKey: InputDeviceKey.Keyboard,
                        deviceName: 'keyboard',
                        deviceType: InputDeviceType.Keyboard,
                    },
                },
            },
        };

        const previousRawInputs: RawInputs = {
            keyboard: {
                'button-keyW': {
                    direction: InputDirection.Positive,
                    duration: {
                        milliseconds: 100,
                    },
                    deviceKey: InputDeviceKey.Keyboard,
                    deviceName: 'keyboard',
                    deviceType: InputDeviceType.Keyboard,
                    inputName: '',
                    inputValue: 1,
                    mapped: {
                        deviceName: '',
                        inputName: '',
                        gamepadBrand: undefined,
                    },
                },
            },
        };

        const result = readRawInputs(
            {
                deviceHandler: createMockDeviceHandler(mockDevices),
                rawInputs: previousRawInputs,
            },
            {
                msSinceLastExecute: 16,
            },
        );

        const keyboard = result.rawInputs.keyboard;

        assert.isDefined(keyboard);
        assert.strictEquals(keyboard['button-keyW']?.duration.milliseconds, 116);
    });

    it('resets duration when direction changes', () => {
        const mockDevices: AllDevices = {
            keyboard: {
                deviceKey: InputDeviceKey.Keyboard,
                deviceName: 'keyboard',
                deviceType: InputDeviceType.Keyboard,
                deviceDetails: undefined,
                currentInputs: {
                    'button-keyW': {
                        inputName: 'button-keyW',
                        inputValue: -1,
                        details: {
                            keyboardEvent: mockKeyboardEvent,
                        },
                        deviceKey: InputDeviceKey.Keyboard,
                        deviceName: 'keyboard',
                        deviceType: InputDeviceType.Keyboard,
                    },
                },
            },
        };

        const previousRawInputs: RawInputs = {
            keyboard: {
                'button-keyW': {
                    direction: InputDirection.Positive,
                    duration: {
                        milliseconds: 100,
                    },
                    deviceKey: InputDeviceKey.Keyboard,
                    deviceName: 'keyboard',
                    deviceType: InputDeviceType.Keyboard,
                    inputName: '',
                    inputValue: 1,
                    mapped: {
                        deviceName: '',
                        inputName: '',
                        gamepadBrand: undefined,
                    },
                },
            },
        };

        const result = readRawInputs(
            {
                deviceHandler: createMockDeviceHandler(mockDevices),
                rawInputs: previousRawInputs,
            },
            {
                msSinceLastExecute: 16,
            },
        );

        const keyboard = result.rawInputs.keyboard;

        assert.isDefined(keyboard);
        assert.strictEquals(keyboard['button-keyW']?.duration.milliseconds, 0);
    });

    it('handles gamepad devices with layout mappings', () => {
        const mockDevices: AllDevices = {
            [GamepadInputDeviceKey.Gamepad1]: {
                deviceKey: GamepadInputDeviceKey.Gamepad1,
                deviceName: 'Xbox Wireless Controller',
                deviceType: InputDeviceType.Gamepad,
                deviceDetails: mockSerializedGamepad,
                currentInputs: {
                    'button-0': {
                        inputName: 'button-0',
                        inputValue: 1,
                        details: {
                            inputName: 'button-0',
                            inputType: DeviceInputType.Button,
                            value: 1,
                        },
                        deviceKey: GamepadInputDeviceKey.Gamepad1,
                        deviceName: 'Xbox Wireless Controller',
                        deviceType: InputDeviceType.Gamepad,
                    },
                },
            },
        };

        const result = readRawInputs(
            {
                deviceHandler: createMockDeviceHandler(mockDevices),
            },
            {
                msSinceLastExecute: 16,
            },
        );

        assert.isDefined(result.rawInputs['0']);
        assert.isDefined(result.currentDevices['0']);
    });

    it('handles empty devices', () => {
        const result = readRawInputs(
            {
                deviceHandler: createMockDeviceHandler({}),
            },
            {
                msSinceLastExecute: 16,
            },
        );

        assert.deepEquals(result.rawInputs, {});
        assert.deepEquals(result.currentDevices, {});
    });

    it('maps input names via gamepad layout', () => {
        const deviceName = 'Test Gamepad';

        const mockDevices: AllDevices = {
            [GamepadInputDeviceKey.Gamepad1]: {
                deviceKey: GamepadInputDeviceKey.Gamepad1,
                deviceName,
                deviceType: InputDeviceType.Gamepad,
                deviceDetails: mockSerializedGamepad,
                currentInputs: {
                    'button-0': {
                        inputName: 'button-0',
                        inputValue: 1,
                        details: {
                            inputName: 'button-0',
                            inputType: DeviceInputType.Button,
                            value: 1,
                        },
                        deviceKey: GamepadInputDeviceKey.Gamepad1,
                        deviceName,
                        deviceType: InputDeviceType.Gamepad,
                    },
                },
            },
        };

        const result = readRawInputs(
            {
                deviceHandler: createMockDeviceHandler(mockDevices),
                gamepadLayouts: [
                    {
                        gamepadModels: [
                            'test-model',
                        ],
                        inputMappings: {
                            'button-0': 'A',
                        },
                        systemVersions: [],
                    },
                ],
                gamepadModelMap: {
                    [deviceName]: 'test-model',
                },
            },
            {
                msSinceLastExecute: 16,
            },
        );

        const gamepad = result.rawInputs['0'];

        assert.isDefined(gamepad);

        assert.isDefined(gamepad['A']);
        assert.strictEquals(gamepad['A'].mapped.inputName, 'A');

        /** The original input name entry always exists. */
        assert.isDefined(gamepad['button-0']);
        assert.strictEquals(gamepad['button-0'].mapped.inputName, 'A');
    });

    it('maps model-specific input name overrides', () => {
        const deviceName = 'Test Xbox Wireless Controller';

        const mockDevices: AllDevices = {
            [GamepadInputDeviceKey.Gamepad1]: {
                deviceKey: GamepadInputDeviceKey.Gamepad1,
                deviceName,
                deviceType: InputDeviceType.Gamepad,
                deviceDetails: mockSerializedGamepad,
                currentInputs: {
                    'button-5': {
                        inputName: 'button-5',
                        inputValue: 1,
                        details: {
                            inputName: 'button-5',
                            inputType: DeviceInputType.Button,
                            value: 1,
                        },
                        deviceKey: GamepadInputDeviceKey.Gamepad1,
                        deviceName,
                        deviceType: InputDeviceType.Gamepad,
                    },
                    'button-16': {
                        inputName: 'button-16',
                        inputValue: 1,
                        details: {
                            inputName: 'button-16',
                            inputType: DeviceInputType.Button,
                            value: 1,
                        },
                        deviceKey: GamepadInputDeviceKey.Gamepad1,
                        deviceName,
                        deviceType: InputDeviceType.Gamepad,
                    },
                },
            },
        };

        const result = readRawInputs(
            {
                deviceHandler: createMockDeviceHandler(mockDevices),
                gamepadLayouts: [
                    {
                        gamepadModels: [
                            PredefinedGamepadModel.XboxWireless,
                        ],
                        inputMappings: {
                            'button-5': KnownInput.R1,
                            'button-16': KnownInput.Logo,
                        },
                        systemVersions: [],
                    },
                ],
                gamepadModelMap: {
                    [deviceName]: PredefinedGamepadModel.XboxWireless,
                },
            },
            {
                msSinceLastExecute: 16,
            },
        );

        const gamepad = result.rawInputs['0'];

        assert.isDefined(gamepad);
        assert.deepEquals(
            {
                mappedInputName: gamepad[KnownInput.R1]?.mapped.inputName,
                modelInputName: gamepad.RB?.mapped.inputName,
                mappedInputWithoutModelOverride: gamepad[KnownInput.Logo]?.mapped.inputName,
                rawInputName: gamepad['button-5']?.mapped.inputName,
                rawInputNameWithoutModelOverride: gamepad['button-16']?.mapped.inputName,
            },
            {
                mappedInputName: KnownInput.R1,
                modelInputName: KnownInput.R1,
                mappedInputWithoutModelOverride: KnownInput.Logo,
                rawInputName: KnownInput.R1,
                rawInputNameWithoutModelOverride: KnownInput.Logo,
            },
        );
    });
});
