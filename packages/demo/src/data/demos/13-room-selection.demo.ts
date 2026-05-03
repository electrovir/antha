import {
    AnthaEngine,
    AnthaUi,
    css,
    defineAnthaMod,
    defineElement,
    html,
    listen,
    nothing,
} from '@antha/engine';
import {
    ControllerConnectionEvent,
    ControllerRoomListEvent,
    createMockRoomHandlerServerApi,
    createNewRoom,
    type MultiplayerApi,
    type MultiplayerClientRooms,
    type RoomInput,
    type ServiceAndRoomConnectionState,
} from '@antha/multiplayer-core';
import {
    createAnthaMultiplayerLockStepMod,
    type AnthaMultiplayerLockStepState,
} from '@antha/multiplayer-lock-step';
import {check} from '@augment-vir/assert';
import {combineErrorMessages, getObjectTypedValues, log, randomString} from '@augment-vir/common';
import {createUtcFullDate} from 'date-vir';
import {ViraError} from 'vira';
import {type AnthaDemo} from '../demo.js';

const roomSelectionGameId = 'room-selection-demo';

const DemoRoomLobby = defineElement<{
    lockStepMultiplayer: AnthaMultiplayerLockStepState['multiplayerLockStep'];
}>()({
    tagName: 'demo-room-lobby',
    styles: css`
        :host {
            display: flex;
            flex-direction: column;
        }
    `,
    state() {
        return {
            connectionError: '',
            connectionState: undefined as ServiceAndRoomConnectionState | undefined,
            joinedRoom: undefined as Readonly<RoomInput> | undefined,
            cleanup: undefined as (() => void) | undefined,
            availableRooms: {} as Readonly<MultiplayerClientRooms>,
        };
    },
    init({inputs, updateState, state}) {
        const cleanupCallbacks = [
            inputs.lockStepMultiplayer.multiplayerController.listen(
                ControllerConnectionEvent,
                (event) => {
                    updateState({
                        connectionState: event.detail,
                    });
                },
            ),
            inputs.lockStepMultiplayer.multiplayerController.listen(
                ControllerRoomListEvent,
                (event) => {
                    if (check.notDeepEquals(event.detail, state.availableRooms)) {
                        updateState({
                            availableRooms: event.detail,
                        });
                    }
                },
            ),
        ];

        updateState({
            cleanup() {
                cleanupCallbacks.forEach((callback) => callback());
            },
        });
    },
    cleanup({state, updateState}) {
        state.cleanup?.();
        updateState({
            cleanup: undefined,
        });
    },
    render({inputs, state, updateState}) {
        async function joinRoom(room: Readonly<RoomInput>) {
            try {
                await inputs.lockStepMultiplayer.multiplayerController.joinOrCreateRoom(room);
                updateState({
                    joinedRoom: room,
                });
            } catch (error) {
                log.error(error);
                updateState({
                    connectionError: combineErrorMessages('Failed to join room.', error),
                });
            }
        }

        if (state.joinedRoom) {
            const serviceLabel =
                state.connectionState?.service instanceof Error
                    ? `Error: ${state.connectionState.service.message}`
                    : state.connectionState?.service;

            const roomLabel =
                state.connectionState?.room instanceof Error
                    ? `Error: ${state.connectionState.room.message}`
                    : state.connectionState?.room;

            const statusLines = [
                `Client ID: ${inputs.lockStepMultiplayer.multiplayerController.getClientId() || 'pending...'}`,
                `Service: ${serviceLabel}`,
                `Room: ${roomLabel}`,
                `Room Name: ${state.joinedRoom.roomName}`,
                `Connected Clients: ${inputs.lockStepMultiplayer.multiplayerController.getAllClientIds().length}`,
            ];

            return html`
                <button
                    ${listen('click', () => {
                        inputs.lockStepMultiplayer.multiplayerController.leaveRoom();
                        updateState({
                            joinedRoom: undefined,
                        });
                    })}
                >
                    Leave
                </button>
                <strong>
                    ${inputs.lockStepMultiplayer.multiplayerController.isHost()
                        ? 'Host Client'
                        : 'Member Client'}
                </strong>
                ${statusLines.map((line) => {
                    return html`
                        <span>${line}</span>
                    `;
                })}
                ${state.connectionError
                    ? html`
                          <${ViraError}>${state.connectionError}</${ViraError}>
                      `
                    : nothing}
            `;
        } else {
            const roomTemplates = getObjectTypedValues(
                inputs.lockStepMultiplayer.availableRooms,
            ).map((room) => {
                return html`
                    <tr>
                        <th>${room.roomName}</th>
                        <td>${room.clientCount}</td>
                        <td>
                            <button
                                ${listen('click', async () => {
                                    try {
                                        await joinRoom({
                                            ...room,
                                            roomPassword: '',
                                        });
                                    } catch (error) {
                                        log.error(error);
                                        updateState({
                                            connectionError: combineErrorMessages(
                                                'Failed to join room.',
                                                error,
                                            ),
                                        });
                                    }
                                })}
                            >
                                Join
                            </button>
                        </td>
                    </tr>
                `;
            });

            return html`
                <button
                    ${listen('click', async () => {
                        await joinRoom(
                            createNewRoom({
                                roomName: `My Room ${randomString(4)}`,
                            }),
                        );
                    })}
                >
                    Create Room
                </button>
                ${state.connectionError
                    ? html`
                          <${ViraError}>${state.connectionError}</${ViraError}>
                      `
                    : nothing}
                <p>Rooms</p>
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Clients</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>${roomTemplates}</tbody>
                </table>
            `;
        }
    },
});

