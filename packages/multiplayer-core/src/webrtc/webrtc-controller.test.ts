import {assert, assertWrap} from '@augment-vir/assert';
import {type MaybePromise} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {assertValidShape} from 'object-shape-tester';
import {createMultiplayerId} from '../multiplayer-id.js';
import {
    MultiplayerWebSocketMessageType,
    webrtcAnswerShape,
    webrtcOfferShape,
} from './web-rtc-communication.js';
import {
    MessageDelivery,
    toPlainSessionDescription,
    WebrtcConnectEvent,
    WebrtcController,
    WebrtcMessageEvent,
} from './webrtc-controller.js';

class FakeDataChannel extends EventTarget {
    public readonly sentMessages: string[] = [];
    public isClosed = false;
    public readyState: RTCDataChannelState = 'connecting';

    constructor(
        public readonly label = '',
        public readonly options?: RTCDataChannelInit | undefined,
    ) {
        super();
    }

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
        this.readyState = 'open';
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
    /** The candidates each connection gathers, in order. `undefined` ends gathering. */
    public static readonly gatheredCandidateTypes: (RTCIceCandidateType | undefined)[] = [];

    public readonly removedListenerTypes: string[] = [];

    public readonly createdDataChannels: FakeDataChannel[] = [];
    public readonly iceServers: RTCIceServer[] | undefined;
    public isClosed = false;
    public iceConnectionState: RTCIceConnectionState = 'new';
    public localDescription: RTCSessionDescriptionInit | undefined;
    public remoteDescription: RTCSessionDescriptionInit | undefined;

    constructor(configuration?: RTCConfiguration | undefined) {
        super();
        this.iceServers = configuration?.iceServers;
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
                FakePeerConnection.gatheredCandidateTypes.forEach((candidateType) => {
                    this.dispatchEvent(
                        Object.assign(new Event('icecandidate'), {
                            candidate: candidateType && {
                                type: candidateType,
                            },
                        }),
                    );
                });
            });
        }
    }

    public override removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: EventListenerOptions | boolean | undefined,
    ) {
        super.removeEventListener(type, listener, options);
        this.removedListenerTypes.push(type);
    }

    public createDataChannel(label: string, options?: RTCDataChannelInit | undefined) {
        const dataChannel = new FakeDataChannel(label, options);
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
        }

        return Promise.resolve();
    }

    public close() {
        this.isClosed = true;
    }

    public setIceConnectionState(state: RTCIceConnectionState) {
        this.iceConnectionState = state;
        this.dispatchEvent(new Event('iceconnectionstatechange'));
    }
}

