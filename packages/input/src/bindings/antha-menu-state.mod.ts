import {defineAnthaMod} from '@antha/engine';
import {check} from '@augment-vir/assert';
import {getObjectTypedEntries} from '@augment-vir/common';
import {type AnthaReadRawInputModState} from '../raw-inputs/antha-read-raw-input.mod.js';
import {
    isPlayerMenuNavigationAllowed,
    MenuNavBinding,
    type MenuNavModState,
} from './antha-menu-nav.mod.js';

/**
 * Menu navigation state whose return path lists parent menus from the outermost to the nearest.
 *
 * @category Internal
 */
export type AnthaMenuState<MenuKey extends string = string> = {
    activeMenu: MenuKey | undefined;
    returnTo: MenuKey[];
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
 * Returns to the nearest parent menu and removes it from the path, or closes menu mode when the
 * path is empty.
 *
 * @category Internal
 */
export function getAnthaMenuReturnState<MenuKey extends string>(
    currentState: Readonly<AnthaMenuState<MenuKey>> | undefined,
): AnthaMenuState<MenuKey> {
    return {
        activeMenu: currentState?.returnTo.at(-1),
        returnTo: currentState?.returnTo.slice(0, -1) || [],
    };
}

/**
 * Resolves pause and back inputs into a menu-state transition.
 *
 * @category Internal
 */
export function getAnthaMenuStateForNavigation<MenuKey extends string>({
    menuExitWasTriggered,
    menuState,
    openPauseMenuWasTriggered,
    pauseMenu,
}: Readonly<{
    menuExitWasTriggered: boolean;
    menuState: Readonly<AnthaMenuState<MenuKey>> | undefined;
    openPauseMenuWasTriggered: boolean;
    pauseMenu: MenuKey;
}>) {
    const activeMenu = menuState?.activeMenu;

    if (!check.isDefined(activeMenu)) {
        return openPauseMenuWasTriggered
            ? {
                  activeMenu: pauseMenu,
                  returnTo: [],
              }
            : undefined;
    }

    return openPauseMenuWasTriggered || menuExitWasTriggered
        ? getAnthaMenuReturnState(menuState)
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
            const nextMenuState = state.activeBindings
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
                              const nextMenuState = getAnthaMenuStateForNavigation({
                                  menuExitWasTriggered:
                                      !!menuExitBinding && !menuExitBinding.actCount,
                                  menuState: state.menuState,
                                  openPauseMenuWasTriggered:
                                      !!openPauseMenuBinding && !openPauseMenuBinding.actCount,
                                  pauseMenu: pauseMenuKey,
                              });

                              if (!nextMenuState) {
                                  return undefined;
                              }

                              [
                                  openPauseMenuBinding,
                                  menuExitBinding,
                              ].forEach((menuBinding) => {
                                  if (menuBinding && !menuBinding.actCount) {
                                      menuBinding.actCount = 1;
                                      menuBinding.lastActDuration = menuBinding.holdDuration;
                                  }
                              });

                              return nextMenuState;
                          },
                      )
                      .find(check.isDefined)
                : undefined;

            if (nextMenuState) {
                state.menuState = nextMenuState;
            }

            state.isInMenu = check.isDefined(state.menuState?.activeMenu);
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
