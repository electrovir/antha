import {defineAnthaMod} from '@antha/engine';
import {KnownInput} from '@antha/gamepad-type';
import {type LocalPlayerPosition} from '@antha/util';
import {check} from '@augment-vir/assert';
import {getObjectTypedEntries, type PartialWithUndefined} from '@augment-vir/common';
import {type AnyDuration, convertDuration} from 'date-vir';
import {NavController, type NavControllerOptions, NavDirection, NavValue} from 'device-navigation';
import {type AnthaReadRawInputModState} from '../raw-inputs/antha-read-raw-input.mod.js';
import {InputDirection} from '../raw-inputs/raw-input.js';
import {type AnthaMenuState, getAnthaMenuStateForNavigation} from './antha-menu-state.js';
import {
    AnyGamepad,
    type BindingAssignments,
    markBindingActed,
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

    OpenPauseMenu = 'open-pause-menu',
}

const directionalMenuNavBindings: ReadonlyArray<MenuNavBinding> = [
    MenuNavBinding.MenuUp,
    MenuNavBinding.MenuDown,
    MenuNavBinding.MenuLeft,
    MenuNavBinding.MenuRight,
];

/**
 * Default menu nav bindings for {@link AnthaMenuMod}.
 *
 * @category Internal
 */
export const defaultMenuNavBindings: Readonly<BindingAssignments<MenuNavBinding>> = {
    [MenuNavBinding.MenuLeft]: [
        {
            deviceKey: AnyGamepad,
            direction: InputDirection.Positive,
            inputName: KnownInput.DPadLeft,
        },
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
    [MenuNavBinding.MenuRight]: [
        {
            deviceKey: AnyGamepad,
            direction: InputDirection.Positive,
            inputName: KnownInput.DPadRight,
        },
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
    [MenuNavBinding.MenuUp]: [
        {
            deviceKey: AnyGamepad,
            direction: InputDirection.Positive,
            inputName: KnownInput.DPadUp,
        },
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
    [MenuNavBinding.MenuDown]: [
        {
            deviceKey: AnyGamepad,
            direction: InputDirection.Positive,
            inputName: KnownInput.DPadDown,
        },
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
            inputName: KnownInput.FaceAccept,
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
            inputName: KnownInput.FaceCancel,
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
            inputName: KnownInput.R1,
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
            inputName: KnownInput.L1,
        },
    ],
    [MenuNavBinding.OpenPauseMenu]: [
        {
            deviceKey: 'keyboard',
            direction: InputDirection.Positive,
            inputName: 'button-Escape',
        },
        {
            deviceKey: AnyGamepad,
            direction: InputDirection.Positive,
            inputName: KnownInput.Start,
        },
    ],
};

/**
 * Options for {@link AnthaMenuMod}.
 *
 * @category Menu
 */
export type MenuNavOptions = Readonly<
    Partial<{
        /**
         * The duration that any menu nav binding must be held before it starts auto-repeating.
         *
         * @default {milliseconds: 750}
         */
        repeatThreshold: Readonly<AnyDuration>;
        /**
         * The minimum interval between each repetition in a repeating menu nav binding.
         *
         * @default {milliseconds: 60}
         */
        repeatInterval: Readonly<AnyDuration>;
        /**
         * The minimum input value required to trigger directional menu navigation. Helps prevent
         * unintentional perpendicular navigation with joysticks in 2D menus.
         *
         * @default 0.8
         */
        minimumDirectionalInputValue: number;
        /**
         * Allow wrapping when navigating menu items.
         *
         * @default true
         */
        allowWrapping: boolean;
        /**
         * Prevent a one-dimensional nav tree from using its available axis for perpendicular
         * navigation.
         *
         * @default false
         */
        blockPerpendicularNavigation: boolean;
    }>
>;

/**
 * Options for the pause and back handling in {@link createAnthaMenuMod}.
 *
 * @category Menu
 */
export type AnthaMenuStateOptions<
    MenuKey extends string = string,
    InputConsumer extends string = string,
> = {
    /**
     * The raw input consumer set while any menu is open, so menu inputs don't also reach the game.
     * The consumer that was active when the menu opened is restored once every menu closes.
     */
    menuInputConsumerName: InputConsumer;
    /** The menu that the pause binding opens when no menu is open. */
    pauseMenuKey: MenuKey;
};

/**
 * State for {@link createAnthaMenuMod}.
 *
 * @category Internal
 */
export type AnthaMenuModState<MenuKey extends string = string> = Pick<
    AnthaReadRawInputModState,
    'rawInputConsumer'
> & {
    /**
     * Set to true to enable menu navigation. When the mod is given `menuState` options, this is
     * derived from `menuState` instead.
     */
    isInMenu: boolean;
    /**
     * The open menus. Only managed when the mod is given `menuState` options: pause and back
     * presses then open, pop, and clear it.
     */
    menuState: AnthaMenuState<MenuKey> | undefined;
    /** The raw input consumer to restore once every menu closes. */
    rawInputConsumerBeforeMenu: string | undefined;
    /**
     * When defined, only players explicitly set to true may use menu navigation. Omit this or set
     * to `undefined` to allow every player to run menu navigation.
     */
    allowedPlayerMenuNavigation: Partial<Record<LocalPlayerPosition, boolean>> | undefined;
    /** Omit or set to `undefined` to disable menu nav. */
    menuNavOptions: Required<MenuNavOptions> | undefined;
    /** All active bindings for all players. */
    activeBindings: PlayersActiveBindings;
    navController: NavController;
};

/** @category Internal */
export const defaultMenuNavOptions: Required<MenuNavOptions> = {
    repeatThreshold: {
        milliseconds: 750,
    },
    repeatInterval: {
        milliseconds: 60,
    },
    minimumDirectionalInputValue: 0.8,
    allowWrapping: true,
    blockPerpendicularNavigation: false,
};

/**
 * A pre-built mod that enables menu navigation. Set `isInMenu` on your game state to true to
 * activate it, or pass `menuState` options to have pause and back presses manage `menuState`,
 * `isInMenu`, and `rawInputConsumer` instead.
 *
 * @category Pre-Built Mods
 */
export function createAnthaMenuMod<
    MenuKey extends string = string,
    InputConsumer extends string = string,
>({
    menuState: menuStateOptions,
    ...options
}: Readonly<
    MenuNavOptions &
        NavControllerOptions &
        PartialWithUndefined<{
            menuState: Readonly<AnthaMenuStateOptions<NoInfer<MenuKey>, NoInfer<InputConsumer>>>;
        }>
> = {}) {
    return defineAnthaMod<AnthaMenuModState<NoInfer<MenuKey>>>({
        modName: 'antha-menu',
        initState: {
            menuNavOptions: {
                ...defaultMenuNavOptions,
                ...options,
            },
        },
        execute({state, hostElement}) {
            if (!state.navController) {
                state.navController = new NavController(hostElement, {
                    alwaysRequireFocused: true,
                    activateOnMouseUp: false,
                    ...options,
                });
            }
            if (menuStateOptions) {
                updateMenuState({
                    menuStateOptions,
                    state,
                });
            }
            if (!state.menuNavOptions || !state.activeBindings) {
                return;
            } else if (!state.isInMenu) {
                consumeInactiveMenuActivationBindings({
                    activeBindings: state.activeBindings,
                    allowedPlayerMenuNavigation: state.allowedPlayerMenuNavigation,
                });

                return;
            }

            const repeatThreshold = convertDuration(state.menuNavOptions.repeatThreshold, {
                milliseconds: true,
            }).milliseconds;
            const repeatInterval = convertDuration(state.menuNavOptions.repeatInterval, {
                milliseconds: true,
            }).milliseconds;
            const minimumDirectionalInputValue = state.menuNavOptions.minimumDirectionalInputValue;

            const bindingsToAct: Partial<Record<MenuNavBinding, boolean>> = {};
            const activeMenuBindings: Partial<Record<MenuNavBinding, boolean>> = {};

            getObjectTypedEntries(state.activeBindings).forEach(
                ([
                    playerPosition,
                    playerActiveBindings,
                ]) => {
                    if (
                        !isPlayerMenuNavigationAllowed({
                            allowedPlayerMenuNavigation: state.allowedPlayerMenuNavigation,
                            playerPosition,
                        })
                    ) {
                        return;
                    }

                    getObjectTypedEntries(playerActiveBindings).forEach(
                        ([
                            bindingName,
                            activeBinding,
                        ]) => {
                            if (!check.isEnumValue(bindingName, MenuNavBinding)) {
                                return;
                            }

                            activeMenuBindings[bindingName] = true;

                            if (
                                (!directionalMenuNavBindings.includes(bindingName) ||
                                    activeBinding.value >= minimumDirectionalInputValue) &&
                                (!activeBinding.actCount ||
                                    (directionalMenuNavBindings.includes(bindingName) &&
                                        activeBinding.holdDuration.milliseconds >=
                                            repeatThreshold &&
                                        activeBinding.holdDuration.milliseconds -
                                            activeBinding.lastActDuration.milliseconds >
                                            repeatInterval))
                            ) {
                                bindingsToAct[bindingName] = true;
                                activeBinding.actCount++;
                                activeBinding.lastActDuration = activeBinding.holdDuration;
                            }
                        },
                    );
                },
            );

            if (bindingsToAct[MenuNavBinding.MenuEnter]) {
                state.navController.enterInto({
                    fallbackToActivate: true,
                });
                return;
            } else if (bindingsToAct[MenuNavBinding.MenuExit]) {
                state.navController.exitOutOf();
                return;
            }

            if (
                !activeMenuBindings[MenuNavBinding.MenuEnter] &&
                state.navController.currentNavEntry?.entry.navValue === NavValue.Active
            ) {
                state.navController.deactivate();
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
                    blockPerpendicularNavigation: state.menuNavOptions.blockPerpendicularNavigation,
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
                    blockPerpendicularNavigation: state.menuNavOptions.blockPerpendicularNavigation,
                    direction: vertical,
                });
            }
            if (horizontal) {
                state.navController.navigate({
                    allowWrapping: state.menuNavOptions.allowWrapping,
                    blockPerpendicularNavigation: state.menuNavOptions.blockPerpendicularNavigation,
                    direction: horizontal,
                });
            }
        },
    });
}

