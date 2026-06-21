import {AnthaEngine, AnthaUi, defineAnthaMod} from '@antha/engine';
import {
    ControllerConnectionEvent,
    createMockRoomHandlerServerApiClient,
    createNewRoom,
    type ApiAndRoomConnectionState,
    type MultiplayerApiClient,
    type MultiplayerClientRooms,
    type RoomInput,
} from '@antha/multiplayer-core';
import {
    createAnthaMultiplayerP2pLockStepMod,
    type AnthaMultiplayerP2pLockStepState,
} from '@antha/multiplayer-p2p-lock-step';
import {check} from '@augment-vir/assert';
import {combineErrorMessages, getObjectTypedValues, log, randomString} from '@augment-vir/common';
import {createUtcFullDate} from 'date-vir';
import {css, defineElement, html, listen, nothing} from 'element-vir';
import {ViraError} from 'vira';
import {type AnthaDemo} from '../demo.js';

const roomSelectionGameId = 'room-selection-demo';

const DemoRoomLobby = defineElement<{
    p2pLockStepMultiplayer: AnthaMultiplayerP2pLockStepState['multiplayerP2pLockStep'];
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
            connectionState: undefined as ApiAndRoomConnectionState | undefined,
            joinedRoom: undefined as Readonly<RoomInput> | undefined,
            cleanup: undefined as (() => void) | undefined,
            availableRooms: {} as Readonly<MultiplayerClientRooms>,
        };
    },
    init({inputs, updateState, state}) {
        const cleanupCallbacks = [
            inputs.p2pLockStepMultiplayer.multiplayerController.listen(
                ControllerConnectionEvent,
                (event) => {
                    updateState({
                        connectionState: event.detail,
                    });
                },
            ),
            () => {
                inputs.p2pLockStepMultiplayer.multiplayerController.stopRoomUpdates();
            },
            inputs.p2pLockStepMultiplayer.multiplayerController.startRoomUpdates((rooms) => {
                if (check.notDeepEquals(rooms, state.availableRooms)) {
                    updateState({
                        availableRooms: rooms,
                    });
                }
            }),
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
                await inputs.p2pLockStepMultiplayer.multiplayerController.joinOrCreateRoom(room);
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
            const apiLabel =
                state.connectionState?.api instanceof Error
                    ? `Error: ${state.connectionState.api.message}`
                    : state.connectionState?.api;

            const roomLabel =
                state.connectionState?.room instanceof Error
                    ? `Error: ${state.connectionState.room.message}`
                    : state.connectionState?.room;

            const statusLines = [
                `Client ID: ${inputs.p2pLockStepMultiplayer.multiplayerController.getClientId() || 'pending...'}`,
                `Api: ${apiLabel}`,
                `Room: ${roomLabel}`,
                `Room Name: ${state.joinedRoom.roomName}`,
                `Connected Clients: ${inputs.p2pLockStepMultiplayer.multiplayerController.getAllClientIds().length}`,
            ];

            return html`
                <button
                    ${listen('click', () => {
                        inputs.p2pLockStepMultiplayer.multiplayerController.leaveRoom();
                        updateState({
                            joinedRoom: undefined,
                        });
                    })}
                >
                    Leave
                </button>
                <strong>
                    ${inputs.p2pLockStepMultiplayer.multiplayerController.isHost()
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
            const roomTemplates = getObjectTypedValues(state.availableRooms).map((room) => {
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

function createRoomSelectionMod(mockApiClientRef: Readonly<MultiplayerApiClient>) {
    return defineAnthaMod<AnthaMultiplayerP2pLockStepState>({
        modName: 'room-selector',
        async execute({state}) {
            if (!state.multiplayerP2pLockStep) {
                return 'Loading...';
            }

            if (!state.multiplayerP2pLockStep.multiplayerController.currentConnection) {
                await state.multiplayerP2pLockStep.multiplayerController.initMultiplayer({
                    backendOrigin: mockApiClientRef.baseUrl,
                    multiplayerApiClient: mockApiClientRef,
                    roomUpdateInterval: {
                        seconds: 1,
                    },
                });
            }

            return html`
                <${DemoRoomLobby.assign({
                    p2pLockStepMultiplayer: state.multiplayerP2pLockStep,
                })}></${DemoRoomLobby}>
            `;
        },
    });
}

function createRoomSelectionEngine(mockApiClientRef: Readonly<MultiplayerApiClient>) {
    const multiplayerP2pLockStepMod = createAnthaMultiplayerP2pLockStepMod({
        gameId: roomSelectionGameId,
    });
    const selectorMod = createRoomSelectionMod(mockApiClientRef);

    return new AnthaEngine({
        mods: [
            selectorMod,
            multiplayerP2pLockStepMod,
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
            const mockApiClient = createMockRoomHandlerServerApiClient();

            updateState({
                engines: {
                    clientA: createRoomSelectionEngine(mockApiClient),
                    clientB: createRoomSelectionEngine(mockApiClient),
                    clientC: createRoomSelectionEngine(mockApiClient),
                    clientD: createRoomSelectionEngine(mockApiClient),
                },
            });
        }
    },
    cleanup({state, updateState}) {
        void Promise.all(Object.values(state.engines || {}).map((engine) => engine.reset())).then(
            () => {
                updateState({
                    engines: undefined,
                });
            },
        );
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
