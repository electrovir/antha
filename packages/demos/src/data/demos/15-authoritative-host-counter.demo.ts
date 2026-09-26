import {AnthaEngine, AnthaUi, defineAnthaMod, type AnthaMod} from '@antha/engine';
import {
    createMockRoomHandlerServerApiClient,
    createNewRoom,
    type ApiAndRoomConnectionState,
    type ClientId,
    type MultiplayerApiClient,
    type MultiplayerClientRooms,
    type RoomInput,
} from '@antha/multiplayer-core';
import {
    createAnthaMultiplayerP2pAuthoritativeHostMod,
    type AnthaMultiplayerP2pAuthoritativeHostState,
} from '@antha/multiplayer-p2p-authoritative-host';
import {check} from '@augment-vir/assert';
import {combineErrorMessages, getObjectTypedValues, log, randomString} from '@augment-vir/common';
import {createUtcFullDate} from 'date-vir';
import {css, defineElement, html, listen, nothing} from 'element-vir';
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
    /** Separate from `authoritativeHostMultiplayer` so that this element re-renders when it changes. */
    currentState: Readonly<CounterState>;
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
    render({inputs}) {
        function incrementCounter() {
            inputs.authoritativeHostMultiplayer.multiplayerController.act({
                increment: 1,
            });
        }

        const statusLines = [
            `Authority: ${inputs.authoritativeHostMultiplayer.multiplayerController.isHost() ? 'this client' : 'room host'}`,
            `Last Input: ${inputs.currentState.lastClientId || 'none'}`,
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
                <span class="count">${inputs.currentState.count}</span>
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
    connectionState: Readonly<ApiAndRoomConnectionState>;
    currentState: Readonly<CounterState>;
    connectedClientCount: number;
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
            joinedRoom: undefined as Readonly<RoomInput> | undefined,
            cleanup: undefined as (() => void) | undefined,
            availableRooms: {} as Readonly<MultiplayerClientRooms>,
        };
    },
    init({inputs, updateState, state}) {
        const cleanupCallbacks = [
            () => {
                inputs.authoritativeHostMultiplayer.multiplayerController.stopRoomUpdates();
            },
            inputs.authoritativeHostMultiplayer.multiplayerController.startRoomUpdates((rooms) => {
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
                await inputs.authoritativeHostMultiplayer.multiplayerController.joinOrCreateRoom(
                    room,
                );
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
                inputs.connectionState.api instanceof Error
                    ? `Error: ${inputs.connectionState.api.message}`
                    : inputs.connectionState.api;

            const roomLabel =
                inputs.connectionState.room instanceof Error
                    ? `Error: ${inputs.connectionState.room.message}`
                    : inputs.connectionState.room;

            const statusLines = [
                `Client ID: ${inputs.authoritativeHostMultiplayer.multiplayerController.getClientId() || 'pending...'}`,
                `Api: ${apiLabel}`,
                `Room: ${roomLabel}`,
                `Room Name: ${state.joinedRoom.roomName}`,
                `Connected Clients: ${inputs.connectedClientCount}`,
            ];

            return html`
                <button
                    ${listen('click', () => {
                        inputs.authoritativeHostMultiplayer.multiplayerController.leaveRoom();
                        updateState({
                            joinedRoom: undefined,
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
                    currentState: inputs.currentState,
                })}></${DemoAuthoritativeCounter}>
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
                        connectionState: authoritativeHost.connectionState,
                        currentState: authoritativeHost.currentState,
                        connectedClientCount:
                            authoritativeHost.multiplayerController.getAllClientIds().length,
                    })}></${DemoAuthoritativeHostRoomLobby}>
                `;
            } else {
                return html`
                    ${backButton}
                    <${DemoAuthoritativeCounter.assign({
                        authoritativeHostMultiplayer: authoritativeHost,
                        currentState: authoritativeHost.currentState,
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
