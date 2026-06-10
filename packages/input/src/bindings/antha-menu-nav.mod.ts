import {defineAnthaMod} from '@antha/engine';
import {check} from '@augment-vir/assert';
import {getObjectTypedEntries, getObjectTypedValues} from '@augment-vir/common';
import {type AnyDuration, convertDuration} from 'date-vir';
import {NavController, type NavControllerOptions, NavDirection} from 'device-navigation';
import {PredefinedGamepadBrand} from 'gamepad-type';
import {InputDirection} from '../raw-inputs/raw-input.js';
import {
    AnyGamepad,
    type BindingAssignments,
    type PlayersActiveBindings,
} from './player-bindings.js';

export {nav, navAttribute, NavController} from 'device-navigation';

/**
 * All supported menu navigation bindings. To ignore any, simply don't allow players to bind to
 * them. Any menus that don't have sufficient nestings to support any specific binding simply won't
 * do anything if they're active.
 *
 * @category Menu
 */
export enum MenuNavBinding {
    MenuUp = 'menu-up',
    MenuDown = 'menu-down',
    MenuLeft = 'menu-left',
    MenuRight = 'menu-right',

    /**
     * Enter into a sub-menu.
     *
     * For example, this is usually a click, the enter button, "A" on Xbox or Nintendo controllers,
     * or "X" on Playstation controllers.
     */
    MenuEnter = 'menu-enter',
    /**
     * Exit out of a sub-menu.
     *
     * For example, this is usually the Escape key, "B" on Xbox or Nintendo controllers, or "△" on
     * Playstation controllers.
     */
    MenuExit = 'menu-exit',

    /** Navigate to the next section in a menu. */
    MenuSectionNext = 'menu-section-next',
    /** Navigate to the previous section in a menu. */
    MenuSectionPrevious = 'menu-section-previous',
}

export const defaultMenuNavBindings: Readonly<BindingAssignments<MenuNavBinding>> = {
    [MenuNavBinding.MenuLeft]: [
        {
            deviceKey: AnyGamepad,
            direction: InputDirection.Positive,
            inputName: 'd-pad-left',
        },
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-KeyA',
        },
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-KeyJ',
        },
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-ArrowLeft',
        },
    ],
    [MenuNavBinding.MenuRight]: [
        {
            deviceKey: AnyGamepad,
            direction: InputDirection.Positive,
            inputName: 'd-pad-right',
        },
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-KeyD',
        },
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-KeyL',
        },
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-ArrowRight',
        },
    ],
    [MenuNavBinding.MenuUp]: [
        {
            deviceKey: AnyGamepad,
            direction: InputDirection.Positive,
            inputName: 'd-pad-up',
        },
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-KeyW',
        },
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-KeyI',
        },
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-ArrowUp',
        },
    ],
    [MenuNavBinding.MenuDown]: [
        {
            deviceKey: AnyGamepad,
            direction: InputDirection.Positive,
            inputName: 'd-pad-down',
        },
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-KeyS',
        },
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-KeyK',
        },
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-ArrowDown',
        },
    ],
    [MenuNavBinding.MenuEnter]: [
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-Space',
        },
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-Enter',
        },
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-NumpadEnter',
        },
        {
            deviceKey: AnyGamepad,
            direction: InputDirection.Positive,
            gamepadBrand: PredefinedGamepadBrand.Sony,
            inputName: 'X',
        },
        {
            deviceKey: AnyGamepad,
            direction: InputDirection.Positive,
            inputName: 'A',
        },
    ],
    [MenuNavBinding.MenuExit]: [
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-Escape',
        },
        {
            deviceKey: AnyGamepad,
            direction: InputDirection.Positive,
            gamepadBrand: PredefinedGamepadBrand.Sony,
            inputName: 'O',
        },
        {
            deviceKey: AnyGamepad,
            direction: InputDirection.Positive,
            inputName: 'B',
        },
    ],
    [MenuNavBinding.MenuSectionNext]: [
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-KeyE',
        },
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-KeyO',
        },
        {
            deviceKey: AnyGamepad,
            direction: InputDirection.Positive,
            inputName: 'R1',
        },
    ],
    [MenuNavBinding.MenuSectionPrevious]: [
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-KeyQ',
        },
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-KeyU',
        },
        {
            deviceKey: AnyGamepad,
            direction: InputDirection.Positive,
            inputName: 'L1',
        },
    ],
};

/**
 * Options for {@link AnthaMenuNavMod}.
 *
 * @category Menu
 */
export type MenuNavOptions = Readonly<
    Partial<{
        /**
         * The duration that any menu nav binding must be held before it starts auto-repeating.
         *
         * @default {milliseconds: 500}
         */
        repeatThreshold: Readonly<AnyDuration>;
        /**
         * The minimum interval between each repetition in a repeating menu nav binding.
         *
         * @default {milliseconds: 60}
         */
        repeatInterval: Readonly<AnyDuration>;
        /**
         * Allow wrapping when navigating menu items.
         *
         * @default true
         */
        allowWrapping: boolean;
    }>
