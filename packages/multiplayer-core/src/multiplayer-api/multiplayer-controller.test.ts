import {assert} from '@augment-vir/assert';
import {type MaybePromise} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {createMultiplayerId} from '../multiplayer-id.js';
import {createMockRoomHandlerServerApiClient} from '../room-handler-server/mock-room-handler-server-api-client.js';
import {
    createNewRoom,
    WebrtcMultiplayerMessageEvent,
    type WebrtcMultiplayerController,
} from '../webrtc/webrtc-multiplayer-controller.js';
import {createMultiplayerApiClient, type MultiplayerApiClient} from './multiplayer-client.js';
import {
    ControllerClientEvent,
    ControllerConnectionEvent,
    ControllerMessageEvent,
    ControllerRoomListEvent,
    MultiplayerConnectionState,
    MultiplayerRoomController,
    type ApiAndRoomConnectionState,
    type MultiplayerRoomConnection,
    type MultiplayerRoomControllerParams,
} from './multiplayer-controller.js';

type TestMessage = {
    value: string;
};

class FakeDataChannel extends EventTarget {
    public isClosed = false;

    public send() {}

    public close() {
        this.isClosed = true;
    }
}

class FakePeerConnection extends EventTarget {
    public static readonly instances: FakePeerConnection[] = [];

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

    public createOffer(): Promise<RTCSessionDescriptionInit> {
        return Promise.resolve({
            type: 'offer',
            sdp: 'mock offer',
        });
    }

    public createAnswer(): Promise<RTCSessionDescriptionInit> {
        return Promise.resolve({
            type: 'answer',
            sdp: 'mock answer',
        });
    }

    public setLocalDescription(description: RTCSessionDescriptionInit) {
        this.localDescription = description;

        return Promise.resolve();
    }

