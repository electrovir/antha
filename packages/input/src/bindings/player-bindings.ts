import {type GamepadInputDeviceKey, type InputDeviceKey} from 'input-device-handler';
import {type InputDirection} from '../raw-inputs/raw-input.js';

/**
 * A mapping of gamepad keys that simply allows them to be interpreted as different keys. This is
 * useful for mapping a controller in any port to any other port. For example, mapping the
 * controller in port 4 to port 1.
 *
 * @category Internal
 */
export type GamepadKeyMap = Partial<Record<GamepadInputDeviceKey, GamepadInputDeviceKey>>;

/**
 * A binding assignment device key that maps the input to _any_ connected controller.
 *
 * @category Internal
 */
export const AnyGamepad = 'any-gamepad' as const;
/**
 * A binding assignment device key that maps the input to _any_ connected controller.
 *
 * @category Internal
 */
export type AnyGamepad = typeof AnyGamepad;

/**
 * All supported device keys for input binding assignments.
 *
 * @category Internal
 */
export type AnthaDeviceKey = InputDeviceKey | AnyGamepad;

/**
 * An individual binding assignment. Used in `createAnthaReadBindingsMod` and
 * {@link BindingAssignments}.
 *
 * @category Internal
 */
export type BindingAssignment = {
    deviceKey: AnthaDeviceKey;
    /**
     * The input key, button, or gamepad input name (like `'button-keyW'` for keyboard buttons or
     * `'button-12'` or `'X'` for gamepads).
     */
    inputName: string;
    /** Required gamepad brand. */
    gamepadBrand?: string;
    direction: InputDirection;
};

/**
 * Starts at `'1'`.
 *
 * @category Internal
 */
export type PlayerPosition = `${number}`;

/**
 * A collection of bindings for a single player. Used in `createAnthaReadBindingsMod` and
 * {@link PlayersBindingAssignments}.
 *
 * @category Internal
 */
export type BindingAssignments<BindingNames extends string = string> = Partial<
    Record<BindingNames, BindingAssignment[]>
>;

/**
 * A collection of bindings for all players. Used in `createAnthaReadBindingsMod` and
 * `AnthaInputBindingsState`.
 *
 * @category Internal
 */
export type PlayersBindingAssignments<BindingNames extends string = string> = Record<
    PlayerPosition,
    BindingAssignments<BindingNames>
>;

/**
 * An individual active binding. Used in `createAnthaReadBindingsMod` and {@link ActiveBindingsMap}.
 *
 * @category Internal
 */
export type ActiveBinding = {
    /**
     * The full duration for which the current binding has been active in its current direction.
     * When an active is first pressed, this will be 0 milliseconds.
     *
     * @default {milliseconds: 0}
     */
    holdDuration: {milliseconds: number};
    value: number;
    /**
     * The hold duration at which the last time this binding was acted upon. When the binding hasn't
     * been acted on yet, this contain 0 milliseconds.
     *
     * This must be set by whatever process is acting on this binding, whenever it does so.
     *
     * @default {milliseconds: 0}
     */
    lastActDuration: {milliseconds: number};
    /**
     * The number of times which this binding has been acted upon for the current hold. When a
     * binding is first activated, this will be `0`.
     *
     * This must be incremented by whatever process is acting on this binding, whenever it does so.
     *
     * @default 0
     */
    actCount: number;
};

/**
 * A collection of all active bindings for an individual player. Used in
 * `createAnthaReadBindingsMod` and {@link PlayersActiveBindingsMap}.
 *
 * @category Internal
 */
export type ActiveBindingsMap<BindingNames extends string = string> = Partial<
    Record<BindingNames, ActiveBinding>
>;

/**
 * A collection of all active bindings for all players. Used in `createAnthaReadBindingsMod` and
 * `AnthaInputBindingsState`.
 *
 * @category Internal
 */
export type PlayersActiveBindingsMap<BindingNames extends string = string> = Record<
    PlayerPosition,
    ActiveBindingsMap<BindingNames>
>;
