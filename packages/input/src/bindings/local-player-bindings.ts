import {KnownInput} from '@antha/gamepad-type';
import {arrayToObject, mapObjectValues} from '@augment-vir/common';
import {type GamepadInputDeviceKey} from 'input-device-handler';
import {InputDirection} from '../raw-inputs/raw-input.js';
import {defaultMenuNavBindings, type MenuNavBinding} from './antha-menu-nav.mod.js';
import {type DirectionalBindingNames} from './directional-input.js';
import {
    AnyGamepad,
    type BindingAssignment,
    type BindingAssignments,
    type PlayerPosition,
    type PlayersBindingAssignments,
} from './player-bindings.js';

const keyboardDirectionalBindings: Record<
    keyof DirectionalBindingNames<string>,
    BindingAssignment[]
> = {
    down: [
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-KeyS',
        },
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-ArrowDown',
        },
    ],
    left: [
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-KeyA',
        },
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-ArrowLeft',
        },
    ],
    right: [
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-KeyD',
        },
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-ArrowRight',
        },
    ],
    up: [
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-KeyW',
        },
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-ArrowUp',
        },
    ],
};

function createDirectionalBindings<BindingName extends string>({
    directionalBindingNames,
    gamepadDeviceKey,
    includeKeyboard,
}: Readonly<{
    directionalBindingNames: Readonly<DirectionalBindingNames<BindingName>>;
    gamepadDeviceKey: GamepadInputDeviceKey;
    includeKeyboard: boolean;
}>) {
    return arrayToObject(
        [
            {
                bindingName: directionalBindingNames.down,
                gamepadBindings: [
                    {
                        direction: InputDirection.Positive,
                        inputName: KnownInput.DPadDown,
                    },
                    {
                        direction: InputDirection.Positive,
                        inputName: KnownInput.LeftStickY,
                    },
                    {
                        direction: InputDirection.Positive,
                        inputName: KnownInput.RightStickY,
                    },
                ],
                keyboardBindings: keyboardDirectionalBindings.down,
            },
            {
                bindingName: directionalBindingNames.left,
                gamepadBindings: [
                    {
                        direction: InputDirection.Positive,
                        inputName: KnownInput.DPadLeft,
                    },
                    {
                        direction: InputDirection.Negative,
                        inputName: KnownInput.LeftStickX,
                    },
                    {
                        direction: InputDirection.Negative,
                        inputName: KnownInput.RightStickX,
                    },
                ],
                keyboardBindings: keyboardDirectionalBindings.left,
            },
            {
                bindingName: directionalBindingNames.right,
                gamepadBindings: [
                    {
                        direction: InputDirection.Positive,
                        inputName: KnownInput.DPadRight,
                    },
                    {
                        direction: InputDirection.Positive,
                        inputName: KnownInput.LeftStickX,
                    },
                    {
                        direction: InputDirection.Positive,
                        inputName: KnownInput.RightStickX,
                    },
                ],
                keyboardBindings: keyboardDirectionalBindings.right,
            },
            {
                bindingName: directionalBindingNames.up,
                gamepadBindings: [
                    {
                        direction: InputDirection.Positive,
                        inputName: KnownInput.DPadUp,
                    },
                    {
                        direction: InputDirection.Negative,
                        inputName: KnownInput.LeftStickY,
                    },
                    {
                        direction: InputDirection.Negative,
                        inputName: KnownInput.RightStickY,
                    },
                ],
                keyboardBindings: keyboardDirectionalBindings.up,
            },
        ],
        ({bindingName, gamepadBindings, keyboardBindings}) => {
            return {
                key: bindingName,
                value: [
                    ...gamepadBindings.map((gamepadBinding) => {
                        return {
                            ...gamepadBinding,
                            deviceKey: gamepadDeviceKey,
                        };
                    }),
                    ...(includeKeyboard ? keyboardBindings : []),
                ],
            };
        },
    );
}

function createMenuNavBindings({
    gamepadDeviceKey,
    includeKeyboard,
}: Readonly<{
    gamepadDeviceKey: GamepadInputDeviceKey;
    includeKeyboard: boolean;
}>) {
    return mapObjectValues(defaultMenuNavBindings, (_bindingName, assignments) => {
        return assignments.flatMap((assignment) => {
            if (assignment.deviceKey === AnyGamepad) {
                return [
                    {
                        ...assignment,
                        deviceKey: gamepadDeviceKey,
                    },
                ];
            }

            return includeKeyboard ? [assignment] : [];
        });
    }) satisfies BindingAssignments<MenuNavBinding>;
}

/**
 * Builds per-slot gamepad movement and menu bindings. Keyboard controls default to slot `'1'`; set
 * `keyboardPlayerPosition` to `undefined` to disable them.
 *
 * @category Util
 */
export function createDefaultLocalPlayerBindings<BindingName extends string>({
    directionalBindingNames,
    playerGamepads,
    ...keyboardOptions
}: Readonly<{
    directionalBindingNames: Readonly<DirectionalBindingNames<BindingName>>;
    keyboardPlayerPosition?: PlayerPosition | undefined;
    playerGamepads: ReadonlyArray<
        Readonly<{
            playerPosition: PlayerPosition;
            gamepadDeviceKey: GamepadInputDeviceKey;
        }>
    >;
}>) {
    const keyboardPlayerPosition =
        'keyboardPlayerPosition' in keyboardOptions ? keyboardOptions.keyboardPlayerPosition : '1';

    return playerGamepads.reduce<PlayersBindingAssignments<BindingName | MenuNavBinding>>(
        (playerBindingAssignments, {gamepadDeviceKey, playerPosition}) => {
            const includeKeyboard = playerPosition === keyboardPlayerPosition;

            return {
                ...playerBindingAssignments,
                [playerPosition]: {
                    ...createDirectionalBindings({
                        directionalBindingNames,
                        gamepadDeviceKey,
                        includeKeyboard,
                    }),
                    ...createMenuNavBindings({
                        gamepadDeviceKey,
                        includeKeyboard,
                    }),
                },
            };
        },
        {},
    );
}
