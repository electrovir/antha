import {
    ControllerClientEvent,
    ControllerConnectionEvent,
    ControllerMessageEvent,
    ControllerRoomListEvent,
    createMockRoomHandlerServerApiClient,
    createMultiplayerId,
    createNewRoom,
    MultiplayerConnectionState,
    type MultiplayerRoomConnection,
} from '@antha/multiplayer-core';
import {assert, assertWrap} from '@augment-vir/assert';
import {type MaybePromise} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {
    ControllerStateEvent,
    type P2pAuthoritativeHostMessage,
    P2pAuthoritativeHostMessageType,
    P2pAuthoritativeHostMultiplayerController,
    type P2pAuthoritativeHostMultiplayerControllerParams,
    type StateEventDetail,
} from './p2p-authoritative-host-multiplayer-controller.js';

type CounterState = {
    count: number;
};

class InspectableP2pAuthoritativeHostMultiplayerController extends P2pAuthoritativeHostMultiplayerController<
    number,
    CounterState
> {
    public setRoomConnectionForTest(
        roomConnection:
            | MultiplayerRoomConnection<P2pAuthoritativeHostMessage<number, CounterState>>
            | undefined,
    ) {
        this.roomConnection = roomConnection;
    }

    public get roomConnectionForTest() {
        return this.roomConnection;
    }
}

class FakeDataChannel extends EventTarget {
    public readonly sentMessages: string[] = [];
    public isClosed = false;

    public send(message: string) {
        this.sentMessages.push(message);
    }

    public close() {
        this.isClosed = true;
    }
}

class FakePeerConnection extends EventTarget {
    // eslint-disable-next-line sonarjs/public-static-readonly
    public static instances: FakePeerConnection[] = [];

    public readonly createdDataChannels: FakeDataChannel[] = [];
    public localDescription: RTCSessionDescriptionInit | undefined;
    public remoteDescription: RTCSessionDescriptionInit | undefined;

    constructor() {
        super();
        FakePeerConnection.instances.push(this);
    }

    public override addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: AddEventListenerOptions | boolean | undefined,
    ) {
        super.addEventListener(type, listener, options);

        if (type === 'icecandidate' && listener) {
            queueMicrotask(() => {
                this.dispatchEvent(
                    Object.assign(new Event('icecandidate'), {
                        candidate: undefined,
                    }),
                );
            });
        }
    }

    public createDataChannel() {
        const dataChannel = new FakeDataChannel();
        this.createdDataChannels.push(dataChannel);

        return dataChannel;
    }

    public async createOffer(): Promise<RTCSessionDescriptionInit> {
        return Promise.resolve({
            type: 'offer',
            sdp: 'mock offer',
        });
    }

    public async createAnswer(): Promise<RTCSessionDescriptionInit> {
        return Promise.resolve({
            type: 'answer',
            sdp: 'mock answer',
        });
    }

    public async setLocalDescription(description: RTCSessionDescriptionInit) {
        this.localDescription = description;
        return Promise.resolve();
    }

    public async setRemoteDescription(description: RTCSessionDescriptionInit) {
        this.remoteDescription = description;

        if (description.type === 'offer') {
            const dataChannel = new FakeDataChannel();
            this.createdDataChannels.push(dataChannel);
            this.dispatchEvent(
                Object.assign(new Event('datachannel'), {
                    channel: dataChannel,
                }),
            );
            setTimeout(() => dataChannel.dispatchEvent(new Event('open')), 50);
        } else if (description.type === 'answer') {
            const dataChannel = this.createdDataChannels[0];
            assert.isDefined(dataChannel);
            setTimeout(() => dataChannel.dispatchEvent(new Event('open')), 1000);
        }

        return Promise.resolve();
    }

    public close() {}
}

async function withMockPeerConnection(callback: () => MaybePromise<void>) {
    const originalPeerConnection = globalThis.RTCPeerConnection;
    FakePeerConnection.instances = [];

    Object.defineProperty(globalThis, 'RTCPeerConnection', {
        configurable: true,
        value: FakePeerConnection,
        writable: true,
    });

    try {
        await callback();
    } finally {
        Object.defineProperty(globalThis, 'RTCPeerConnection', {
            configurable: true,
            value: originalPeerConnection,
            writable: true,
        });
    }
}

