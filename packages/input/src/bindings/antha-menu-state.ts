import {type LocalPlayerPosition} from '@antha/util';
import {type ActiveBinding} from './player-bindings.js';

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
