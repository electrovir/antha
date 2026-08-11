import {assert} from '@augment-vir/assert';
import {makeWritable, type JsonCompatibleValue, type MaybePromise} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {type MultiplayerApiClient} from '../multiplayer-api/multiplayer-client.js';
import {createMultiplayerId, type ClientId} from '../multiplayer-id.js';
import {MultiplayerWebSocketMessageType} from './web-rtc-communication.js';
import {
    createNewRoom,
    WebrtcMultiplayerConnectionUpdateEvent,
    WebrtcMultiplayerController,
    WebrtcMultiplayerMessageEvent,
} from './webrtc-multiplayer-controller.js';

type TestMessage = {
    value: string;
};

type CapturedWebSocketListeners = {
    message: (params: {message: unknown; webSocket: FakeClientWebSocket}) => MaybePromise<void>;
    error: (error: Error) => void;
    close: () => void;
};

type WebrtcMultiplayerControllerInternals<MessageData extends JsonCompatibleValue> = Readonly<{
    connections: Record<
        ClientId,
        Readonly<{
            clientId: ClientId;
            destroy(): void;
            isConnected: boolean;
            sendMessage(data: Readonly<MessageData>): void;
        }>
    >;
    createNewConnection(clientId: ClientId): Readonly<{
        createAnswer(
            rawOffer: string | Readonly<RTCSessionDescriptionInit>,
            stunServerUrls: ReadonlyArray<string>,
        ): Promise<unknown>;
        createOffer(stunServerUrls: ReadonlyArray<string>): Promise<unknown>;
        destroy(): void;
    }>;
    setupWebSocket(): Promise<FakeClientWebSocket>;
    webSocket: FakeClientWebSocket | undefined;
}>;

class FakeDataChannel extends EventTarget {
    public readonly sentMessages: string[] = [];
    public isClosed = false;

    public send(message: string) {
        this.sentMessages.push(message);
    }

    public close() {
        if (this.isClosed) {
            return;
        }

        this.isClosed = true;
        this.dispatchEvent(new Event('closing'));
    }

    public open() {
        this.dispatchEvent(new Event('open'));
    }

    public receive(data: unknown) {
        this.dispatchEvent(
            Object.assign(new Event('message'), {
                data,
            }),
        );
    }
}

class FakePeerConnection extends EventTarget {
    public static readonly instances: FakePeerConnection[] = [];

    public readonly createdDataChannels: FakeDataChannel[] = [];
    public isClosed = false;
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
            queueMicrotask(() => dataChannel.open());
        }

        return Promise.resolve();
    }

    public close() {
        this.isClosed = true;
    }
}

class FakeClientWebSocket {
    public readonly sentMessages: unknown[] = [];
    public closeCallCount = 0;
    public listeners: CapturedWebSocketListeners | undefined;
    public readyState: number = WebSocket.OPEN;

    constructor(private readonly replyHostClientId: ClientId) {}

    public send(message: unknown) {
        this.sentMessages.push(message);
    }

    public async sendAndWaitForReply({
        message,
        replyCheck,
    }: Readonly<{
        message: unknown;
        replyCheck(message: unknown): boolean;
    }>) {
        this.sentMessages.push(message);
        const reply = {
            type: MultiplayerWebSocketMessageType.OfferResult,
            hostClientId: this.replyHostClientId,
        };
        assert.isTrue(replyCheck(reply));
        await this.listeners?.message({
            message: reply,
            webSocket: this,
        });

        return reply;
    }

