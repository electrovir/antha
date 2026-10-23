import {KnownInput} from '@antha/gamepad-type';
import {LocalPlayerPosition} from '@antha/util';
import {arrayToObject, getObjectTypedEntries, mapObjectValues} from '@augment-vir/common';
import {type GamepadInputDeviceKey} from 'input-device-handler';
import {InputDirection} from '../raw-inputs/raw-input.js';
import {defaultMenuNavBindings, type MenuNavBinding} from './antha-menu.mod.js';
import {type DirectionalBindingNames} from './directional-input.js';
import {
    AnyGamepad,
    type BindingAssignment,
    type BindingAssignments,
    defaultPlayerGamepads,
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

/**
 * Inputs for one button binding in {@link createDefaultLocalPlayerBindings}. Gamepad inputs are
 * assigned to each player's own gamepad.
 *
 * @category Internal
 */
export type DefaultButtonBindingInputs = {
    gamepadInputNames: ReadonlyArray<KnownInput>;
    /** Keyboard input names, like `'button-Space'`. */
    keyboardInputNames: ReadonlyArray<string>;
};

function createButtonBindings({
    buttonBindings,
    gamepadDeviceKey,
    includeKeyboard,
}: Readonly<{
    buttonBindings:
        | Readonly<Record<string, Readonly<DefaultButtonBindingInputs> | undefined>>
        | undefined;
    gamepadDeviceKey: GamepadInputDeviceKey;
    includeKeyboard: boolean;
}>) {
    return mapObjectValues(buttonBindings || {}, (_bindingName, buttonBindingInputs) => {
        return [
            ...(buttonBindingInputs?.gamepadInputNames || []).map((inputName) => {
                return {
                    deviceKey: gamepadDeviceKey,
                    direction: InputDirection.Positive,
                    inputName,
                };
            }),
            ...(includeKeyboard ? buttonBindingInputs?.keyboardInputNames || [] : []).map(
                (inputName) => {
                    return {
                        deviceKey: 'keyboard',
                        direction: InputDirection.Positive,
                        inputName,
                    } satisfies BindingAssignment;
                },
            ),
        ];
    }) satisfies BindingAssignments;
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
 * Builds per-slot gamepad movement, button, and menu bindings. `playerGamepads` defaults to
 * {@link defaultPlayerGamepads} for all four players. Keyboard controls default to
 * `LocalPlayerPosition.One`; set `keyboardPlayerPosition` to `undefined` to disable them.
 *
 * @category Util
 */
export function createDefaultLocalPlayerBindings<BindingName extends string>({
    buttonBindings,
    directionalBindingNames,
    playerGamepads = getObjectTypedEntries(defaultPlayerGamepads).map(
        ([
            playerPosition,
            gamepadDeviceKey,
        ]) => {
            return {
                playerPosition,
                gamepadDeviceKey,
            };
        },
    ),
    ...keyboardOptions
}: Readonly<{
    /** Extra button bindings, each assigned to every player's gamepad and the keyboard player. */
    buttonBindings?:
        | Readonly<Partial<Record<BindingName, Readonly<DefaultButtonBindingInputs> | undefined>>>
        | undefined;
    directionalBindingNames: Readonly<DirectionalBindingNames<BindingName>>;
    keyboardPlayerPosition?: LocalPlayerPosition | undefined;
    playerGamepads?:
        | ReadonlyArray<
              Readonly<{
                  playerPosition: LocalPlayerPosition;
                  gamepadDeviceKey: GamepadInputDeviceKey;
              }>
          >
        | undefined;
}>) {
    const keyboardPlayerPosition =
        'keyboardPlayerPosition' in keyboardOptions
            ? keyboardOptions.keyboardPlayerPosition
            : LocalPlayerPosition.One;

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
                    ...createButtonBindings({
                        buttonBindings,
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
