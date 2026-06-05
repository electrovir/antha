import {
    AnthaEngine,
    AnthaUi,
    css,
    defineAnthaMod,
    defineElement,
    html,
    listen,
    nothing,
    type AnthaMod,
} from '@antha/engine';
import {
    ControllerClientEvent,
    ControllerConnectionEvent,
    ControllerRoomListEvent,
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
import {ViraError} from 'vira';
import {type AnthaDemo} from '../demo.js';

const roomModeSelectionGameId = 'room-mode-selection-demo';

enum RoomMode {
    Multiplayer = 'multiplayer',
    Singleplayer = 'singleplayer',
}

type SelectableRoomState = AnthaMultiplayerP2pLockStepState & {
    roomMode: RoomMode | undefined;
};

const DemoModeRoomLobby = defineElement<{
    p2pLockStepMultiplayer: AnthaMultiplayerP2pLockStepState['multiplayerP2pLockStep'];
}>()({
    tagName: 'demo-mode-room-lobby',
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
            connectedClientCount: 0,
        };
    },
    init({inputs, updateState, state}) {
        function updateConnectedClientCount() {
            updateState({
                connectedClientCount:
                    inputs.p2pLockStepMultiplayer.multiplayerController.getAllClientIds().length,
            });
        }

        const cleanupCallbacks = [
            inputs.p2pLockStepMultiplayer.multiplayerController.listen(
                ControllerClientEvent,
                () => {
                    updateConnectedClientCount();
                },
            ),
            inputs.p2pLockStepMultiplayer.multiplayerController.listen(
                ControllerConnectionEvent,
                (event) => {
                    updateState({
                        connectionState: event.detail,
                    });
                    updateConnectedClientCount();
                },
            ),
            inputs.p2pLockStepMultiplayer.multiplayerController.listen(
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
                await inputs.p2pLockStepMultiplayer.multiplayerController.joinOrCreateRoom(room);
                updateState({
                    joinedRoom: room,
                    connectedClientCount:
                        inputs.p2pLockStepMultiplayer.multiplayerController.getAllClientIds()
                            .length,
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
                `Connected Clients: ${state.connectedClientCount}`,
            ];

            return html`
                <button
                    ${listen('click', () => {
                        inputs.p2pLockStepMultiplayer.multiplayerController.leaveRoom();
                        updateState({
                            joinedRoom: undefined,
                            connectedClientCount: 0,
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
            const roomTemplates = getObjectTypedValues(
                inputs.p2pLockStepMultiplayer.availableRooms,
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

const DemoSingleplayerStatus = defineElement<{
    p2pLockStepMultiplayer: AnthaMultiplayerP2pLockStepState['multiplayerP2pLockStep'];
}>()({
    tagName: 'demo-singleplayer-status',
    styles: css`
        :host {
            display: flex;
            flex-direction: column;
            gap: 4px;
            font-family: monospace;
        }
    `,
    render({inputs}) {
        const statusLines = [
            `Client ID: ${inputs.p2pLockStepMultiplayer.multiplayerController.getClientId() || 'pending...'}`,
        ];

        return html`
            <strong>Singleplayer</strong>
            ${statusLines.map((line) => {
                return html`
                    <span>${line}</span>
                `;
            })}
        `;
    },
});

function createRoomModeSelectionMod(
    mockApiClientRef: Readonly<MultiplayerApiClient>,
): AnthaMod<SelectableRoomState> {
    return defineAnthaMod<SelectableRoomState>({
        modName: 'room-mode-selector',
        initState: {
            roomMode: undefined,
        },
        execute({state}) {
            const p2pLockStep = state.multiplayerP2pLockStep;
            if (!p2pLockStep) {
                return 'Loading...';
            } else if (!state.roomMode) {
                return html`
                    <div class="mode-buttons">
                        <button
                            ${listen('click', () => {
                                state.roomMode = RoomMode.Singleplayer;
                                p2pLockStep.multiplayerController.startSingleplayer();
                            })}
                        >
                            singleplayer
                        </button>
                        <button
                            ${listen('click', async () => {
                                state.roomMode = RoomMode.Multiplayer;

                                await p2pLockStep.multiplayerController.initMultiplayer({
                                    backendOrigin: mockApiClientRef.baseUrl,
                                    multiplayerApiClient: mockApiClientRef,
                                    roomUpdateInterval: {
                                        seconds: 1,
                                    },
                                });
                            })}
                        >
                            multiplayer
                        </button>
                    </div>
                `;
            }

            const backButton = html`
                <button
                    ${listen('click', () => {
                        p2pLockStep.multiplayerController.leaveRoom();
                        state.roomMode = undefined;
                    })}
                >
                    Back
                </button>
            `;

            if (state.roomMode === RoomMode.Multiplayer) {
                return html`
                    ${backButton}
                    <${DemoModeRoomLobby.assign({
                        p2pLockStepMultiplayer: p2pLockStep,
                    })}></${DemoModeRoomLobby}>
                `;
            } else {
                return html`
                    ${backButton}
                    <${DemoSingleplayerStatus.assign({
                        p2pLockStepMultiplayer: p2pLockStep,
                    })}></${DemoSingleplayerStatus}>
                `;
            }
        },
    });
}

function createRoomModeEngine(mockApiClientRef: Readonly<MultiplayerApiClient>) {
    const multiplayerP2pLockStepMod = createAnthaMultiplayerP2pLockStepMod({
        gameId: roomModeSelectionGameId,
    });
    const modeSelectionMod = createRoomModeSelectionMod(mockApiClientRef);

    return new AnthaEngine({
        mods: [
            modeSelectionMod,
            multiplayerP2pLockStepMod,
        ],
    });
}

const DemoRoomModeSelection = defineElement()({
    tagName: 'demo-room-mode-selection',
    state() {
        return {
            engines: undefined as
                | {
                      clientA: AnthaEngine;
                      clientB: AnthaEngine;
                  }
                | undefined,
        };
    },
    styles: css`
        :host {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-evenly;
            align-items: flex-start;
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

        .mode-buttons {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
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
                    clientA: createRoomModeEngine(mockApiClient),
                    clientB: createRoomModeEngine(mockApiClient),
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
        `;
    },
});

export const multiplayerPlayerModeDemo: AnthaDemo = {
    demoName: 'Multiplayer Player Mode',
    demoPathId: 'multiplayer-player-mode',
    demoSortDate: createUtcFullDate('2026-06-05'),
    element: DemoRoomModeSelection,
};
