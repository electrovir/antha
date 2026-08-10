import {createMockRoomHandlerServerApiClient, createNewRoom} from '@antha/multiplayer-core';
import {ControllerFrameEvent} from '@antha/multiplayer-p2p-lock-step';
import {combineErrorMessages, log} from '@augment-vir/common';
import {createUtcFullDate} from 'date-vir';
import {css, defineElement, html, listen, nothing} from 'element-vir';
import {ViraError} from 'vira';
import {type AnthaDemo} from '../demo.js';
import {
    applyDemoCounterFrame,
    connectDemoCounterController,
    createDemoCounterController,
    syncDemoCounterState,
    type DemoCounterInput,
} from '../util/multiplayer-transition.js';

const DemoSingleplayerToMultiplayer = defineElement()({
    tagName: 'demo-singleplayer-to-multiplayer',
    state() {
        const controller = createDemoCounterController({
            gameId: 'singleplayer-to-multiplayer-demo',
        });
        const joiningController = createDemoCounterController({
            gameId: 'singleplayer-to-multiplayer-demo',
        });

        return {
            apiClient: createMockRoomHandlerServerApiClient(),
            cleanup: undefined as (() => void) | undefined,
            controller,
            count: 0,
            errorMessage: '',
            hasJoined: false,
            isMultiplayer: false,
            isJoining: false,
            isOpening: false,
            joiningCleanup: undefined as (() => void) | undefined,
            joiningController,
            joiningCount: 0,
            room: createNewRoom({
                roomName: 'Opened Singleplayer Game',
            }),
        };
    },
    styles: css`
        :host {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 16px;
            box-sizing: border-box;
            padding: 32px;

            & .actions,
            & .status {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 8px;
            }

            & .clients {
                display: grid;
                grid-template-columns: repeat(2, minmax(240px, 1fr));
                gap: 32px;
                width: 100%;
            }

            & .client {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 16px;
            }

            & .count {
                font-size: 32px;
                font-weight: bold;
            }

            & .status {
                font-family: monospace;
            }

            @media (max-width: 600px) {
                & .clients {
                    grid-template-columns: 1fr;
                }
            }
        }
    `,
    init({state, updateState}) {
        state.controller.startSingleplayer();
        updateState({
            cleanup: state.controller.listen(ControllerFrameEvent<DemoCounterInput>, ({detail}) => {
                updateState({
                    count: applyDemoCounterFrame({
                        actions: detail,
                        state: state.count,
                    }),
                });
            }),
            joiningCleanup: state.joiningController.listen(
                ControllerFrameEvent<DemoCounterInput>,
                ({detail}) => {
                    updateState({
                        joiningCount: applyDemoCounterFrame({
                            actions: detail,
                            state: state.joiningCount,
                        }),
                    });
                },
            ),
        });
    },
    cleanup({state}) {
        state.cleanup?.();
        state.joiningCleanup?.();
        state.controller.destroy();
        state.joiningController.destroy();
    },
    render({state, updateState}) {
        async function openToMultiplayer() {
            if (state.isOpening || state.isMultiplayer) {
                return;
            }

            updateState({
                errorMessage: '',
                isOpening: true,
            });

            try {
                await connectDemoCounterController({
                    apiClient: state.apiClient,
                    controller: state.controller,
                    room: state.room,
                });
                updateState({
                    isMultiplayer: true,
                    isOpening: false,
                });
            } catch (error) {
                log.error(error);
                updateState({
                    errorMessage: combineErrorMessages(
                        'Failed to open the game to multiplayer.',
                        error,
                    ),
                    isOpening: false,
                });
            }
        }

        async function joinMultiplayer() {
            if (!state.isMultiplayer || state.isJoining || state.hasJoined) {
                return;
            }

            updateState({
                errorMessage: '',
                isJoining: true,
            });

            try {
                await connectDemoCounterController({
                    apiClient: state.apiClient,
                    controller: state.joiningController,
                    room: state.room,
                });
                syncDemoCounterState({
                    controller: state.controller,
                    count: state.count,
                });
                updateState({
                    hasJoined: true,
                    isJoining: false,
                });
            } catch (error) {
                log.error(error);
                updateState({
                    errorMessage: combineErrorMessages(
                        'Failed to join the multiplayer game.',
                        error,
                    ),
                    isJoining: false,
                });
            }
        }

        return html`
            <h2>Open a singleplayer game to multiplayer</h2>
            <p>Play locally first. The multiplayer API is not contacted until you open the game.</p>
            <div class="clients">
                <section class="client">
                    <h3>Original player</h3>
                    <span class="count">${state.count}</span>
                    <div class="actions">
                        <button
                            ${listen('click', () => {
                                state.controller.act({
                                    increment: 1,
                                });
                            })}
                        >
                            Increment
                        </button>
                        ${state.isMultiplayer
                            ? nothing
                            : state.isOpening
                              ? html`
                                    <span>Opening multiplayer room...</span>
                                `
                              : html`
                                    <button ${listen('click', openToMultiplayer)}>
                                        Open to Multiplayer
                                    </button>
                                `}
                    </div>
                    <div class="status">
                        <strong>${state.isMultiplayer ? 'Multiplayer host' : 'Local only'}</strong>
                        <span>Client ID: ${state.controller.getClientId() || 'pending...'}</span>
                        ${state.isMultiplayer
                            ? html`
                                  <span>Room: ${state.room.roomName}</span>
                                  <span>State preserved at: ${state.count}</span>
                              `
                            : html`
                                  <span>No room has been published.</span>
                              `}
                    </div>
                </section>
                <section class="client">
                    <h3>Second player</h3>
                    <span class="count">${state.joiningCount}</span>
                    <div class="actions">
                        ${state.hasJoined
                            ? html`
                                  <button
                                      ${listen('click', () => {
                                          state.joiningController.act({
                                              increment: 1,
                                          });
                                      })}
                                  >
                                      Increment
                                  </button>
                              `
                            : state.isJoining
                              ? html`
                                    <span>Joining multiplayer room...</span>
                                `
                              : state.isMultiplayer
                                ? html`
                                      <button ${listen('click', joinMultiplayer)}>
                                          Join Multiplayer Game
                                      </button>
                                  `
                                : html`
                                      <span>Waiting for the game to open...</span>
                                  `}
                    </div>
                    <div class="status">
                        <strong>${state.hasJoined ? 'Connected player' : 'Not connected'}</strong>
                        <span>
                            Client ID: ${state.joiningController.getClientId() || 'pending...'}
                        </span>
                        ${state.hasJoined
                            ? html`
                                  <span>Room: ${state.room.roomName}</span>
                                  <span>Synced state: ${state.joiningCount}</span>
                              `
                            : html`
                                  <span>No multiplayer connection.</span>
                              `}
                    </div>
                </section>
            </div>
            ${state.errorMessage
                ? html`
                      <${ViraError}>${state.errorMessage}</${ViraError}>
                  `
                : nothing}
        `;
    },
});

export const singleplayerToMultiplayerDemo: AnthaDemo = {
    demoName: 'Singleplayer to Multiplayer',
    demoPathId: 'singleplayer-to-multiplayer',
    demoSortDate: createUtcFullDate('2026-08-05'),
    element: DemoSingleplayerToMultiplayer,
};