/**
 * Applies pause and back presses to `menuState`, then keeps `isInMenu` and `rawInputConsumer` in
 * line with it. Runs before navigation so navigation sees the updated `isInMenu` in the same
 * execution.
 */
function updateMenuState<MenuKey extends string>({
    menuStateOptions,
    state,
}: Readonly<{
    menuStateOptions: Readonly<AnthaMenuStateOptions<MenuKey>>;
    state: Partial<AnthaMenuModState<MenuKey>>;
}>) {
    const menuTransition = state.activeBindings
        ? getObjectTypedEntries(state.activeBindings)
              .map(
                  ([
                      playerPosition,
                      playerActiveBindings,
                  ]) => {
                      if (
                          !isPlayerMenuNavigationAllowed({
                              allowedPlayerMenuNavigation: state.allowedPlayerMenuNavigation,
                              playerPosition,
                          })
                      ) {
                          return undefined;
                      }

                      const openPauseMenuBinding =
                          playerActiveBindings[MenuNavBinding.OpenPauseMenu];
                      const menuExitBinding = playerActiveBindings[MenuNavBinding.MenuExit];
                      const playerMenuTransition = getAnthaMenuStateForNavigation({
                          menuExitWasTriggered: !!menuExitBinding && !menuExitBinding.actCount,
                          menuState: state.menuState,
                          openPauseMenuTrigger:
                              openPauseMenuBinding && !openPauseMenuBinding.actCount
                                  ? {
                                        activeBinding: openPauseMenuBinding,
                                        playerPosition,
                                    }
                                  : undefined,
                          pauseMenu: menuStateOptions.pauseMenuKey,
                      });

                      if (!playerMenuTransition) {
                          return undefined;
                      }

                      [
                          openPauseMenuBinding,
                          menuExitBinding,
                      ].forEach(markBindingActed);

                      return playerMenuTransition;
                  },
              )
              .find(check.isDefined)
        : undefined;

    if (menuTransition) {
        state.menuState = menuTransition.nextMenuState;
    }

    const isInMenu = !!state.menuState;

    if (isInMenu && !state.isInMenu) {
        state.rawInputConsumerBeforeMenu = state.rawInputConsumer;
        state.rawInputConsumer = menuStateOptions.menuInputConsumerName;
    } else if (!isInMenu && state.isInMenu) {
        state.rawInputConsumer = state.rawInputConsumerBeforeMenu;
    }

    state.isInMenu = isInMenu;
}