/**
 * Creates a mod that connects to the mock API, polls for rooms, and lets the user pick or create a
 * room. Once joined, it renders connection status and a leave button.
 */
function createRoomSelectionMod(mockApiRef: Readonly<MultiplayerApi>) {
    return defineAnthaMod<AnthaMultiplayerLockStepState>({
        modName: 'room-selector',
        async execute({state}) {
            if (!state.multiplayerLockStep) {
                return 'Loading...';
            }

            if (!state.multiplayerLockStep.multiplayerController.currentConnection) {
                await state.multiplayerLockStep.multiplayerController.startMultiplayer({
                    backendOrigin: mockApiRef.serviceOrigin,
                    multiplayerApi: mockApiRef,
                    roomUpdateInterval: {
                        seconds: 1,
                    },
                });
            }

            return html`
                <${DemoRoomLobby.assign({
                    lockStepMultiplayer: state.multiplayerLockStep,
                })}></${DemoRoomLobby}>
            `;
        },
    });
}

function createRoomSelectionEngine(mockApiRef: Readonly<MultiplayerApi>) {
    const lockStepMod = createAnthaMultiplayerLockStepMod({
        gameId: roomSelectionGameId,
    });
    const selectorMod = createRoomSelectionMod(mockApiRef);

    return new AnthaEngine({
        mods: [
            selectorMod,
            lockStepMod,
        ],
    });
}

const DemoRoomSelection = defineElement()({
    tagName: 'demo-room-selection',
    state() {
        return {
            engines: undefined as
                | undefined
                | {
                      clientA: AnthaEngine;
                      clientB: AnthaEngine;
                      clientC: AnthaEngine;
                      clientD: AnthaEngine;
                  },
        };
    },
    styles: css`
        :host {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-evenly;
            gap: 32px;
            padding: 32px;
            box-sizing: border-box;
        }

        antha-ui {
            width: unset;
            height: unset;
            border: 2px solid grey;
            border-radius: 4px;
            padding: 16px;
            flex-grow: 1;
            min-width: 280px;
        }

        table,
        th,
        td {
            border: 2px solid green;
        }

        p {
            margin: 4px 0;
        }
    `,
    init({state, updateState}) {
        if (!state.engines) {
            const mockApi = createMockRoomHandlerServerApi();

            updateState({
                engines: {
                    clientA: createRoomSelectionEngine(mockApi),
                    clientB: createRoomSelectionEngine(mockApi),
                    clientC: createRoomSelectionEngine(mockApi),
                    clientD: createRoomSelectionEngine(mockApi),
                },
            });
        }
    },
    cleanup({state, updateState}) {
        void Promise.all([
            state.engines?.clientA.reset(),
            state.engines?.clientB.reset(),
            state.engines?.clientC.reset(),
            state.engines?.clientD.reset(),
        ]).then(() => {
            updateState({
                engines: undefined,
            });
        });
    },
    render({state}) {
        if (!state.engines) {
            return html`
                <p>Initializing...</p>
            `;
        }

        return html`
            <${AnthaUi.assign({
                engine: state.engines.clientA,
            })}></${AnthaUi}>
            <${AnthaUi.assign({
                engine: state.engines.clientB,
            })}></${AnthaUi}>
            <${AnthaUi.assign({
                engine: state.engines.clientC,
            })}></${AnthaUi}>
            <${AnthaUi.assign({
                engine: state.engines.clientD,
            })}></${AnthaUi}>
        `;
    },
});

export const multiplayerRoomSelectionDemo: AnthaDemo = {
    demoName: 'Multiplayer Room Selection',
    demoPathId: 'multiplayer-room-selection',
    demoSortDate: createUtcFullDate('2026-04-08'),
    element: DemoRoomSelection,
};
