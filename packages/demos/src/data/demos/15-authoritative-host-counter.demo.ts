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
    type ClientId,
    type MultiplayerApiClient,
    type MultiplayerClientRooms,
    type RoomInput,
} from '@antha/multiplayer-core';
import {
    ControllerStateEvent,
    createAnthaMultiplayerP2pAuthoritativeHostMod,
    type AnthaMultiplayerP2pAuthoritativeHostState,
} from '@antha/multiplayer-p2p-authoritative-host';
import {check} from '@augment-vir/assert';
import {combineErrorMessages, getObjectTypedValues, log, randomString} from '@augment-vir/common';
import {createUtcFullDate} from 'date-vir';
import {ViraError} from 'vira';
import {type AnthaDemo} from '../demo.js';

const authoritativeHostCounterGameId = 'authoritative-host-counter-demo';

enum AuthoritativeHostCounterMode {
    Multiplayer = 'multiplayer',
    Singleplayer = 'singleplayer',
}

type CounterInput = {
    increment: number;
};

type CounterState = {
    count: number;
    lastClientId: ClientId | '';
};

type AuthoritativeHostCounterState = AnthaMultiplayerP2pAuthoritativeHostState<
    CounterInput,
    CounterState
> & {
    counterMode: AuthoritativeHostCounterMode | undefined;
};

type AuthoritativeHostMultiplayerState = AnthaMultiplayerP2pAuthoritativeHostState<
    CounterInput,
    CounterState
>['multiplayerP2pAuthoritativeHost'];

const DemoAuthoritativeCounter = defineElement<{
    authoritativeHostMultiplayer: AuthoritativeHostMultiplayerState;
}>()({
    tagName: 'demo-authoritative-counter',
    styles: css`
        :host {
            display: flex;
        }

        .counter {
            display: flex;
            flex-direction: column;
            align-items: stretch;
            gap: 12px;
            width: 100%;
        }

        button {
            min-height: 120px;
            font-size: 32px;
            font-weight: bold;
        }

        .count {
            font-size: 28px;
            font-weight: bold;
        }

        .status {
            display: flex;
            flex-direction: column;
            gap: 4px;
            font-family: monospace;
        }

        p {
            margin: 0;
        }
    `,
    state({inputs}) {
        return {
            count: inputs.authoritativeHostMultiplayer.currentState.count,
            lastClientId: inputs.authoritativeHostMultiplayer.currentState.lastClientId,
            cleanup: undefined as (() => void) | undefined,
        };
    },
    init({inputs, updateState}) {
        const cleanup = inputs.authoritativeHostMultiplayer.multiplayerController.listen(
            ControllerStateEvent<CounterState>,
            ({detail}) => {
                updateState({
                    count: detail.state.count,
                    lastClientId: detail.state.lastClientId,
                });
            },
        );

        updateState({
            cleanup,
        });
    },
    cleanup({state, updateState}) {
        state.cleanup?.();
        updateState({
            cleanup: undefined,
        });
    },
    render({inputs, state}) {
        function incrementCounter() {
            inputs.authoritativeHostMultiplayer.multiplayerController.act({
                increment: 1,
            });
        }

        const statusLines = [
            `Authority: ${inputs.authoritativeHostMultiplayer.multiplayerController.isHost() ? 'this client' : 'room host'}`,
            `Last Input: ${state.lastClientId || 'none'}`,
        ];

        return html`
            <div
                class="counter"
                tabindex="0"
                ${listen('keydown', (event: KeyboardEvent) => {
                    if (event.code === 'Space') {
                        event.preventDefault();
                        incrementCounter();
                    }
                })}
            >
                <span class="count">${state.count}</span>
                <button
                    ${listen('click', () => {
                        incrementCounter();
                    })}
                >
                    Click
                </button>
                <div class="status">
                    ${statusLines.map((line) => {
                        return html`
                            <span>${line}</span>
                        `;
                    })}
                </div>
            </div>
        `;
    },
});

