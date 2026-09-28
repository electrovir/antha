import {defineAnthaMod} from '@antha/engine';
import {type LocalPlayerPosition} from '@antha/util';
import {check} from '@augment-vir/assert';
import {getObjectTypedEntries} from '@augment-vir/common';
import {type AnthaReadRawInputModState} from '../raw-inputs/antha-read-raw-input.mod.js';
import {
    isPlayerMenuNavigationAllowed,
    MenuNavBinding,
    type MenuNavModState,
} from './antha-menu-nav.mod.js';
import {markBindingActed, type ActiveBinding} from './player-bindings.js';

/**
 * The player press that opened a menu.
 *
 * @category Internal
 */
export type AnthaMenuOpener = {
    /** The binding press, including the raw inputs that triggered it. */
    activeBinding: ActiveBinding;
    playerPosition: LocalPlayerPosition;
};

/**
 * Currently open menu state.
 *
 * @category Internal
 */
export type AnthaMenuState<MenuKey extends string = string> = {
    /**
     * The open menus from the outermost to the active one (the last entry). Never empty: popping
     * the last menu clears the whole menu state instead.
     */
    menuHistory: MenuKey[];
    /**
     * The player press that opened the outermost menu. Kept until the menu state is cleared.
     * `undefined` when code opened it.
     */
    openedBy: AnthaMenuOpener | undefined;
};

/**
 * State consumed or updated by {@link createAnthaMenuStateMod}.
 *
 * @category Internal
 */
export type AnthaMenuStateModState<MenuKey extends string = string> = MenuNavModState &
    AnthaReadRawInputModState & {
        menuState: AnthaMenuState<MenuKey> | undefined;
    };

/**
 * Closes the active menu, returning to its parent menu. Clears the menu state when the active menu
 * has no parent.
 *
 * @category Util
 */
export function popAnthaMenuState<MenuKey extends string>(
    currentState: Readonly<AnthaMenuState<MenuKey>> | undefined,
): AnthaMenuState<MenuKey> | undefined {
    return currentState && currentState.menuHistory.length > 1
        ? {
              menuHistory: currentState.menuHistory.slice(0, -1),
              openedBy: currentState.openedBy,
          }
        : undefined;
}

/**
 * Opens `submenu` on top of the current menus so backing out of it returns to the current active
 * menu. When no menu is open, `submenu` opens with no {@link AnthaMenuState.openedBy}.
 *
 * @category Util
 */
export function pushAnthaMenuState<MenuKey extends string>(
    currentState: Readonly<AnthaMenuState<MenuKey>> | undefined,
    submenu: NoInfer<MenuKey>,
): AnthaMenuState<MenuKey> {
    return {
        menuHistory: [
            ...(currentState?.menuHistory || []),
            submenu,
        ],
        openedBy: currentState?.openedBy,
    };
}

/**
 * Resolves pause and back inputs into a menu-state transition. Returns `undefined` when nothing
 * triggered a transition. A transition that closes every menu has an `undefined` `nextMenuState`.
 *
 * @category Util
 */
export function getAnthaMenuStateForNavigation<MenuKey extends string>({
    menuExitWasTriggered,
    menuState,
    openPauseMenuTrigger,
    pauseMenu,
}: Readonly<{
    menuExitWasTriggered: boolean;
    menuState: Readonly<AnthaMenuState<MenuKey>> | undefined;
    /** Set when a player freshly pressed the pause binding. */
    openPauseMenuTrigger: AnthaMenuOpener | undefined;
    pauseMenu: MenuKey;
}>):
    | {
          nextMenuState: AnthaMenuState<MenuKey> | undefined;
      }
    | undefined {
    if (!menuState) {
        return openPauseMenuTrigger
            ? {
                  nextMenuState: {
                      menuHistory: [
                          pauseMenu,
                      ],
                      openedBy: openPauseMenuTrigger,
                  },
              }
            : undefined;
    }

    return openPauseMenuTrigger || menuExitWasTriggered
        ? {
              nextMenuState: popAnthaMenuState(menuState),
          }
        : undefined;
}

/**
 * Switches the raw-input consumer and menu-navigation state on pause/back inputs. Add this before
 * `createAnthaMenuNavMod` so navigation sees the updated `isInMenu` value.
 *
 * @category Pre-Built Mods
 */
export function createAnthaMenuStateMod<
    MenuKey extends string = string,
    InputConsumer extends string = string,
>({
    gameInputConsumerName,
    menuInputConsumerName,
    pauseMenuKey,
}: Readonly<{
    /**
     * The name assigned to inputs consumed by the game so that they don't get consumed by menus at
     * the same time.
     */
    gameInputConsumerName: NoInfer<InputConsumer>;
    /**
     * The name assigned to inputs consumed by menus so that they don't get consumed by the game at
     * the same time.
     */
    menuInputConsumerName: NoInfer<InputConsumer>;
    pauseMenuKey: NoInfer<MenuKey>;
}>) {
    return defineAnthaMod<AnthaMenuStateModState<NoInfer<MenuKey>>>({
        modName: 'antha-menu-state',
        execute({state}) {
            const menuTransition = state.activeBindings
                ? getObjectTypedEntries(state.activeBindings)
                      .map(
                          ([
                              playerPosition,
                              playerActiveBindings,
                          ]) => {
                              if (
                                  !isPlayerMenuNavigationAllowed({
                                      allowedPlayerMenuNavigation:
                                          state.allowedPlayerMenuNavigation,
                                      playerPosition,
                                  })
                              ) {
                                  return undefined;
                              }

                              const openPauseMenuBinding =
                                  playerActiveBindings[MenuNavBinding.OpenPauseMenu];
                              const menuExitBinding = playerActiveBindings[MenuNavBinding.MenuExit];
                              const playerMenuTransition = getAnthaMenuStateForNavigation({
                                  menuExitWasTriggered:
                                      !!menuExitBinding && !menuExitBinding.actCount,
                                  menuState: state.menuState,
                                  openPauseMenuTrigger:
                                      openPauseMenuBinding && !openPauseMenuBinding.actCount
                                          ? {
                                                activeBinding: openPauseMenuBinding,
                                                playerPosition,
                                            }
                                          : undefined,
                                  pauseMenu: pauseMenuKey,
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

            state.isInMenu = !!state.menuState;
            state.rawInputConsumer = state.isInMenu ? menuInputConsumerName : gameInputConsumerName;
        },
    });
}

/**
 * The mod created by {@link createAnthaMenuStateMod}.
 *
 * @category Internal
 */
export type AnthaMenuStateMod = ReturnType<typeof createAnthaMenuStateMod>;