async function withMockPeerConnection(callback: () => MaybePromise<void>) {
    const originalPeerConnection = globalThis.RTCPeerConnection;
    FakePeerConnection.instances.length = 0;
    FakePeerConnection.gatheredCandidateTypes.splice(0, Infinity, undefined);

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

describe(toPlainSessionDescription.name, () => {
    it('extracts type and sdp into a plain object', () => {
        const description = new RTCSessionDescription({
            type: 'offer',
            sdp: 'v=0\r\n',
        });

        assert.deepEquals(toPlainSessionDescription(description), {
            type: 'offer',
            sdp: 'v=0\r\n',
        });
    });

    it('produces an object that passes webrtcOfferShape validation', () => {
        const description = new RTCSessionDescription({
            type: 'offer',
            sdp: 'v=0\r\n',
        });

        assertValidShape(toPlainSessionDescription(description), webrtcOfferShape);
    });

    it('produces an object that passes webrtcAnswerShape validation', () => {
        const description = new RTCSessionDescription({
            type: 'answer',
            sdp: 'v=0\r\n',
        });

        assertValidShape(toPlainSessionDescription(description), webrtcAnswerShape);
    });

    it('produces own enumerable properties', () => {
        const description = new RTCSessionDescription({
            type: 'offer',
            sdp: 'v=0\r\n',
        });

        const plain = toPlainSessionDescription(description);

        assert.deepEquals(Object.keys(plain).sort(), [
            'sdp',
            'type',
        ]);
    });
});

describe(WebrtcController.name, () => {
    it('creates offers and sends messages over an opened data channel', async () => {
        await withMockPeerConnection(async () => {
            const controller = new WebrtcController(createMultiplayerId.client());
            const connectionStates: boolean[] = [];
            const messages: unknown[] = [];

            controller.listen(WebrtcConnectEvent, ({detail}) => {
                connectionStates.push(detail);
            });
            controller.listen(WebrtcMessageEvent, ({detail}) => {
                messages.push(detail);
            });

            assert.deepEquals(await controller.createOffer(['example.com']), {
                type: MultiplayerWebSocketMessageType.Offer,
                sdp: 'mock offer',
            });

            const connection = FakePeerConnection.instances[0];
            assert.isDefined(connection);
            assert.deepEquals(connection.iceServers, [
                {
                    urls: 'stun:example.com',
                },
            ]);

            const dataChannel = connection.createdDataChannels[0];
            assert.isDefined(dataChannel);

            assert.throws(() => {
                return controller.sendMessage({
                    message: 'before open',
                });
            });

            dataChannel.open();
            controller.sendMessage({
                message: 'after open',
            });
            dataChannel.receive('{"message":"from peer"}');
            dataChannel.receive('not json');
            dataChannel.receive({
                message: 'object',
            });
            dataChannel.close();
            controller.destroy();

            assert.deepEquals(
                {
                    connectionClosed: connection.isClosed,
                    connectionStates,
                    dataChannelClosed: dataChannel.isClosed,
                    messages,
                    sentMessages: dataChannel.sentMessages,
                },
                {
                    connectionClosed: true,
                    connectionStates: [
                        true,
                        false,
                    ],
                    dataChannelClosed: true,
                    messages: [
                        {
                            message: 'from peer',
                        },
                        'not json',
                        {
                            message: 'object',
                        },
                    ],
                    sentMessages: [
                        '{"message":"after open"}',
                    ],
                },
            );
        });
    });

    it('stops gathering at the first server-reflexive candidate', async () => {
        await withMockPeerConnection(async () => {
            FakePeerConnection.gatheredCandidateTypes.splice(0, Infinity, 'host', 'srflx');
            const controller = new WebrtcController(createMultiplayerId.client());

            await controller.createOffer([]);

            assert.deepEquals(
                assertWrap.isDefined(FakePeerConnection.instances[0]).removedListenerTypes,
                [
                    'icecandidate',
                ],
            );
            controller.destroy();
        });
    });

    it('reports a failed ICE connection as lost only once', async () => {
        await withMockPeerConnection(async () => {
            const controller = new WebrtcController(createMultiplayerId.client());
            const connectionStates: boolean[] = [];

            controller.listen(WebrtcConnectEvent, ({detail}) => {
                connectionStates.push(detail);
            });

            await controller.createOffer([]);
            const connection = assertWrap.isDefined(FakePeerConnection.instances[0]);
            assertWrap.isDefined(connection.createdDataChannels[0]).open();
            connection.setIceConnectionState('disconnected');
            connection.setIceConnectionState('failed');
            assertWrap.isDefined(connection.createdDataChannels[0]).close();

            assert.deepEquals(
                {
                    connectionStates,
                    isConnected: controller.isConnected,
                },
                {
                    connectionStates: [
                        true,
                        false,
                    ],
                    isConnected: false,
                },
            );
            controller.destroy();
        });
    });

    it('sends unreliable messages over the unreliable channel once it opens', async () => {
        await withMockPeerConnection(async () => {
            const controller = new WebrtcController(createMultiplayerId.client());
            const messages: unknown[] = [];

            controller.listen(WebrtcMessageEvent, ({detail}) => {
                messages.push(detail);
            });

            await controller.createOffer([]);

            const [
                reliableChannel,
                unreliableChannel,
            ] = assertWrap.isLengthExactly(
                assertWrap.isDefined(FakePeerConnection.instances[0]).createdDataChannels,
                2,
            );

            reliableChannel.open();
            controller.sendMessage('before unreliable open', MessageDelivery.Unreliable);
            unreliableChannel.open();
            controller.sendMessage('after unreliable open', MessageDelivery.Unreliable);
            controller.sendMessage('reliable');
            unreliableChannel.receive('"unreliable from peer"');
            controller.destroy();

            assert.deepEquals(
                {
                    messages,
                    reliableSent: reliableChannel.sentMessages,
                    unreliableClosed: unreliableChannel.isClosed,
                    unreliableOptions: unreliableChannel.options,
                    unreliableSent: unreliableChannel.sentMessages,
                },
                {
                    messages: [
                        'unreliable from peer',
                    ],
                    reliableSent: [
                        '"before unreliable open"',
                        '"reliable"',
                    ],
                    unreliableClosed: true,
                    unreliableOptions: {
                        ordered: false,
                        maxRetransmits: 0,
                    },
                    unreliableSent: [
                        '"after unreliable open"',
                    ],
                },
            );
        });
    });

    it('creates answers from string offers', async () => {
        await withMockPeerConnection(async () => {
            const controller = new WebrtcController(createMultiplayerId.client());

            assert.deepEquals(
                await controller.createAnswer(
                    JSON.stringify({
                        type: 'offer',
                        sdp: 'remote offer',
                    }),
                    ['example.com'],
                ),
                {
                    type: MultiplayerWebSocketMessageType.Answer,
                    sdp: 'mock answer',
                },
            );

            const connection = FakePeerConnection.instances[0];
            assert.isDefined(connection);
            assert.deepEquals(connection.remoteDescription, {
                type: 'offer',
                sdp: 'remote offer',
            });
            const initialDataChannel = connection.createdDataChannels[0];
            assert.isDefined(initialDataChannel);
            const initialUnreliableDataChannel = new FakeDataChannel('unreliable');
            connection.dispatchEvent(
                Object.assign(new Event('datachannel'), {
                    channel: initialUnreliableDataChannel,
                }),
            );

            [
                new FakeDataChannel(),
                new FakeDataChannel('unreliable'),
            ].forEach((replacementDataChannel) => {
                connection.dispatchEvent(
                    Object.assign(new Event('datachannel'), {
                        channel: replacementDataChannel,
                    }),
                );
            });

            assert.isTrue(initialDataChannel.isClosed);
            assert.isTrue(initialUnreliableDataChannel.isClosed);
        });
    });

    it('accepts answer objects and rejects duplicate connection creation', async () => {
        await withMockPeerConnection(async () => {
            const controller = new WebrtcController(createMultiplayerId.client());

            await controller.createOffer([]);
            await controller.acceptAnswer({
                type: 'answer',
                sdp: 'remote answer',
            });

            await assert.throws(
                () => {
                    return controller.createAnswer(
                        {
                            type: 'offer',
                            sdp: 'remote offer',
                        },
                        [],
                    );
                },
                {
                    matchMessage: 'Connection already created!',
                },
            );
        });
    });

    it('accepts answer strings', async () => {
        await withMockPeerConnection(async () => {
            const controller = new WebrtcController(createMultiplayerId.client());

            await controller.createOffer([]);
            await controller.acceptAnswer(
                JSON.stringify({
                    type: 'answer',
                    sdp: 'remote answer',
                }),
            );

            const connection = FakePeerConnection.instances[0];
            assert.isDefined(connection);
            assert.deepEquals(connection.remoteDescription, {
                type: 'answer',
                sdp: 'remote answer',
            });
        });
    });
});
