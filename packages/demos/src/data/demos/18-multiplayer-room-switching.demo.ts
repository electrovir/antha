import {
    createMockRoomHandlerServerApiClient,
    createNewRoom,
    type RoomInput,
} from '@antha/multiplayer-core';
import {combineErrorMessages, log} from '@augment-vir/common';
import {createUtcFullDate} from 'date-vir';
import {css, defineElement, html, listen, nothing} from 'element-vir';
import {ViraError} from 'vira';
import {type AnthaDemo} from '../demo.js';
import {
    connectDemoCounterController,
    createDemoCounterController,
    initializeDemoMultiplayer,
    listenToDemoCounter,
} from '../util/multiplayer-transition.js';

const roomSwitchingGameId = 'multiplayer-room-switching-demo';

const DemoMultiplayerRoomSwitching = defineElement()({
    tagName: 'demo-multiplayer-room-switching',
    state() {
        return {
            apiClient: createMockRoomHandlerServerApiClient(),
            cleanups: [] as (() => void)[],
            currentCount: 0,
            currentRoom: undefined as Readonly<RoomInput> | undefined,
            errorMessage: '',
            hostA: createDemoCounterController({
                gameId: roomSwitchingGameId,
            }),
            hostB: createDemoCounterController({
                gameId: roomSwitchingGameId,
            }),
            isReady: false,
            isSwitching: false,
            roomA: createNewRoom({
                roomName: 'Room A',
            }),
            roomACount: 100,
            roomB: createNewRoom({
                roomName: 'Room B',
            }),
            roomBCount: 200,
            traveler: createDemoCounterController({
                gameId: roomSwitchingGameId,
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

            & .room-buttons,
            & .status {
                display: flex;
                gap: 8px;
            }

            & .status {
                flex-direction: column;
                font-family: monospace;
            }

            & .count {
                font-size: 32px;
                font-weight: bold;
            }
        }
    `,
    init({state, updateState}) {
        updateState({
            cleanups: [
                listenToDemoCounter({
                    controller: state.traveler,
                    getCount() {
                        return state.currentCount;
                    },
                    setCount(currentCount) {
                        updateState({
                            currentCount,
                        });
                    },
                }),
                listenToDemoCounter({
                    controller: state.hostA,
                    getCount() {
                        return state.roomACount;
                    },
                    setCount(roomACount) {
                        updateState({
                            roomACount,
                        });
                    },
                }),
                listenToDemoCounter({
                    controller: state.hostB,
                    getCount() {
                        return state.roomBCount;
                    },
                    setCount(roomBCount) {
                        updateState({
                            roomBCount,
                        });
                    },
                }),
            ],
        });

        async function initializeRooms() {
            try {
                await Promise.all([
                    connectDemoCounterController({
                        apiClient: state.apiClient,
                        controller: state.hostA,
                        room: state.roomA,
                    }),
                    connectDemoCounterController({
                        apiClient: state.apiClient,
                        controller: state.hostB,
                        room: state.roomB,
                    }),
                    initializeDemoMultiplayer({
                        apiClient: state.apiClient,
                        controller: state.traveler,
                    }),
                ]);
                await state.traveler.joinOrCreateRoom(state.roomA);
                updateState({
                    currentRoom: state.roomA,
                    isReady: true,
                });
            } catch (error) {
                log.error(error);
                updateState({
                    errorMessage: combineErrorMessages(
                        'Failed to initialize the room-switching demo.',
                        error,
                    ),
                });
            }
        }

        void initializeRooms();
    },
    cleanup({state}) {
        state.cleanups.forEach((cleanup) => {
            cleanup();
        });
        state.hostA.destroy();
        state.hostB.destroy();
        state.traveler.destroy();
    },
    render({state, updateState}) {
        async function switchRoom(room: Readonly<RoomInput>) {
            if (state.isSwitching || state.currentRoom?.roomId === room.roomId) {
                return;
            }

            updateState({
                errorMessage: '',
                isSwitching: true,
            });

            try {
                await state.traveler.joinOrCreateRoom(room);
                updateState({
                    currentRoom: room,
                    isSwitching: false,
                });
            } catch (error) {
                log.error(error);
                updateState({
                    errorMessage: combineErrorMessages('Failed to switch rooms.', error),
                    isSwitching: false,
                });
            }
        }

        return html`
            <h2>Jump between multiplayer rooms</h2>
            <p>
                The current room remains connected until the destination room finishes connecting.
            </p>
            ${state.isReady
                ? html`
                      <div class="room-buttons">
                          <button ${listen('click', () => switchRoom(state.roomA))}>
                              Join ${state.roomA.roomName}
                          </button>
                          <button ${listen('click', () => switchRoom(state.roomB))}>
                              Join ${state.roomB.roomName}
                          </button>
                      </div>
                      <span class="count">${state.currentCount}</span>
                      <div class="status">
                          <strong>
                              ${state.isSwitching
                                  ? 'Switching rooms...'
                                  : `Connected to ${state.currentRoom?.roomName || 'unknown room'}`}
                          </strong>
                          <span>Client ID: ${state.traveler.getClientId() || 'pending...'}</span>
                          <span>Room A state: ${state.roomACount}</span>
                          <span>Room B state: ${state.roomBCount}</span>
                      </div>
                  `
                : html`
                      <span>Initializing two multiplayer rooms...</span>
                  `}
            ${state.errorMessage
                ? html`
                      <${ViraError}>${state.errorMessage}</${ViraError}>
                  `
                : nothing}
        `;
    },
});

export const multiplayerRoomSwitchingDemo: AnthaDemo = {
    demoName: 'Multiplayer Room Switching',
    demoPathId: 'multiplayer-room-switching',
    demoSortDate: createUtcFullDate('2026-08-05'),
    element: DemoMultiplayerRoomSwitching,
};