function consumeInactiveMenuActivationBindings({
    activeBindings,
    allowedPlayerMenuNavigation,
}: Readonly<{
    activeBindings: PlayersActiveBindings;
    allowedPlayerMenuNavigation: AnthaMenuModState['allowedPlayerMenuNavigation'];
}>) {
    getObjectTypedEntries(activeBindings).forEach(
        ([
            playerPosition,
            playerActiveBindings,
        ]) => {
            if (
                !isPlayerMenuNavigationAllowed({
                    allowedPlayerMenuNavigation,
                    playerPosition,
                })
            ) {
                return;
            }

            [
                MenuNavBinding.MenuEnter,
                MenuNavBinding.MenuExit,
            ].forEach((bindingName) => {
                markBindingActed(playerActiveBindings[bindingName]);
            });
        },
    );
}

/**
 * Checks whether the given player may use menu navigation under the current allowlist.
 *
 * @category Internal
 */
export function isPlayerMenuNavigationAllowed({
    allowedPlayerMenuNavigation,
    playerPosition,
}: Readonly<{
    allowedPlayerMenuNavigation: AnthaMenuModState['allowedPlayerMenuNavigation'];
    playerPosition: LocalPlayerPosition;
}>) {
    return (
        allowedPlayerMenuNavigation == undefined || !!allowedPlayerMenuNavigation[playerPosition]
    );
}

/**
 * The mod created by {@link createAnthaMenuMod}.
 *
 * @category Internal
 */
export type AnthaMenuMod = ReturnType<typeof createAnthaMenuMod>;
