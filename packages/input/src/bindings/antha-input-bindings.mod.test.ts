import {AnthaEngine} from '@antha/engine';
import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {GamepadInputDeviceKey, InputDeviceKey, InputDeviceType} from 'input-device-handler';
import {InputDirection} from '../raw-inputs/raw-input.js';
import {
    createAnthaInputBindingsMod,
    type AnthaInputBindingsState,
} from './antha-input-bindings.mod.js';
import {AnyGamepad} from './player-bindings.js';

describe(createAnthaInputBindingsMod.name, () => {
    it('creates a mod with the correct name', () => {
        const mod = createAnthaInputBindingsMod();

        assert.strictEquals(mod.modName, 'antha-input-bindings');
    });

    it('sets activeBindings to empty when no bindingAssignments exist', async () => {
        const mod = createAnthaInputBindingsMod();

        const engine = new AnthaEngine<AnthaInputBindingsState>({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();

        assert.deepEquals(engine.state.activeBindings, {});
    });

    it('detects active bindings from raw inputs', async () => {
        const mod = createAnthaInputBindingsMod<'moveUp'>();

        const engine = new AnthaEngine<AnthaInputBindingsState<'moveUp'>>({
            mods: [
                mod,
            ],
        });

        engine.state.rawInputs = {
            keyboard: {
                'button-keyW': {
                    inputName: 'button-keyW',
                    inputValue: 1,
                    direction: InputDirection.Positive,
                    duration: {
                        milliseconds: 0,
                    },
                    deviceKey: InputDeviceKey.Keyboard,
                    deviceName: 'keyboard',
                    deviceType: InputDeviceType.Keyboard,
                    mapped: {
                        deviceName: 'keyboard',
                        inputName: 'button-keyW',
                        gamepadBrand: undefined,
                    },
                },
            },
        };
        engine.state.bindingAssignments = {
            [GamepadInputDeviceKey.Gamepad2]: {
                moveUp: [
                    {
                        deviceKey: InputDeviceKey.Keyboard,
                        inputName: 'button-keyW',
                        direction: InputDirection.Positive,
                    },
                ],
            },
        };

        await engine.runSingleTick();

        assert.isDefined(engine.state.activeBindings?.[GamepadInputDeviceKey.Gamepad2]?.moveUp);
        assert.strictEquals(
            engine.state.activeBindings[GamepadInputDeviceKey.Gamepad2]?.moveUp?.value,
            1,
        );
        assert.strictEquals(
            engine.state.activeBindings[GamepadInputDeviceKey.Gamepad2]?.moveUp?.holdDuration
                .milliseconds,
            0,
        );
    });

    it('accumulates hold duration on subsequent ticks', async () => {
        const mod = createAnthaInputBindingsMod<'moveUp'>();

        const engine = new AnthaEngine<AnthaInputBindingsState<'moveUp'>>({
            mods: [
                mod,
            ],
        });

        engine.state.rawInputs = {
            keyboard: {
                'button-keyW': {
                    inputName: 'button-keyW',
                    inputValue: 1,
                    direction: InputDirection.Positive,
                    duration: {
                        milliseconds: 0,
                    },
                    deviceKey: InputDeviceKey.Keyboard,
                    deviceName: 'keyboard',
                    deviceType: InputDeviceType.Keyboard,
                    mapped: {
                        deviceName: 'keyboard',
                        inputName: 'button-keyW',
                        gamepadBrand: undefined,
                    },
                },
            },
        };
        engine.state.bindingAssignments = {
            [GamepadInputDeviceKey.Gamepad2]: {
                moveUp: [
                    {
                        deviceKey: InputDeviceKey.Keyboard,
                        inputName: 'button-keyW',
                        direction: InputDirection.Positive,
                    },
                ],
            },
        };

        await engine.runSingleTick();
        await engine.runSingleTick();

        assert.isDefined(engine.state.activeBindings?.[GamepadInputDeviceKey.Gamepad2]?.moveUp);
        assert.isAbove(
            engine.state.activeBindings[GamepadInputDeviceKey.Gamepad2]?.moveUp?.holdDuration
                .milliseconds ?? -1,
            -1,
        );
    });

    it('does not activate bindings when direction does not match', async () => {
        const mod = createAnthaInputBindingsMod<'moveUp'>();

        const engine = new AnthaEngine<AnthaInputBindingsState<'moveUp'>>({
            mods: [
                mod,
            ],
        });

        engine.state.rawInputs = {
            keyboard: {
                'button-keyW': {
                    inputName: 'button-keyW',
                    inputValue: -1,
                    direction: InputDirection.Negative,
                    duration: {
                        milliseconds: 0,
                    },
                    deviceKey: InputDeviceKey.Keyboard,
                    deviceName: 'keyboard',
                    deviceType: InputDeviceType.Keyboard,
                    mapped: {
                        deviceName: 'keyboard',
                        inputName: 'button-keyW',
                        gamepadBrand: undefined,
                    },
                },
            },
        };
        engine.state.bindingAssignments = {
            [GamepadInputDeviceKey.Gamepad2]: {
                moveUp: [
                    {
                        deviceKey: InputDeviceKey.Keyboard,
                        inputName: 'button-keyW',
                        direction: InputDirection.Positive,
                    },
                ],
            },
        };

        await engine.runSingleTick();

        assert.isUndefined(engine.state.activeBindings?.[GamepadInputDeviceKey.Gamepad2]?.moveUp);
    });

    it('returns undefined template without debug options', async () => {
        const mod = createAnthaInputBindingsMod();

        const engine = new AnthaEngine({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();

        assert.isUndefined(engine.currentTemplateMap.get(mod));
    });

    it('returns debug template when debugActiveBindings is true', async () => {
        const mod = createAnthaInputBindingsMod({
            debugActiveBindings: true,
        });

        const engine = new AnthaEngine<AnthaInputBindingsState>({
            mods: [
                mod,
            ],
        });

        engine.state.rawInputs = {};
        engine.state.bindingAssignments = {
            [GamepadInputDeviceKey.Gamepad2]: {},
        };

        await engine.runSingleTick();

        assert.isDefined(engine.currentTemplateMap.get(mod));
    });

    it('supports AnyGamepad device key', async () => {
        const mod = createAnthaInputBindingsMod<'fire'>();

        const engine = new AnthaEngine<AnthaInputBindingsState<'fire'>>({
            mods: [
                mod,
            ],
        });

        engine.state.rawInputs = {
            [GamepadInputDeviceKey.Gamepad1]: {
                'button-0': {
                    inputName: 'button-0',
                    inputValue: 1,
                    direction: InputDirection.Positive,
                    duration: {
                        milliseconds: 0,
                    },
                    deviceKey: GamepadInputDeviceKey.Gamepad1,
                    deviceName: 'Gamepad',
                    deviceType: InputDeviceType.Gamepad,
                    mapped: {
                        deviceName: 'Gamepad',
                        inputName: 'button-0',
                        gamepadBrand: undefined,
                    },
                },
            },
        };
        engine.state.bindingAssignments = {
            [GamepadInputDeviceKey.Gamepad2]: {
                fire: [
                    {
                        deviceKey: AnyGamepad,
                        inputName: 'button-0',
                        direction: InputDirection.Positive,
                    },
                ],
            },
        };

        await engine.runSingleTick();

        assert.isDefined(engine.state.activeBindings?.[GamepadInputDeviceKey.Gamepad2]?.fire);
        assert.strictEquals(
            engine.state.activeBindings[GamepadInputDeviceKey.Gamepad2]?.fire?.value,
            1,
        );
    });

    it('supports gamepadKeyMap remapping', async () => {
        const mod = createAnthaInputBindingsMod<'fire'>();

        const engine = new AnthaEngine<AnthaInputBindingsState<'fire'>>({
            mods: [
                mod,
            ],
        });

        engine.state.rawInputs = {
            [GamepadInputDeviceKey.Gamepad2]: {
                'button-0': {
                    inputName: 'button-0',
                    inputValue: 1,
                    direction: InputDirection.Positive,
                    duration: {
                        milliseconds: 0,
                    },
                    deviceKey: '1',
                    deviceName: 'Gamepad',
                    deviceType: InputDeviceType.Gamepad,
                    mapped: {
                        deviceName: 'Gamepad',
                        inputName: 'button-0',
                        gamepadBrand: undefined,
                    },
                },
            },
        };
        engine.state.gamepadKeyMap = {
            [GamepadInputDeviceKey.Gamepad1]: '1',
        };
        engine.state.bindingAssignments = {
            [GamepadInputDeviceKey.Gamepad2]: {
                fire: [
                    {
                        deviceKey: GamepadInputDeviceKey.Gamepad1,
                        inputName: 'button-0',
                        direction: InputDirection.Positive,
                    },
                ],
            },
        };

        await engine.runSingleTick();

        assert.isDefined(engine.state.activeBindings?.[GamepadInputDeviceKey.Gamepad2]?.fire);
        assert.strictEquals(
            engine.state.activeBindings[GamepadInputDeviceKey.Gamepad2]?.fire?.value,
            1,
        );
    });

    it('filters by gamepadBrand when specified', async () => {
        const mod = createAnthaInputBindingsMod<'fire'>();

        const engine = new AnthaEngine<AnthaInputBindingsState<'fire'>>({
            mods: [
                mod,
            ],
        });

        engine.state.rawInputs = {
            [GamepadInputDeviceKey.Gamepad1]: {
                'button-0': {
                    inputName: 'button-0',
                    inputValue: 1,
                    direction: InputDirection.Positive,
                    duration: {
                        milliseconds: 0,
                    },
                    deviceKey: GamepadInputDeviceKey.Gamepad1,
                    deviceName: 'Gamepad',
                    deviceType: InputDeviceType.Gamepad,
                    mapped: {
                        deviceName: 'Gamepad',
                        inputName: 'button-0',
                        gamepadBrand: 'xbox',
                    },
                },
            },
        };
        engine.state.bindingAssignments = {
            [GamepadInputDeviceKey.Gamepad2]: {
                fire: [
                    {
                        deviceKey: GamepadInputDeviceKey.Gamepad1,
                        inputName: 'button-0',
                        direction: InputDirection.Positive,
                        gamepadBrand: 'playstation',
                    },
                ],
            },
        };

        await engine.runSingleTick();

        assert.isUndefined(engine.state.activeBindings?.[GamepadInputDeviceKey.Gamepad2]?.fire);
    });

    it('returns debug template when debugBindingAssignments is true', async () => {
        const mod = createAnthaInputBindingsMod({
            debugActiveBindings: true,
            debugBindingAssignments: true,
        });

        const engine = new AnthaEngine<AnthaInputBindingsState>({
            mods: [
                mod,
            ],
        });

        engine.state.rawInputs = {};
        engine.state.bindingAssignments = {
            [GamepadInputDeviceKey.Gamepad2]: {},
        };

        await engine.runSingleTick();

        assert.isDefined(engine.currentTemplateMap.get(mod));
    });
});