    public setRemoteDescription(description: RTCSessionDescriptionInit) {
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
    FakePeerConnection.instances.length = 0;

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

async function withCapturedInterval(
    callback: (params: Readonly<{runIntervalCallback(): Promise<void>}>) => MaybePromise<void>,
) {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const intervalCallbacks: (() => MaybePromise<void>)[] = [];

    Object.defineProperty(globalThis, 'setInterval', {
        configurable: true,
        value(intervalCallback: () => MaybePromise<void>) {
            intervalCallbacks.push(intervalCallback);

            return intervalCallbacks.length;
        },
        writable: true,
    });
    Object.defineProperty(globalThis, 'clearInterval', {
        configurable: true,
        value() {},
        writable: true,
    });

    try {
        await callback({
            async runIntervalCallback() {
                const intervalCallback = intervalCallbacks[0];
                assert.isDefined(intervalCallback);
                await intervalCallback();
            },
        });
    } finally {
        Object.defineProperty(globalThis, 'setInterval', {
            configurable: true,
            value: originalSetInterval,
            writable: true,
        });
        Object.defineProperty(globalThis, 'clearInterval', {
            configurable: true,
            value: originalClearInterval,
            writable: true,
        });
    }
}

function createFakeConnection({
    connected = true,
    host = true,
}: Readonly<{
    connected?: boolean | undefined;
    host?: boolean | undefined;
}> = {}): MultiplayerRoomConnection<TestMessage> & {
    destroyed: boolean;
    sentMessages: ReadonlyArray<TestMessage>;
} {
    const clientId = createMultiplayerId.client();
    const sentMessages: TestMessage[] = [];

    return {
        clientId,
        destroyed: false,
        sentMessages,
        destroy() {
            this.destroyed = true;
        },
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
            sentMessages.push({
                value: `${clientId}:${message.value}`,
            });
        },
    };
}

describe(MultiplayerRoomController.name, () => {
    it('exposes connection state, room polling, sending, leaving, and destroying', async () => {
        await withCapturedInterval(async ({runIntervalCallback}) => {
            const room = createNewRoom({
                roomName: 'Listed Room',
            });
            const roomLists: unknown[] = [];
            const states: ApiAndRoomConnectionState[] = [];
            const controller = new MultiplayerRoomController<TestMessage>({
                gameId: 'some id',
            });

            controller.listen(ControllerConnectionEvent, ({detail}) => {
                states.push(detail);
            });
            controller.listen(ControllerRoomListEvent, ({detail}) => {
                roomLists.push(detail);
            });

            assert.deepEquals(
                {
                    allClientIds: controller.getAllClientIds(),
                    clientId: controller.getClientId(),
                    connectedClientIds: controller.getConnectedClientIds(),
                    isConnected: controller.isConnected(),
                    isHost: controller.isHost(),
                },
                {
                    allClientIds: [],
                    clientId: undefined,
                    connectedClientIds: [],
                    isConnected: false,
                    isHost: false,
                },
            );
            assert.throws(() =>
                controller.sendMessage({
                    value: 'before connect',
                }),
            );

            await controller.initMultiplayer({
                backendOrigin: 'http://mock.example',
                multiplayerApiClient: createMockRoomHandlerServerApiClient({
                    rooms: {
                        [room.roomId]: {
                            roomId: room.roomId,
                            roomName: room.roomName,
                            clientCount: 1,
                            hasRoomPassword: false,
                        },
                    },
                }),
                roomUpdateInterval: {
                    milliseconds: 1,
                },
            });
            await runIntervalCallback();
            controller.enableRoomUpdates = false;
            await runIntervalCallback();

            const fakeConnection = createFakeConnection();
            controller.currentConnection = fakeConnection;
            controller.sendMessage({
                value: 'sent',
            });

            assert.deepEquals(
                {
                    allClientIds: controller.getAllClientIds(),
                    clientId: controller.getClientId(),
                    connectedClientIds: controller.getConnectedClientIds(),
                    isConnected: controller.isConnected(),
                    isHost: controller.isHost(),
                    roomLists,
                    sentMessages: fakeConnection.sentMessages,
                    states: states.map((state) => {
                        return {
                            api: state.api,
                            room: state.room,
                        };
                    }),
                },
                {
                    allClientIds: [
                        fakeConnection.clientId,
                    ],
                    clientId: fakeConnection.clientId,
                    connectedClientIds: [
                        fakeConnection.clientId,
                    ],
                    isConnected: true,
                    isHost: true,
                    roomLists: [
                        {
                            [room.roomId]: {
                                clientCount: 1,
                                hasRoomPassword: false,
                                roomId: room.roomId,
                                roomName: room.roomName,
                            },
                        },
                    ],
                    sentMessages: [
                        {
                            value: 'sent',
                        },
                    ],
                    states: [
                        {
                            api: MultiplayerConnectionState.Connecting,
                            room: MultiplayerConnectionState.Disconnected,
                        },
                        {
                            api: MultiplayerConnectionState.Connected,
                            room: MultiplayerConnectionState.Disconnected,
                        },
                    ],
                },
            );

            controller.leaveRoom();
            controller.leaveRoom();
            controller.destroy();

            assert.deepEquals(
                {
                    connectionDestroyed: fakeConnection.destroyed,
                    hasCurrentConnection: Boolean(controller.currentConnection),
                    roomId: controller.roomId,
                },
                {
                    connectionDestroyed: true,
                    hasCurrentConnection: false,
                    roomId: undefined,
                },
            );
        });
    });

    it('joins rooms and relays connection events', async () => {
        await withMockPeerConnection(async () => {
            const room = createNewRoom({
                roomName: 'Joined Room',
            });
            const clientEvents: unknown[] = [];
            const messages: unknown[] = [];
            const controller = new MultiplayerRoomController<TestMessage>({
                gameId: 'some id',
            });

            controller.listen(ControllerClientEvent, ({detail}) => {
                clientEvents.push(detail);
            });
            controller.listen(ControllerMessageEvent, ({sourceClientId, detail}) => {
                messages.push({
                    sourceClientId,
                    detail,
                });
            });
            await controller.initMultiplayer({
                backendOrigin: 'http://mock.example',
                multiplayerApiClient: createMockRoomHandlerServerApiClient(),
            });
            await controller.joinOrCreateRoom(room);

            const actualConnection = controller.currentConnection satisfies
                | MultiplayerRoomConnection<TestMessage>
                | undefined;
            assert.isDefined(actualConnection);
            const sourceClientId = createMultiplayerId.client();

            (
                actualConnection satisfies MultiplayerRoomConnection<TestMessage> as WebrtcMultiplayerController<TestMessage>
            ).dispatch(
                new WebrtcMultiplayerMessageEvent(sourceClientId, {
                    value: 'from peer',
                }),
            );

            assert.deepEquals(
                {
                    isConnected: controller.isConnected(),
                    isHost: controller.isHost(),
                    knownErrors: controller.knownErrors,
                    roomId: controller.roomId,
                    staticEvents: Object.keys(MultiplayerRoomController.events).toSorted(),
                    staticKnownErrors: MultiplayerRoomController.knownErrors,
                    clientEvents,
                    messages,
                },
                {
                    isConnected: true,
                    isHost: true,
                    knownErrors: MultiplayerRoomController.knownErrors,
                    roomId: room.roomId,
                    staticEvents: [
                        'ControllerClientEvent',
                        'ControllerConnectionEvent',
                        'ControllerMessageEvent',
                        'ControllerRoomListEvent',
                    ],
                    staticKnownErrors: controller.knownErrors,
                    clientEvents: [
                        {
                            newHost: controller.getClientId(),
                        },
                    ],
                    messages: [
                        {
                            sourceClientId,
                            detail: {
                                value: 'from peer',
                            },
                        },
                    ],
                },
            );

            controller.destroy();
        });
    });

    it('joins an existing room as a member', async () => {
        await withMockPeerConnection(async () => {
            const room = createNewRoom({
                roomName: 'Member Room',
            });
            const apiClient = createMockRoomHandlerServerApiClient();
            const acceptConnection = (() =>
                undefined) satisfies () => undefined as unknown as NonNullable<
                MultiplayerRoomControllerParams<TestMessage>['acceptConnection']
            >;
            const host = new MultiplayerRoomController<TestMessage>({
                gameId: 'some id',
                acceptConnection,
            });
            const member = new MultiplayerRoomController<TestMessage>({
                gameId: 'some id',
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

            const memberClientId = member.getClientId();
            const hostClientId = host.getClientId();
            assert.isDefined(memberClientId);
            assert.isDefined(hostClientId);

            assert.deepEquals(
                {
                    allClientIds: member.getAllClientIds().toSorted(),
                    isConnected: member.isConnected(),
                    isHost: member.isHost(),
                    roomId: member.roomId,
                },
                {
                    allClientIds: [
                        memberClientId,
                        hostClientId,
                    ].toSorted(),
                    isConnected: true,
                    isHost: false,
                    roomId: room.roomId,
                },
            );

            host.destroy();
            member.destroy();
        });
    });

    it('rejects rooms and remembers rejected room ids', async () => {
        await withMockPeerConnection(async () => {
            const room = createNewRoom({
                roomName: 'Rejected Room',
            });
            const apiClient = createMockRoomHandlerServerApiClient();
            const host = new MultiplayerRoomController<TestMessage>({
                gameId: 'some id',
                acceptConnection() {
                    return false;
                },
            });
            const member = new MultiplayerRoomController<TestMessage>({
                gameId: 'some id',
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
            await assert.throws(() => member.joinOrCreateRoom(room), {
                matchMessage: 'Room connection rejected',
            });

            assert.deepEquals(
                {
                    currentConnection: member.currentConnection,
                    roomId: member.roomId,
                    roomError: {
                        name:
                            member.roomConnectionState instanceof Error
                                ? member.roomConnectionState.name
                                : undefined,
                        room:
                            member.roomConnectionState instanceof
                            MultiplayerRoomController.knownErrors.RoomRejectionError
                                ? member.roomConnectionState.room
                                : undefined,
                    },
                },
                {
                    currentConnection: undefined,
                    roomId: undefined,
                    roomError: {
                        name: 'RoomRejectionError',
                        room: {
                            roomId: room.roomId,
                            roomName: room.roomName,
                        },
                    },
                },
            );

            host.destroy();
            member.destroy();
        });
    });

    it('throws for invalid controller lifecycle calls and failed health checks', async () => {
        const controller = new MultiplayerRoomController<TestMessage>({
            gameId: 'some id',
        });
        const fakeConnection = createFakeConnection();

        controller.currentConnection = fakeConnection;

        await assert.throws(() =>
            controller.initMultiplayer({
                backendOrigin: 'http://mock.example',
                multiplayerApiClient: createMockRoomHandlerServerApiClient(),
            }),
        );
        await assert.throws(() => controller.joinOrCreateRoom(createNewRoom()));

        controller.currentConnection = undefined;
        await assert.throws(() => controller.joinOrCreateRoom(createNewRoom()));

        const failingApiClient = {
            baseUrl: 'http://mock.example',
            fetch() {
                return {
                    GET() {
                        return Promise.resolve({});
                    },
                };
            },
        } satisfies Record<string, unknown> as unknown as MultiplayerApiClient;

        await assert.throws(
            () =>
                controller.initMultiplayer({
                    backendOrigin: 'http://mock.example',
                    multiplayerApiClient: failingApiClient,
                }),
            {
                matchMessage: 'Failed to find multiplayer API',
            },
        );
    });

    it('creates API clients with default and scanned origins', async () => {
        const defaultClient = await createMultiplayerApiClient({
            portScanOptions: false,
        });
        const scannedClient = await createMultiplayerApiClient({
            backendOrigin: 'http://localhost:1234',
            portScanOptions: {
                fetchOverride() {
                    return Promise.resolve(
                        new Response(undefined, {
                            headers: {
                                'rest-vir-api': 'multiplayer-api',
                            },
                            status: 200,
                        }),
                    );
                },
            },
        });
        const noPortScannedClient = await createMultiplayerApiClient({
            backendOrigin: 'http://localhost',
            portScanOptions: true,
        });

        assert.deepEquals(
            {
                defaultBaseUrl: defaultClient.baseUrl,
                noPortScannedBaseUrl: noPortScannedClient.baseUrl,
                scannedBaseUrl: scannedClient.baseUrl,
            },
            {
                defaultBaseUrl: 'http://localhost:9348',
                noPortScannedBaseUrl: 'http://localhost',
                scannedBaseUrl: 'http://localhost:1234',
            },
        );
    });

    it('handles failure to connect to a room with port scanning', async () => {
        let externalState: undefined | ApiAndRoomConnectionState;

        const controller = new MultiplayerRoomController({
            gameId: 'some id',
        });

        controller.listen(ControllerConnectionEvent, (event) => {
            externalState = event.detail;
        });
        await assert.throws(
            () =>
                controller.initMultiplayer({
                    backendOrigin: 'http://localhost:0',
                    portScanOptions: {
                        timeout: {
                            seconds: 5,
                        },
                    },
                }),
            {
                matchMessage: 'Cannot find dev origin',
            },
        );

        assert.instanceOf(externalState?.api, Error);
    });
    it('handles failure to connect to a room', async () => {
        let externalState: undefined | ApiAndRoomConnectionState;

        const controller = new MultiplayerRoomController({
            gameId: 'some id',
        });
        controller.listen(ControllerConnectionEvent, (event) => {
            externalState = event.detail;
        });
        await assert.throws(() =>
            controller.initMultiplayer({
                backendOrigin: 'http://localhost:0',
            }),
        );

        assert.instanceOf(externalState?.api, Error);
    });
});
