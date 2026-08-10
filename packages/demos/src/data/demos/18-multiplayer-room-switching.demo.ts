import {
    createMockRoomHandlerServerApiClient,
    createNewRoom,
    type RoomInput,
} from '@antha/multiplayer-core';
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
    initializeDemoMultiplayer,
    syncDemoCounterState,
    type DemoCounterInput,
} from '../util/multiplayer-transition.js';

const roomSwitchingGameId = 'multiplayer-room-switching-demo';
const roomAInitialCount = 100;
const roomBInitialCount = 200;

const DemoMultiplayerRoomSwitching = defineElement()({
    tagName: 'demo-multiplayer-room-switching',
    state() {
        return {
            apiClient: createMockRoomHandlerServerApiClient(),
            cleanup: undefined as (() => void) | undefined,
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
            roomB: createNewRoom({
                roomName: 'Room B',
            }),
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
            cleanup: state.traveler.listen(ControllerFrameEvent<DemoCounterInput>, ({detail}) => {
                updateState({
                    currentCount: applyDemoCounterFrame({
                        actions: detail,
                        state: state.currentCount,
                    }),
                });
            }),
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
                syncDemoCounterState({
                    controller: state.hostA,
                    count: roomAInitialCount,
                });
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
        state.cleanup?.();
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
                syncDemoCounterState({
                    controller: room.roomId === state.roomA.roomId ? state.hostA : state.hostB,
                    count:
                        room.roomId === state.roomA.roomId ? roomAInitialCount : roomBInitialCount,
                });
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
                          <span>Room A state: ${roomAInitialCount}</span>
                          <span>Room B state: ${roomBInitialCount}</span>
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