    public close() {
        this.closeCallCount++;
        this.readyState = WebSocket.CLOSED;
        this.listeners?.close();

        return Promise.resolve();
    }
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

function extractInternals<MessageData extends JsonCompatibleValue>(
    controller: WebrtcMultiplayerController<MessageData>,
) {
    return controller satisfies WebrtcMultiplayerController<MessageData> as unknown as WebrtcMultiplayerControllerInternals<MessageData>;
}

function createCapturingApiClient(webSocket: FakeClientWebSocket) {
    let capturedListeners: CapturedWebSocketListeners | undefined;

    const apiClient = {
        baseUrl: 'http://mock.example',
        connectWebSocket(
            unusedEndpoint: unknown,
            options: Readonly<{
                listeners: CapturedWebSocketListeners;
            }>,
        ) {
            void unusedEndpoint;
            capturedListeners = options.listeners;
            webSocket.listeners = options.listeners;

            return Promise.resolve(webSocket);
        },
    } satisfies Record<string, unknown> as unknown as MultiplayerApiClient;

    return {
        apiClient,
        get listeners() {
            assert.isDefined(capturedListeners);

            return capturedListeners;
        },
    };
}

describe(createNewRoom.name, () => {
    it('creates a room with defaults and overrides', () => {
        const room = createNewRoom({
            roomName: 'Room',
        });

        assert.deepEquals(
            {
                hasRoomPrefix: room.roomId.startsWith('r_'),
                roomName: room.roomName,
                roomPassword: room.roomPassword,
            },
            {
                hasRoomPrefix: true,
                roomName: 'Room',
                roomPassword: '',
            },
        );
    });
});

describe(WebrtcMultiplayerController.name, () => {
    it('tracks connected clients and forwards peer messages', async () => {
        await withMockPeerConnection(async () => {
            const localClientId = createMultiplayerId.client();
            const peerClientId = createMultiplayerId.client();
            const controller = new WebrtcMultiplayerController<TestMessage>(
                'mock',
                createCapturingApiClient(new FakeClientWebSocket(localClientId)).apiClient,
                [],
                createNewRoom(),
                localClientId,
            );
            const updates: unknown[] = [];
            const messages: unknown[] = [];
            const internals = extractInternals(controller);

            makeWritable(controller).hostClientId = localClientId;
            controller.listen(WebrtcMultiplayerConnectionUpdateEvent, ({detail}) => {
                updates.push(detail);
            });
            controller.listen(WebrtcMultiplayerMessageEvent, ({sourceClientId, detail}) => {
                messages.push({
                    sourceClientId,
                    detail,
                });
            });

            const peerConnection = internals.createNewConnection(peerClientId);
            await peerConnection.createOffer([]);
            const peerDataChannel = FakePeerConnection.instances[0]?.createdDataChannels[0];
            assert.isDefined(peerDataChannel);
            peerDataChannel.open();

            controller.sendMessage({
                value: 'broadcast',
            });
            controller.sendToOnlyOneClient(peerClientId, {
                value: 'direct',
            });
            peerDataChannel.receive('{"value":"from peer"}');
            peerDataChannel.close();

            assert.deepEquals(
                {
                    allClientIds: controller.getAllClientIds().toSorted(),
                    connectedClientIds: controller.getConnectedClientIds(),
                    isConnected: controller.isConnected(),
                    isHost: controller.isHost(),
                    messages,
                    sentMessages: peerDataChannel.sentMessages,
                    updates,
                },
                {
                    allClientIds: [
                        localClientId,
                    ],
                    connectedClientIds: [],
                    isConnected: true,
                    isHost: true,
                    messages: [
                        {
                            sourceClientId: peerClientId,
                            detail: {
                                value: 'from peer',
                            },
                        },
                    ],
                    sentMessages: [
                        '{"value":"broadcast"}',
                        '{"value":"direct"}',
                    ],
                    updates: [
                        {
                            newMember: peerClientId,
                        },
                        {
                            lostMember: peerClientId,
                        },
                    ],
                },
            );
        });
    });

    it('reports lost host for member connections', async () => {
        await withMockPeerConnection(async () => {
            const localClientId = createMultiplayerId.client();
            const hostClientId = createMultiplayerId.client();
            const controller = new WebrtcMultiplayerController<TestMessage>(
                'mock',
                createCapturingApiClient(new FakeClientWebSocket(hostClientId)).apiClient,
                [],
                createNewRoom(),
                localClientId,
            );
            const updates: unknown[] = [];
            const internals = extractInternals(controller);
            let reconnectCallCount = 0;

            makeWritable(controller).hostClientId = hostClientId;
            makeWritable(controller).initConnection = () => {
                reconnectCallCount++;
                return Promise.resolve(false);
            };
            assert.deepEquals(controller.getAllClientIds(), []);
            controller.listen(WebrtcMultiplayerConnectionUpdateEvent, ({detail}) => {
                updates.push(detail);
            });

            const hostConnection = internals.createNewConnection(localClientId);
            await hostConnection.createOffer([]);
            const dataChannel = FakePeerConnection.instances[0]?.createdDataChannels[0];
            assert.isDefined(dataChannel);
            dataChannel.open();
            assert.deepEquals(
                controller.getAllClientIds().toSorted(),
                [
                    hostClientId,
                    localClientId,
                ].toSorted(),
            );
            dataChannel.close();

            assert.deepEquals(
                {
                    reconnectCallCount,
                    updates,
                },
                {
                    reconnectCallCount: 1,
                    updates: [
                        {
                            lostHost: localClientId,
                        },
                    ],
                },
            );
        });
    });

    it('handles WebSocket offer branches', async () => {
        await withMockPeerConnection(async () => {
            const localClientId = createMultiplayerId.client();
            const connectingClientId = createMultiplayerId.client();
            const webSocket = new FakeClientWebSocket(localClientId);
            const capturedApiClient = createCapturingApiClient(webSocket);
            const offerMessageId = createMultiplayerId.socketMessage();
            const controller = new WebrtcMultiplayerController<TestMessage>(
                'mock',
                capturedApiClient.apiClient,
                [],
                createNewRoom(),
                localClientId,
                () => false,
            );
            const internals = extractInternals(controller);

            makeWritable(controller).hostClientId = localClientId;
            assert.strictEquals(await internals.setupWebSocket(), webSocket);
            assert.strictEquals(await internals.setupWebSocket(), webSocket);
            webSocket.readyState = WebSocket.CONNECTING;
            assert.strictEquals(await internals.setupWebSocket(), webSocket);
            webSocket.readyState = WebSocket.OPEN;

            await capturedApiClient.listeners.message({
                message: {
                    type: MultiplayerWebSocketMessageType.Offer,
                    messageId: offerMessageId,
                    roomId: controller.multiplayerRoom.roomId,
                    roomName: controller.multiplayerRoom.roomName,
                    clientId: connectingClientId,
                    data: {
                        type: MultiplayerWebSocketMessageType.Offer,
                        sdp: 'offer',
                    },
                },
                webSocket,
            });

            assert.deepEquals(webSocket.sentMessages, [
                {
                    type: MultiplayerWebSocketMessageType.Answer,
                    messageId: offerMessageId,
                    roomId: controller.multiplayerRoom.roomId,
                    roomName: controller.multiplayerRoom.roomName,
                    clientId: connectingClientId,
                    data: {
                        rejected: true,
                    },
                },
            ]);
        });
    });

    it('handles accepted WebSocket offers', async () => {
        await withMockPeerConnection(async () => {
            const localClientId = createMultiplayerId.client();
            const connectingClientId = createMultiplayerId.client();
            const webSocket = new FakeClientWebSocket(localClientId);
            const capturedApiClient = createCapturingApiClient(webSocket);
            const offerMessageId = createMultiplayerId.socketMessage();
            const controller = new WebrtcMultiplayerController<TestMessage>(
                'mock',
                capturedApiClient.apiClient,
                [],
                createNewRoom(),
                localClientId,
            );
            const internals = extractInternals(controller);

            makeWritable(controller).hostClientId = localClientId;
            await internals.setupWebSocket();
            await capturedApiClient.listeners.message({
                message: {
                    type: MultiplayerWebSocketMessageType.Offer,
                    messageId: offerMessageId,
                    roomId: controller.multiplayerRoom.roomId,
                    roomName: controller.multiplayerRoom.roomName,
                    clientId: connectingClientId,
                    data: {
                        type: MultiplayerWebSocketMessageType.Offer,
                        sdp: 'offer',
                    },
                },
                webSocket,
            });

            assert.deepEquals(webSocket.sentMessages[0], {
                type: MultiplayerWebSocketMessageType.Answer,
                messageId: offerMessageId,
                roomId: controller.multiplayerRoom.roomId,
                roomName: controller.multiplayerRoom.roomName,
                clientId: connectingClientId,
                data: {
                    type: MultiplayerWebSocketMessageType.Answer,
                    sdp: 'mock answer',
                },
            });
        });
    });

    it('handles send and WebSocket guard failures', async () => {
        await withMockPeerConnection(async () => {
            const localClientId = createMultiplayerId.client();
            const hostClientId = createMultiplayerId.client();
            const throwingClientId = createMultiplayerId.client();
            const webSocket = new FakeClientWebSocket(hostClientId);
            const capturedApiClient = createCapturingApiClient(webSocket);
            const controller = new WebrtcMultiplayerController<TestMessage>(
                'mock',
                capturedApiClient.apiClient,
                [],
                createNewRoom(),
                localClientId,
            );
            const internals = extractInternals(controller);

            controller.sendToOnlyOneClient(throwingClientId, {
                value: 'not host',
            });
            makeWritable(controller).hostClientId = localClientId;
            controller.sendToOnlyOneClient(throwingClientId, {
                value: 'missing',
            });
            internals.connections[throwingClientId] = {
                clientId: throwingClientId,
                isConnected: true,
                destroy() {},
                sendMessage() {
                    throw new Error('send failed');
                },
            };
            internals.createNewConnection(hostClientId);
            controller.sendMessage({
                value: 'throws',
            });

            makeWritable(controller).hostClientId = hostClientId;
            await internals.setupWebSocket();
            await capturedApiClient.listeners.message({
                message: {
                    type: MultiplayerWebSocketMessageType.Offer,
                    clientId: createMultiplayerId.client(),
                    messageId: createMultiplayerId.socketMessage(),
                    roomId: controller.multiplayerRoom.roomId,
                    roomName: controller.multiplayerRoom.roomName,
                    data: {
                        type: MultiplayerWebSocketMessageType.Offer,
                        sdp: 'offer',
                    },
                },
                webSocket,
            });

            makeWritable(controller).hostClientId = localClientId;
            await capturedApiClient.listeners.message({
                message: {
                    type: MultiplayerWebSocketMessageType.Answer,
                    data: {
                        type: MultiplayerWebSocketMessageType.Answer,
                        sdp: 'answer',
                    },
                },
                webSocket,
            });

            makeWritable(controller).hostClientId = hostClientId;
            delete internals.connections[localClientId];
            await capturedApiClient.listeners.message({
                message: {
                    type: MultiplayerWebSocketMessageType.Answer,
                    data: {
                        type: MultiplayerWebSocketMessageType.Answer,
                        sdp: 'answer',
                    },
                },
                webSocket,
            });
        });
    });

    it('handles WebSocket answer and result branches', async () => {
        await withMockPeerConnection(async () => {
            const localClientId = createMultiplayerId.client();
            const hostClientId = createMultiplayerId.client();
            const webSocket = new FakeClientWebSocket(hostClientId);
            const capturedApiClient = createCapturingApiClient(webSocket);
            const controller = new WebrtcMultiplayerController<TestMessage>(
                'mock',
                capturedApiClient.apiClient,
                [],
                createNewRoom(),
                localClientId,
            );
            const updates: unknown[] = [];
            const internals = extractInternals(controller);
            const initConnection = internals.createNewConnection(localClientId);

            controller.listen(WebrtcMultiplayerConnectionUpdateEvent, ({detail}) => {
                updates.push(detail);
            });
            await initConnection.createOffer([]);
            await internals.setupWebSocket();
            await capturedApiClient.listeners.message({
                message: {
                    type: MultiplayerWebSocketMessageType.OfferResult,
                    hostClientId,
                },
                webSocket,
            });
            await capturedApiClient.listeners.message({
                message: {
                    type: MultiplayerWebSocketMessageType.Answer,
                    data: {
                        type: MultiplayerWebSocketMessageType.Answer,
                        sdp: 'answer',
                    },
                },
                webSocket,
            });
            capturedApiClient.listeners.close();
            capturedApiClient.listeners.error(new Error('test error'));

            assert.deepEquals(
                {
                    closeCallCount: webSocket.closeCallCount,
                    hostClientId: controller.hostClientId,
                    updates,
                    webSocket: internals.webSocket,
                },
                {
                    closeCallCount: 1,
                    hostClientId,
                    updates: [
                        {
                            newHost: hostClientId,
                        },
                    ],
                    webSocket: undefined,
                },
            );
        });
    });

    it('handles rejected answers and invalid WebSocket messages', async () => {
        await withMockPeerConnection(async () => {
            const localClientId = createMultiplayerId.client();
            const hostClientId = createMultiplayerId.client();
            const webSocket = new FakeClientWebSocket(hostClientId);
            const capturedApiClient = createCapturingApiClient(webSocket);
            const controller = new WebrtcMultiplayerController<TestMessage>(
                'mock',
                capturedApiClient.apiClient,
                [],
                createNewRoom(),
                localClientId,
            );
            const internals = extractInternals(controller);

            makeWritable(controller).hostClientId = hostClientId;
            await internals.setupWebSocket();
            await capturedApiClient.listeners.message({
                message: {
                    type: MultiplayerWebSocketMessageType.Answer,
                    data: {
                        rejected: true,
                    },
                },
                webSocket,
            });
            assert.isTrue(controller.isDestroyed);

            await capturedApiClient.listeners.message({
                message: {
                    type: MultiplayerWebSocketMessageType.Error,
                    errorMessage: 'server error',
                },
                webSocket,
            });
            await capturedApiClient.listeners.message({
                message: {
                    type: 'invalid',
                },
                webSocket,
            });
        });
    });

    it('initializes as a host through the mock API client', async () => {
        await withMockPeerConnection(async () => {
            const localClientId = createMultiplayerId.client();
            const existingConnectionController = new WebrtcMultiplayerController<TestMessage>(
                'mock',
                createCapturingApiClient(new FakeClientWebSocket(localClientId)).apiClient,
                [],
                createNewRoom(),
                localClientId,
            );

            extractInternals(existingConnectionController).createNewConnection(localClientId);

            assert.isFalse(await existingConnectionController.initConnection());

            const webSocket = new FakeClientWebSocket(localClientId);
            const {apiClient} = createCapturingApiClient(webSocket);
            const controller = new WebrtcMultiplayerController<TestMessage>(
                'mock',
                apiClient,
                [],
                createNewRoom(),
                localClientId,
            );

            assert.isTrue(await controller.initConnection());
            controller.destroy();

            assert.isTrue(controller.isDestroyed);
        });
    });
});