function createController(
    params: Readonly<
        Partial<P2pAuthoritativeHostMultiplayerControllerParams<number, CounterState>>
    > = {},
) {
    return new InspectableP2pAuthoritativeHostMultiplayerController({
        gameId: params.gameId || 'authoritative-host-test',
        createInitialState:
            params.createInitialState ||
            (() => {
                return {
                    count: 0,
                };
            }),
        applyInput:
            params.applyInput ||
            (({state, input}) => {
                return {
                    count: state.count + input,
                };
            }),
        ...(params.acceptConnection && {
            acceptConnection: params.acceptConnection,
        }),
        ...(params.shouldAcceptInput && {
            shouldAcceptInput: params.shouldAcceptInput,
        }),
        ...(params.tick && {
            tick: params.tick,
        }),
    });
}

function createFakeConnection({
    connected = true,
    host = true,
}: Readonly<{
    connected?: boolean | undefined;
    host?: boolean | undefined;
}> = {}): MultiplayerRoomConnection<P2pAuthoritativeHostMessage<number, CounterState>> & {
    sentMessages: ReadonlyArray<P2pAuthoritativeHostMessage<number, CounterState>>;
    onlyOneClientMessages: ReadonlyArray<{
        clientId: string;
        message: P2pAuthoritativeHostMessage<number, CounterState>;
    }>;
} {
    const clientId = createMultiplayerId.client();
    const sentMessages: P2pAuthoritativeHostMessage<number, CounterState>[] = [];
    const onlyOneClientMessages: {
        clientId: string;
        message: P2pAuthoritativeHostMessage<number, CounterState>;
    }[] = [];

    return {
        clientId,
        sentMessages,
        onlyOneClientMessages,
        destroy() {},
        getAllClientIds() {
            return [
                this.clientId,
            ];
        },
        getConnectedClientIds() {
            return connected
                ? [
                      this.clientId,
                  ]
                : [];
        },
        isConnected() {
            return connected;
        },
        isHost() {
            return host;
        },
        sendMessage(message) {
            sentMessages.push(message);
        },
        sendToOnlyOneClient(clientId, message) {
            onlyOneClientMessages.push({
                clientId,
                message,
            });
        },
    };
}

function createInputMessage(input: number): P2pAuthoritativeHostMessage<number, CounterState> {
    return {
        type: P2pAuthoritativeHostMessageType.Input,
        input,
    };
}

function createSnapshotMessage({
    count,
    sequence,
}: Readonly<{
    count: number;
    sequence: number;
}>): P2pAuthoritativeHostMessage<number, CounterState> {
    return {
        sequence,
        state: {
            count,
        },
        type: P2pAuthoritativeHostMessageType.StateSnapshot,
    };
}