const DemoAuthoritativeHostRoomLobby = defineElement<{
    authoritativeHostMultiplayer: AuthoritativeHostMultiplayerState;
}>()({
    tagName: 'demo-authoritative-host-room-lobby',
    styles: css`
        :host {
            display: flex;
            flex-direction: column;
            gap: 12px;
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
                    inputs.authoritativeHostMultiplayer.multiplayerController.getAllClientIds()
                        .length,
            });
        }

        const cleanupCallbacks = [
            inputs.authoritativeHostMultiplayer.multiplayerController.listen(
                ControllerClientEvent,
                () => {
                    updateConnectedClientCount();
                },
            ),
            inputs.authoritativeHostMultiplayer.multiplayerController.listen(
                ControllerConnectionEvent,
                (event) => {
                    updateState({
                        connectionState: event.detail,
                    });
                    updateConnectedClientCount();
                },
            ),
            inputs.authoritativeHostMultiplayer.multiplayerController.listen(
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
                await inputs.authoritativeHostMultiplayer.multiplayerController.joinOrCreateRoom(
                    room,
                );
                updateState({
                    joinedRoom: room,
                    connectedClientCount:
                        inputs.authoritativeHostMultiplayer.multiplayerController.getAllClientIds()
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
                `Client ID: ${inputs.authoritativeHostMultiplayer.multiplayerController.getClientId() || 'pending...'}`,
                `Api: ${apiLabel}`,
                `Room: ${roomLabel}`,
                `Room Name: ${state.joinedRoom.roomName}`,
                `Connected Clients: ${state.connectedClientCount}`,
            ];

            return html`
                <button
                    ${listen('click', () => {
                        inputs.authoritativeHostMultiplayer.multiplayerController.leaveRoom();
                        updateState({
                            joinedRoom: undefined,
                            connectedClientCount: 0,
                        });
                    })}
                >
                    Leave
                </button>
                <strong>
                    ${inputs.authoritativeHostMultiplayer.multiplayerController.isHost()
                        ? 'Host Client'
                        : 'Member Client'}
                </strong>
                ${statusLines.map((line) => {
                    return html`
                        <span>${line}</span>
                    `;
                })}
                <${DemoAuthoritativeCounter.assign({
                    authoritativeHostMultiplayer: inputs.authoritativeHostMultiplayer,
                })}></${DemoAuthoritativeCounter}>
                ${state.connectionError
                    ? html`
                          <${ViraError}>${state.connectionError}</${ViraError}>
                      `
                    : nothing}
            `;
        } else {
            const roomTemplates = getObjectTypedValues(
                inputs.authoritativeHostMultiplayer.availableRooms,
            ).map((room) => {
                return html`
                    <tr>
                        <th>${room.roomName}</th>
                        <td>${room.clientCount}</td>
                        <td>
                            <button
                                ${listen('click', async () => {
                                    await joinRoom({
                                        ...room,
                                        roomPassword: '',
                                    });
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

function createAuthoritativeHostModeSelectionMod(
    mockApiClientRef: Readonly<MultiplayerApiClient>,
): AnthaMod<AuthoritativeHostCounterState> {
    return defineAnthaMod<AuthoritativeHostCounterState>({
        modName: 'authoritative-host-mode-selector',
        initState: {
            counterMode: undefined,
        },
        execute({state}) {
            const authoritativeHost = state.multiplayerP2pAuthoritativeHost;
            if (!authoritativeHost) {
                return 'Loading...';
            } else if (!state.counterMode) {
                return html`
                    <div class="mode-buttons">
                        <button
                            ${listen('click', () => {
                                state.counterMode = AuthoritativeHostCounterMode.Singleplayer;
                                authoritativeHost.multiplayerController.startSingleplayer();
                            })}
                        >
                            singleplayer
                        </button>
                        <button
                            ${listen('click', async () => {
                                state.counterMode = AuthoritativeHostCounterMode.Multiplayer;

                                await authoritativeHost.multiplayerController.initMultiplayer({
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
                        authoritativeHost.multiplayerController.leaveRoom();
                        state.counterMode = undefined;
                    })}
                >
                    Back
                </button>
            `;

            if (state.counterMode === AuthoritativeHostCounterMode.Multiplayer) {
                return html`
                    ${backButton}
                    <${DemoAuthoritativeHostRoomLobby.assign({
                        authoritativeHostMultiplayer: authoritativeHost,
                    })}></${DemoAuthoritativeHostRoomLobby}>
                `;
            } else {
                return html`
                    ${backButton}
                    <${DemoAuthoritativeCounter.assign({
                        authoritativeHostMultiplayer: authoritativeHost,
                    })}></${DemoAuthoritativeCounter}>
                `;
            }
        },
    });
}

function createAuthoritativeHostCounterEngine(mockApiClientRef: Readonly<MultiplayerApiClient>) {
    const multiplayerP2pAuthoritativeHostMod = createAnthaMultiplayerP2pAuthoritativeHostMod<
        CounterInput,
        CounterState
    >({
        gameId: authoritativeHostCounterGameId,
        createInitialState() {
            return {
                count: 0,
                lastClientId: '',
            };
        },
        applyInput({clientId, input, state}) {
            return {
                count: state.count + input.increment,
                lastClientId: clientId,
            };
        },
        shouldAcceptInput({input}) {
            return input.increment === 1;
        },
    });
    const modeSelectionMod = createAuthoritativeHostModeSelectionMod(mockApiClientRef);

    return new AnthaEngine({
        mods: [
            modeSelectionMod,
            multiplayerP2pAuthoritativeHostMod,
        ],
    });
}

const DemoAuthoritativeHostCounter = defineElement()({
    tagName: 'demo-authoritative-host-counter',
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
                    clientA: createAuthoritativeHostCounterEngine(mockApiClient),
                    clientB: createAuthoritativeHostCounterEngine(mockApiClient),
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

export const multiplayerAuthoritativeHostCounterDemo: AnthaDemo = {
    demoName: 'Multiplayer Authoritative Host Counter',
    demoPathId: 'multiplayer-authoritative-host-counter',
    demoSortDate: createUtcFullDate('2026-06-06'),
    element: DemoAuthoritativeHostCounter,
};
