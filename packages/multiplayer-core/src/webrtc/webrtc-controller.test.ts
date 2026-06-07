import {assert} from '@augment-vir/assert';
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
    toPlainSessionDescription,
    WebrtcConnectEvent,
    WebrtcController,
    WebrtcMessageEvent,
} from './webrtc-controller.js';

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
    public readonly iceServers: RTCIceServer[] | undefined;
    public isClosed = false;
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
        }

        return Promise.resolve();
    }

    public close() {
        this.isClosed = true;
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

            assert.throws(() =>
                controller.sendMessage({
                    message: 'before open',
                }),
            );

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

            const replacementDataChannel = new FakeDataChannel();
            connection.dispatchEvent(
                Object.assign(new Event('datachannel'), {
                    channel: replacementDataChannel,
                }),
            );

            assert.isTrue(initialDataChannel.isClosed);
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
                () =>
                    controller.createAnswer(
                        {
                            type: 'offer',
                            sdp: 'remote offer',
                        },
                        [],
                    ),
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