describe(P2pAuthoritativeHostMultiplayerController.name, () => {
    it('applies singleplayer authoritative inputs and ticks', () => {
        const state: {
            updates: ReadonlyArray<StateEventDetail<number, CounterState>>;
        } = {
            updates: [],
        };
        const controller = createController({
            tick({state, elapsedMs}) {
                return {
                    count: state.count + elapsedMs,
                };
            },
        });

        controller.listen(ControllerStateEvent<CounterState, number>, ({detail}) => {
            state.updates = [
                ...state.updates,
                detail,
            ];
        });

        assert.deepEquals(controller.getState(), {
            count: 0,
        });
        controller.startSingleplayer();
        const clientId = assertWrap.isDefined(controller.getClientId());
        assert.isLengthExactly(controller.getAllClientIds(), 1);
        controller.act(2);
        controller.tick(3);

        assert.deepEquals(controller.getState(), {
            count: 5,
        });
        assert.deepEquals(state.updates, [
            {
                sequence: 0,
                state: {
                    count: 0,
                },
            },
            {
                clientId,
                input: 2,
                sequence: 1,
                state: {
                    count: 2,
                },
            },
            {
                sequence: 2,
                state: {
                    count: 5,
                },
            },
        ]);
    });

    it('exposes connection state and guards invalid singleplayer calls', async () => {
        const controller = createController();

        assert.deepEquals(
            {
                allClientIds: controller.getAllClientIds(),
                apiConnectionState: controller.apiConnectionState,
                clientId: controller.getClientId(),
                connectedClientIds: controller.getConnectedClientIds(),
                currentConnection: controller.currentConnection,
                enableRoomUpdates: controller.enableRoomUpdates,
                isConnected: controller.isConnected(),
                isHost: controller.isHost(),
                knownErrors: controller.knownErrors,
                multiplayerApiClient: controller.multiplayerApiClient,
                roomConnectionState: controller.roomConnectionState,
                roomId: controller.roomId,
                staticEvents: Object.keys(
                    P2pAuthoritativeHostMultiplayerController.events,
                ).toSorted(),
                staticKnownErrors: P2pAuthoritativeHostMultiplayerController.knownErrors,
            },
            {
                allClientIds: [],
                apiConnectionState: MultiplayerConnectionState.Disconnected,
                clientId: undefined,
                connectedClientIds: [],
                currentConnection: undefined,
                enableRoomUpdates: true,
                isConnected: false,
                isHost: false,
                knownErrors: P2pAuthoritativeHostMultiplayerController.knownErrors,
                multiplayerApiClient: undefined,
                roomConnectionState: MultiplayerConnectionState.Disconnected,
                roomId: undefined,
                staticEvents: [
                    'ControllerStateEvent',
                ],
                staticKnownErrors: controller.knownErrors,
            },
        );

        controller.enableRoomUpdates = false;

        assert.isFalse(controller.enableRoomUpdates);
        assert.throws(() => controller.act(1));

        controller.startSingleplayer();

        assert.throws(() => controller.startSingleplayer(), {
            matchMessage: 'Cannot start singleplayer with a connection already present.',
        });
        await assert.throws(() => controller.joinOrCreateRoom(createNewRoom()), {
            matchMessage: 'Cannot join room: connection already established.',
        });

        controller.leaveRoom();
        controller.leaveRoom();
        controller.tick();
        controller.destroy();

        assert.isFalse(controller.isConnected());
    });

    it('rejects inputs when the game definition does not accept them', () => {
        const state: {
            updates: ReadonlyArray<StateEventDetail<number, CounterState>>;
        } = {
            updates: [],
        };
        const controller = createController({
            shouldAcceptInput({input}) {
                return input > 0;
            },
        });

        controller.listen(ControllerStateEvent<CounterState, number>, ({detail}) => {
            state.updates = [
                ...state.updates,
                detail,
            ];
        });
        controller.startSingleplayer();
        controller.act(-1);
        controller.act(3);

        assert.deepEquals(
            {
                state: controller.getState(),
                updates: state.updates.map((update) => update.state),
            },
            {
                state: {
                    count: 3,
                },
                updates: [
                    {
                        count: 0,
                    },
                    {
                        count: 3,
                    },
                ],
            },
        );
    });

    it('forwards room controller events and messages', () => {
        const controller = createController();
        const fakeConnection = createFakeConnection();
        const clientId = createMultiplayerId.client();
        const state: {
            clientEvents: unknown[];
            connectionEvents: unknown[];
            roomListEvents: unknown[];
        } = {
            clientEvents: [],
            connectionEvents: [],
            roomListEvents: [],
        };

        controller.listen(ControllerClientEvent, ({detail}) => {
            state.clientEvents.push(detail);
        });
        controller.listen(ControllerConnectionEvent, ({detail}) => {
            state.connectionEvents.push(detail);
        });
        controller.listen(ControllerRoomListEvent, ({detail}) => {
            state.roomListEvents.push(detail);
        });

        controller.setRoomConnectionForTest(fakeConnection);
        assert.strictEquals(controller.clientId, fakeConnection.clientId);
        const room = createNewRoom({
            roomName: 'Room Name',
        });
        controller.roomController.dispatch(
            new ControllerRoomListEvent({
                detail: {
                    [room.roomId]: {
                        clientCount: 1,
                        hasRoomPassword: false,
                        roomId: room.roomId,
                        roomName: 'Room Name',
                    },
                },
            }),
        );
        controller.roomController.dispatch(
            new ControllerConnectionEvent({
                detail: {
                    api: MultiplayerConnectionState.Connected,
                    room: MultiplayerConnectionState.Connected,
                },
            }),
        );
        controller.roomController.dispatch(
            new ControllerClientEvent({
                detail: {
                    newMember: clientId,
                },
            }),
        );
        controller.roomController.dispatch(
            new ControllerMessageEvent(clientId, createInputMessage(4)),
        );

        controller.setRoomConnectionForTest(undefined);
        controller.roomController.dispatch(
            new ControllerMessageEvent(clientId, createInputMessage(4)),
        );

        assert.deepEquals(
            {
                clientEvents: state.clientEvents,
                connectionEvents: state.connectionEvents,
                roomListEvents: state.roomListEvents,
                sentMessages: fakeConnection.sentMessages,
                onlyOneClientMessages: fakeConnection.onlyOneClientMessages,
                state: controller.getState(),
            },
            {
                clientEvents: [
                    {
                        newMember: clientId,
                    },
                ],
                connectionEvents: [
                    {
                        api: MultiplayerConnectionState.Connected,
                        room: MultiplayerConnectionState.Connected,
                    },
                ],
                roomListEvents: [
                    {
                        [room.roomId]: {
                            clientCount: 1,
                            hasRoomPassword: false,
                            roomId: room.roomId,
                            roomName: 'Room Name',
                        },
                    },
                ],
                sentMessages: [
                    {
                        clientId,
                        input: 4,
                        sequence: 1,
                        state: {
                            count: 4,
                        },
                        type: P2pAuthoritativeHostMessageType.StateSnapshot,
                    },
                ],
                onlyOneClientMessages: [
                    {
                        clientId,
                        message: {
                            sequence: 0,
                            state: {
                                count: 0,
                            },
                            type: P2pAuthoritativeHostMessageType.StateSnapshot,
                        },
                    },
                ],
                state: {
                    count: 4,
                },
            },
        );
    });

    it('sends member inputs and applies host snapshots', () => {
        const controller = createController();
        const fakeConnection = createFakeConnection({
            host: false,
        });
        const sourceClientId = createMultiplayerId.client();
        const state: {
            updates: ReadonlyArray<StateEventDetail<number, CounterState>>;
        } = {
            updates: [],
        };

        controller.listen(ControllerStateEvent<CounterState, number>, ({detail}) => {
            state.updates = [
                ...state.updates,
                detail,
            ];
        });

        controller.setRoomConnectionForTest(fakeConnection);
        controller.act(5);
        controller.roomController.dispatch(
            new ControllerMessageEvent(
                sourceClientId,
                createSnapshotMessage({
                    count: 9,
                    sequence: 2,
                }),
            ),
        );
        controller.roomController.dispatch(
            new ControllerMessageEvent(
                sourceClientId,
                createSnapshotMessage({
                    count: 3,
                    sequence: 1,
                }),
            ),
        );
        controller.roomController.dispatch(
            new ControllerMessageEvent(sourceClientId, createInputMessage(100)),
        );

        assert.deepEquals(
            {
                sentMessages: fakeConnection.sentMessages,
                state: controller.getState(),
                updates: state.updates,
            },
            {
                sentMessages: [
                    {
                        input: 5,
                        type: P2pAuthoritativeHostMessageType.Input,
                    },
                ],
                state: {
                    count: 9,
                },
                updates: [
                    {
                        sequence: 2,
                        state: {
                            count: 9,
                        },
                        type: P2pAuthoritativeHostMessageType.StateSnapshot,
                    },
                ],
            },
        );
    });

    it('joins rooms as host and member', async () => {
        await withMockPeerConnection(async () => {
            const room = createNewRoom({
                roomName: 'Authoritative Room',
            });
            const apiClient = createMockRoomHandlerServerApiClient();
            const host = createController({
                gameId: 'joined-authoritative-host-test',
                acceptConnection() {
                    return true;
                },
            });
            const member = createController({
                gameId: 'joined-authoritative-host-test',
            });
            const state: {
                hostUpdates: ReadonlyArray<StateEventDetail<number, CounterState>>;
                memberUpdates: ReadonlyArray<StateEventDetail<number, CounterState>>;
            } = {
                hostUpdates: [],
                memberUpdates: [],
            };

            host.listen(ControllerStateEvent<CounterState, number>, ({detail}) => {
                state.hostUpdates = [
                    ...state.hostUpdates,
                    detail,
                ];
            });
            member.listen(ControllerStateEvent<CounterState, number>, ({detail}) => {
                state.memberUpdates = [
                    ...state.memberUpdates,
                    detail,
                ];
            });

            await host.initMultiplayer({
                backendOrigin: 'http://mock.example',
                multiplayerApiClient: apiClient,
            });
            await member.initMultiplayer({
                backendOrigin: 'http://mock.example',
                multiplayerApiClient: apiClient,
            });
            await host.joinOrCreateRoom(room);
            await member.joinOrCreateRoom(room);
            const hostClientId = assertWrap.isDefined(host.getClientId());
            const memberClientId = assertWrap.isDefined(member.getClientId());

            host.roomController.dispatch(
                new ControllerMessageEvent(memberClientId, createInputMessage(7)),
            );
            member.roomController.dispatch(
                new ControllerMessageEvent(
                    hostClientId,
                    createSnapshotMessage({
                        count: 7,
                        sequence: 1,
                    }),
                ),
            );

            assert.deepEquals(
                {
                    hostAllClientIds: host.getAllClientIds().toSorted(),
                    hostConnectedClientIds: host.getConnectedClientIds(),
                    hostIsHost: host.isHost(),
                    memberAllClientIds: member.getAllClientIds().toSorted(),
                    memberIsHost: member.isHost(),
                    memberRoomId: member.roomId,
                    memberState: member.getState(),
                },
                {
                    hostAllClientIds: [
                        hostClientId,
                        memberClientId,
                    ].toSorted(),
                    hostConnectedClientIds: [
                        memberClientId,
                    ],
                    hostIsHost: true,
                    memberAllClientIds: [
                        hostClientId,
                        memberClientId,
                    ].toSorted(),
                    memberIsHost: false,
                    memberRoomId: room.roomId,
                    memberState: {
                        count: 7,
                    },
                },
            );

            assert.isLengthAtLeast(state.hostUpdates, 2);
            assert.isLengthAtLeast(state.memberUpdates, 2);

            host.destroy();
            member.destroy();
        });
    });

    it('clears room connection on join failures', async () => {
        const controller = createController();

        controller.roomController.joinOrCreateRoom = () => Promise.resolve();

        await assert.throws(() => controller.joinOrCreateRoom(createNewRoom()), {
            matchMessage: 'room connection is missing',
        });

        assert.isUndefined(controller.roomConnectionForTest);
    });

    it('passes through room rejection errors', async () => {
        await withMockPeerConnection(async () => {
            const room = createNewRoom({
                roomName: 'Rejected Authoritative Room',
            });
            const apiClient = createMockRoomHandlerServerApiClient();
            const host = createController({
                gameId: 'rejected-authoritative-host-test',
                acceptConnection() {
                    return false;
                },
            });
            const member = createController({
                gameId: 'rejected-authoritative-host-test',
            });

            await host.initMultiplayer({
                backendOrigin: 'http://mock.example',
                multiplayerApiClient: apiClient,
            });
            await member.initMultiplayer({
                backendOrigin: 'http://mock.example',
                multiplayerApiClient: apiClient,
            });
            await host.joinOrCreateRoom(room);

            await assert.throws(() => member.joinOrCreateRoom(room), {
                matchMessage: 'Room connection rejected',
            });

            assert.instanceOf(
                member.roomConnectionState,
                P2pAuthoritativeHostMultiplayerController.knownErrors.RoomRejectionError,
            );

            host.destroy();
            member.destroy();
        });
    });
});
