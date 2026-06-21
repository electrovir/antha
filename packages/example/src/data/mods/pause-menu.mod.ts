import {defineAnthaMod} from '@antha/engine';
import {
    AnthaKeyboard,
    MenuNavBinding,
    type MenuNavModState,
    type NavController,
} from '@antha/input';
import {listenToObject} from '@antha/util';
import {check} from '@augment-vir/assert';
import {type MaybePromise} from '@augment-vir/common';
import {NavAction} from 'device-navigation';
import {css, defineElement, html, listen, nothing} from 'element-vir';
import {type RemoveListenerCallback} from 'typed-event-target';
import {noNativeSpacing, viraTheme} from 'vira';
import {GameButton} from '../../ui/elements/common/game-button.element.js';

export type ExamplePauseMenuModState = {
    /**
     * - 0 for unpaused
     * - A number for how menu menus deep the player is
     */
    isPaused: boolean;
    menuState: {
        showSettings: boolean;
    };
} & MenuNavModState;

type PauseButtonParams = Readonly<{state: Partial<ExamplePauseMenuModState>}>;

type PauseButton = {
    action(this: void, params: PauseButtonParams): MaybePromise<void>;
    hidden?: undefined | ((this: void, params: PauseButtonParams) => boolean);
    text: string | ((this: void, params: PauseButtonParams) => string);
};

const pauseButtons: PauseButton[] = [
    {
        text: 'Resume',
        action({state}) {
            state.isPaused = false;
        },
    },
    {
        text: 'Settings',
        action({state}) {
            state.menuState = {
                showSettings: true,
            };
        },
    },
];

/** To be used later. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ExampleEnterPlayerNameElement = defineElement<{
    navController: NavController;
}>()({
    tagName: 'example-enter-player-name',
    render({inputs}) {
        return html`
            <${AnthaKeyboard.assign({
                showHideButton: false,
                navController: inputs.navController,
            })}></${AnthaKeyboard}>
        `;
    },
});

export const ExamplePauseMenu = defineElement<{
    gameState: Partial<ExamplePauseMenuModState>;
}>()({
    tagName: 'example-pause-menu',
    state() {
        return {
            showMenu: false,
            navControllerCleanup: new Map<NavController, RemoveListenerCallback>(),
        };
    },
    styles({hostClasses}) {
        return css`
            :host {
                position: fixed;
                width: 100dvw;
                height: 100dvh;
                top: 0;
                left: 0;
                display: none;
                flex-direction: column;
                gap: 32px;
                justify-content: safe center;
                align-items: center;
                box-sizing: border-box;
                padding: 8px;
            }
            .buttons-wrapper {
                max-width: 100%;
                display: flex;
                flex-direction: column;
                gap: 8px;
                font-size: 32px;
            }
            h1 {
                ${noNativeSpacing};
                font-weight: normal;
                text-align: center;
                font-family: 'AirStrikePlat';
                font-size: 64px;
                color: ${viraTheme.colors['vira-blue-foreground-header'].foreground.value};
            }

            footer {
                position: absolute;
                bottom: 0;
                width: 100%;
                background-color: black;
            }

            ${hostClasses['example-pause-menu-visible'].selector} {
                display: flex;
            }
        `;
    },
    hostClasses: {
        'example-pause-menu-visible'({state}) {
            return state.showMenu;
        },
    },
    init({host, inputs}) {
        listenToObject(inputs.gameState, 'isPaused', () => {
            host.requestUpdate();
        });
        listenToObject(inputs.gameState, 'menuState', () => {
            host.requestUpdate();
        });
    },
    render({inputs, state, updateState}) {
        const navController = inputs.gameState.navController;
        if (!inputs.gameState.isPaused || !navController) {
            return nothing;
        }

        updateState({
            showMenu: true,
        });

        if (!state.navControllerCleanup.has(navController)) {
            state.navControllerCleanup.forEach((cleanup) => cleanup());
            state.navControllerCleanup.clear();
            state.navControllerCleanup.set(
                navController,
                navController.listenToAll((event) => {
                    if (event.detail.navAction === NavAction.Exit) {
                        if (inputs.gameState.menuState?.showSettings) {
                            inputs.gameState.menuState = {
                                showSettings: false,
                            };
                        } else {
                            inputs.gameState.isPaused = false;
                        }
                    }
                }),
            );
        }

        const headerTemplate = html`
            <header><h1>Example</h1></header>
        `;

        if (inputs.gameState.menuState?.showSettings) {
            return html`
                ${headerTemplate} Settings here

                <div class="buttons-wrapper">
                    <${GameButton.assign({
                        text: 'Back',
                        navController,
                    })}
                        ${listen('click', () => {
                            inputs.gameState.menuState = {
                                showSettings: false,
                            };
                        })}
                    ></${GameButton}>
                </div>
            `;
        } else {
            const buttonTemplates = pauseButtons.map((pauseButton) => {
                const text: string = check.isString(pauseButton.text)
                    ? pauseButton.text
                    : pauseButton.text({
                          state: inputs.gameState,
                      });

                return html`
                    <${GameButton.assign({
                        text,
                        navController,
                    })}
                        ${listen('click', async () => {
                            await pauseButton.action({
                                state: inputs.gameState,
                            });
                        })}
                    ></${GameButton}>
                `;
            });

            return html`
                ${headerTemplate}
                <div class="buttons-wrapper">${buttonTemplates}</div>
            `;
        }
    },
});

export const examplePauseMenuMod = defineAnthaMod<ExamplePauseMenuModState>({
    modName: 'example-pause-menu',
    initState: {
        isPaused: false,
        menuState: {
            showSettings: false,
        },
    },
    execute({state}) {
        if (!state.isPaused) {
            Object.values(state.activeBindings || {}).forEach((bindings) => {
                const openPauseMenuBinding = bindings[MenuNavBinding.OpenPauseMenu];

                if (openPauseMenuBinding && !openPauseMenuBinding.actCount) {
                    openPauseMenuBinding.actCount = 1;
                    state.isPaused = true;
                }
            });
        }

        state.isInMenu = !!state.isPaused;

        return html`
            <${ExamplePauseMenu.assign({
                gameState: state,
            })}></${ExamplePauseMenu}>
        `;
    },
});
