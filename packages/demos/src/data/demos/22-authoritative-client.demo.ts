import {AnthaEngine, AnthaUi, defineAnthaMod} from '@antha/engine';
import {SnapshotInterpolator} from '@antha/graphics-2d';
import {
    createMockRoomHandlerServerApiClient,
    createNewRoom,
    type ClientId,
    type MultiplayerApiClient,
    type RoomInput,
} from '@antha/multiplayer-core';
import {
    createAnthaMultiplayerP2pAuthoritativeClientMod,
    type AnthaMultiplayerP2pAuthoritativeClientState,
} from '@antha/multiplayer-p2p-authoritative-client';
import {
    combineErrorMessages,
    getObjectTypedEntries,
    getOrSetFromMap,
    log,
} from '@augment-vir/common';
import {createUtcFullDate} from 'date-vir';
import {css, defineElement, html, listen, nothing, unsafeCSS} from 'element-vir';
import {ViraError} from 'vira';
import {type AnthaDemo} from '../demo.js';

type PlayerPosition = {
    x: number;
    y: number;
};

type DemoClientState = AnthaMultiplayerP2pAuthoritativeClientState<PlayerPosition> & {
    localPlayer: PlayerPosition;
    connectionStarted: boolean;
    connectionError: string;
};

const arenaSize = {
    width: 300,
    height: 200,
};
const playerSize = 16;

function renderPlayer(position: Readonly<PlayerPosition>, color: string) {
    return html`
        <div
            style=${css`
                position: absolute;
                left: ${position.x - playerSize / 2}px;
                top: ${position.y - playerSize / 2}px;
                width: ${playerSize}px;
                height: ${playerSize}px;
                border-radius: 50%;
                background: ${unsafeCSS(color)};
                pointer-events: none;
            `}
        ></div>
    `;
}

function createDemoClientMod(
    mockApiClient: Readonly<MultiplayerApiClient>,
    room: Readonly<RoomInput>,
) {
    const remotePlayerInterpolators = new Map<
        ClientId,
        SnapshotInterpolator<keyof PlayerPosition>
    >();

    return defineAnthaMod<DemoClientState>({
        modName: 'authoritative-client-demo',
        async execute({state}) {
            if (!state.multiplayerP2pAuthoritativeClient) {
                return 'Loading...';
            }

            const controller = state.multiplayerP2pAuthoritativeClient.multiplayerController;

            if (!state.connectionStarted) {
                state.connectionStarted = true;
                state.localPlayer = {
                    x: arenaSize.width / 2,
                    y: arenaSize.height / 2,
                };

                await controller.initMultiplayer({
                    backendOrigin: mockApiClient.baseUrl,
                    multiplayerApiClient: mockApiClient,
                    /** Both clients run in this page, so they can connect without a STUN server. */
                    stunServerUrls: [],
                });

                try {
                    await controller.joinOrCreateRoom(room);
                } catch (error) {
                    log.error(error);
                    state.connectionError = combineErrorMessages('Failed to connect', error);
                }
            }

            return html`
                <strong>${controller.isHost() ? 'Host Client' : 'Member Client'}</strong>
                <span>Move the mouse over this box to move the green player.</span>
                <div
                    style=${css`
                        position: relative;
                        width: ${arenaSize.width}px;
                        height: ${arenaSize.height}px;
                        background: #eeeeee;
                        cursor: none;
                    `}
                    ${listen('pointermove', (event) => {
                        state.localPlayer = {
                            x: event.offsetX,
                            y: event.offsetY,
                        };
                    })}
                >
                    ${getObjectTypedEntries(controller.remoteClientStates).map(
                        ([
                            clientId,
                            remote,
                        ]) => {
                            const interpolator = getOrSetFromMap(
                                remotePlayerInterpolators,
                                clientId,
                                () => {
                                    return new SnapshotInterpolator<keyof PlayerPosition>({
                                        delay: {
                                            milliseconds: 50,
                                        },
                                    });
                                },
                            );
                            interpolator.add({
                                time: remote.receivedAt,
                                value: remote.state,
                            });

                            return renderPlayer(
                                interpolator.sample(performance.now()) || remote.state,
                                '#ff4444',
                            );
                        },
                    )}
                    ${state.localPlayer ? renderPlayer(state.localPlayer, '#22aa22') : nothing}
                </div>
                ${state.connectionError
                    ? html`
                          <${ViraError}>${state.connectionError}</${ViraError}>
                      `
                    : nothing}
            `;
        },
    });
}

function createDemoClientEngine(
    mockApiClient: Readonly<MultiplayerApiClient>,
    room: Readonly<RoomInput>,
) {
    return new AnthaEngine({
        mods: [
            createDemoClientMod(mockApiClient, room),
            createAnthaMultiplayerP2pAuthoritativeClientMod<PlayerPosition, DemoClientState>({
                gameId: 'authoritative-client-demo',
                sendInterval: {
                    seconds: 1 / 60,
                },
                createLocalState({state}) {
                    return state.localPlayer;
                },
            }),
        ],
    });
}

const DemoAuthoritativeClient = defineElement()({
    tagName: 'demo-authoritative-client',
    state() {
        return {
            engines: undefined as AnthaEngine[] | undefined,
        };
    },
    styles: css`
        :host {
            display: flex;
            align-items: flex-start;
            gap: 16px;
        }

        antha-ui {
            display: flex;
            flex-direction: column;
            gap: 8px;
            width: unset;
            height: unset;
            border: 2px solid grey;
            border-radius: 4px;
            padding: 16px;
            font-family: monospace;
        }
    `,
    init({state, updateState}) {
        if (!state.engines) {
            const mockApiClient = createMockRoomHandlerServerApiClient();
            const room = createNewRoom({
                roomName: 'Authoritative Client Demo',
            });

            updateState({
                engines: [
                    createDemoClientEngine(mockApiClient, room),
                    createDemoClientEngine(mockApiClient, room),
                ],
            });
        }
    },
    cleanup({state, updateState}) {
        void Promise.all(state.engines?.map((engine) => engine.reset()) || []).then(() => {
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

        return state.engines.map((engine) => {
            return html`
                <${AnthaUi.assign({
                    engine,
                })}></${AnthaUi}>
            `;
        });
    },
});

export const authoritativeClientDemo: AnthaDemo = {
    demoName: 'Authoritative Client Multiplayer',
    demoPathId: 'authoritative-client-multiplayer',
    demoSortDate: createUtcFullDate('2026-11-08'),
    element: DemoAuthoritativeClient,
};