>;

export type MenuNavModState = {
    /** Set to true to enable menu navigation. */
    isInMenu: boolean;
    /** Omit or set to `undefined` to disable menu nav. */
    menuNavOptions: Required<MenuNavOptions> | undefined;
    /** All active bindings for all players. */
    activeBindings: PlayersActiveBindings;
    navController: NavController;
};

export const defaultMenuNavOptions: Required<MenuNavOptions> = {
    repeatThreshold: {
        milliseconds: 500,
    },
    repeatInterval: {
        milliseconds: 60,
    },
    allowWrapping: true,
};

export function createAnthaMenuNavMod(
    options: Readonly<MenuNavOptions & NavControllerOptions> | undefined,
) {
    return defineAnthaMod<MenuNavModState>({
        modName: 'menu-nav',
        initState: {
            menuNavOptions: options
                ? {
                      ...defaultMenuNavOptions,
                      ...options,
                  }
                : undefined,
        },
        execute({state, hostElement}) {
            if (!state.isInMenu || !state.menuNavOptions || !state.activeBindings) {
                return;
            }
            if (!state.navController) {
                state.navController = new NavController(hostElement, {
                    alwaysRequireFocused: true,
                    activateOnMouseUp: false,
                    ...options,
                });
            }

            const repeatThreshold = convertDuration(state.menuNavOptions.repeatThreshold, {
                milliseconds: true,
            }).milliseconds;
            const repeatInterval = convertDuration(state.menuNavOptions.repeatInterval, {
                milliseconds: true,
            }).milliseconds;

            const bindingsToAct: Partial<Record<MenuNavBinding, boolean>> = {};

            getObjectTypedValues(state.activeBindings).forEach((playerActiveBindings) => {
                getObjectTypedEntries(playerActiveBindings).forEach(
                    ([
                        bindingName,
                        activeBinding,
                    ]) => {
                        if (!check.isEnumValue(bindingName, MenuNavBinding)) {
                            return;
                        }

                        if (activeBinding.holdDuration.milliseconds >= repeatThreshold) {
                            if (
                                activeBinding.holdDuration.milliseconds -
                                    activeBinding.lastActDuration.milliseconds >
                                repeatInterval
                            ) {
                                bindingsToAct[bindingName] = true;
                                activeBinding.actCount++;
                                activeBinding.lastActDuration = activeBinding.holdDuration;
                            }
                        } else if (
                            !activeBinding.holdDuration.milliseconds &&
                            !activeBinding.actCount
                        ) {
                            bindingsToAct[bindingName] = true;
                            activeBinding.actCount++;
                        }
                    },
                );
            });

            if (bindingsToAct[MenuNavBinding.MenuEnter]) {
                state.navController.enterInto();
                return;
            } else if (bindingsToAct[MenuNavBinding.MenuExit]) {
                state.navController.exitOutOf();
                return;
            }
            const sectionDirection =
                bindingsToAct[MenuNavBinding.MenuSectionNext] &&
                !bindingsToAct[MenuNavBinding.MenuSectionPrevious]
                    ? NavDirection.Right
                    : !bindingsToAct[MenuNavBinding.MenuSectionNext] &&
                        bindingsToAct[MenuNavBinding.MenuSectionPrevious]
                      ? NavDirection.Left
                      : undefined;

            if (sectionDirection) {
                state.navController.navigatePibling({
                    allowWrapping: state.menuNavOptions.allowWrapping,
                    direction: sectionDirection,
                });
                return;
            }

            const vertical =
                bindingsToAct[MenuNavBinding.MenuUp] && !bindingsToAct[MenuNavBinding.MenuDown]
                    ? NavDirection.Up
                    : !bindingsToAct[MenuNavBinding.MenuUp] &&
                        bindingsToAct[MenuNavBinding.MenuDown]
                      ? NavDirection.Down
                      : undefined;

            const horizontal =
                bindingsToAct[MenuNavBinding.MenuRight] && !bindingsToAct[MenuNavBinding.MenuLeft]
                    ? NavDirection.Right
                    : !bindingsToAct[MenuNavBinding.MenuRight] &&
                        bindingsToAct[MenuNavBinding.MenuLeft]
                      ? NavDirection.Left
                      : undefined;

            if (vertical) {
                state.navController.navigate({
                    allowWrapping: state.menuNavOptions.allowWrapping,
                    direction: vertical,
                });
            }
            if (horizontal) {
                state.navController.navigate({
                    allowWrapping: state.menuNavOptions.allowWrapping,
                    direction: horizontal,
                });
            }
        },
    });
}

export type AnthaMenuNavMod = ReturnType<typeof createAnthaMenuNavMod>;
