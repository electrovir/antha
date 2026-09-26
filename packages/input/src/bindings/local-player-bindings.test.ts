import {KnownInput} from '@antha/gamepad-type';
import {assert, assertWrap} from '@augment-vir/assert';
import {getObjectTypedEntries, getObjectTypedValues} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {GamepadInputDeviceKey} from 'input-device-handler';
import {InputDirection} from '../raw-inputs/raw-input.js';
import {MenuNavBinding} from './antha-menu-nav.mod.js';
import {createDefaultLocalPlayerBindings} from './local-player-bindings.js';
import {PlayerPosition} from './player-bindings.js';

enum PlayerAction {
    Down = 'move-down',
    Left = 'move-left',
    Right = 'move-right',
    Up = 'move-up',
}

const directionalBindingNames = {
    down: PlayerAction.Down,
    left: PlayerAction.Left,
    right: PlayerAction.Right,
    up: PlayerAction.Up,
};

const playerGamepads = [
    {
        gamepadDeviceKey: GamepadInputDeviceKey.Gamepad1,
        playerPosition: PlayerPosition.One,
    },
    {
        gamepadDeviceKey: GamepadInputDeviceKey.Gamepad2,
        playerPosition: PlayerPosition.Two,
    },
] as const;

describe(createDefaultLocalPlayerBindings.name, () => {
    it('keeps gamepads independent and assigns keyboard to the configured slot', () => {
        const bindingAssignments = createDefaultLocalPlayerBindings({
            directionalBindingNames,
            playerGamepads,
        });
        const playerOneBindings = assertWrap.isDefined(bindingAssignments[PlayerPosition.One]);
        const playerTwoBindings = assertWrap.isDefined(bindingAssignments[PlayerPosition.Two]);
        const playerTwoMenuEnterBindings = assertWrap.isDefined(
            playerTwoBindings[MenuNavBinding.MenuEnter],
        );

        assert.deepEquals(
            playerOneBindings[PlayerAction.Up]?.filter(({deviceKey}) => deviceKey !== 'keyboard'),
            [
                {
                    deviceKey: GamepadInputDeviceKey.Gamepad1,
                    direction: InputDirection.Positive,
                    inputName: KnownInput.DPadUp,
                },
                {
                    deviceKey: GamepadInputDeviceKey.Gamepad1,
                    direction: InputDirection.Negative,
                    inputName: KnownInput.LeftStickY,
                },
                {
                    deviceKey: GamepadInputDeviceKey.Gamepad1,
                    direction: InputDirection.Negative,
                    inputName: KnownInput.RightStickY,
                },
            ],
        );
        assert.isTrue(
            playerOneBindings[PlayerAction.Up]?.some(
                ({deviceKey, inputName}) => deviceKey === 'keyboard' && inputName === 'button-KeyW',
            ),
        );
        assert.isTrue(
            playerTwoMenuEnterBindings.some(
                ({deviceKey}) => deviceKey === GamepadInputDeviceKey.Gamepad2,
            ),
        );
        assert.isFalse(playerTwoMenuEnterBindings.some(({deviceKey}) => deviceKey === 'keyboard'));
    });

    it('can disable keyboard assignments', () => {
        const bindingAssignments = createDefaultLocalPlayerBindings({
            directionalBindingNames,
            keyboardPlayerPosition: undefined,
            playerGamepads,
        });
        const allAssignments = getObjectTypedValues(bindingAssignments)
            .flatMap((playerBindings) => getObjectTypedValues(playerBindings))
            .flat();

        assert.isFalse(allAssignments.some(({deviceKey}) => deviceKey === 'keyboard'));
    });

    it('defaults each player to their own gamepad', () => {
        const bindingAssignments = createDefaultLocalPlayerBindings({
            directionalBindingNames,
        });

        assert.deepEquals(
            getObjectTypedEntries(bindingAssignments).map(
                ([
                    playerPosition,
                    playerBindings,
                ]) => {
                    return [
                        playerPosition,
                        playerBindings[PlayerAction.Up]?.find(
                            ({deviceKey}) => deviceKey !== 'keyboard',
                        )?.deviceKey,
                    ];
                },
            ),
            [
                [
                    PlayerPosition.One,
                    GamepadInputDeviceKey.Gamepad1,
                ],
                [
                    PlayerPosition.Two,
                    GamepadInputDeviceKey.Gamepad2,
                ],
                [
                    PlayerPosition.Three,
                    GamepadInputDeviceKey.Gamepad3,
                ],
                [
                    PlayerPosition.Four,
                    GamepadInputDeviceKey.Gamepad4,
                ],
            ],
        );
    });
});
