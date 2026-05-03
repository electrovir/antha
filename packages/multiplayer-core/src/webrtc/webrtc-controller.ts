import {assert, assertWrap, check} from '@augment-vir/assert';
import {
    addPrefix,
    DeferredPromise,
    makeWritable,
    wrapInTry,
    type JsonCompatibleValue,
} from '@augment-vir/common';
import {assertValidShape} from 'object-shape-tester';
import {defineTypedCustomEvent, ListenTarget} from 'typed-event-target';
import {type ClientId} from '../multiplayer-id.js';
import {
    webrtcAnswerShape,
    webrtcOfferShape,
    type WebrtcAnswer,
    type WebrtcOffer,
} from './web-rtc-communication.js';

/**
 * Converts an `RTCSessionDescription` into a plain object so that shape validation works correctly.
 * Browser `RTCSessionDescription` objects expose `type` and `sdp` as prototype getters rather than
 * own data properties, which causes `Object.getOwnPropertyNames`-based checks (used by TypeBox /
 * object-shape-tester) to miss them.
 *
 * @category Internal
 */
export function toPlainSessionDescription(description: Readonly<RTCSessionDescription>) {
    return {
        type: description.type,
        sdp: description.sdp,
    };
}

/**
 * An event that is omitted from {@link WebrtcController} when a WebRTC message is received.
 *
 * @category Internal
 */
export class WebrtcMessageEvent<
    MessageData extends JsonCompatibleValue,
> extends defineTypedCustomEvent<any>()('webrtc-message') {
    public declare detail: MessageData;
}

/**
 * An event that is omitted from {@link WebrtcController} when the WebRTC connection is made or lost.
 * `event.detail` is `true` if the connection has been made; `false` if the connection was lost.
 *
 * @category Internal
 */
export class WebrtcConnectEvent extends defineTypedCustomEvent<boolean>()('webrtc-connect') {}

/**
 * All events fro {@link WebrtcController}.
 *
 * @category Internal
 */
export type WebrtcEvents<MessageData extends JsonCompatibleValue> =
    | WebrtcMessageEvent<MessageData>
    | WebrtcConnectEvent;

function formatStunServerUrls(stunServerUrls: ReadonlyArray<string>) {
    return stunServerUrls.map((stunServerUrl) => {
        return {
            urls: addPrefix({
                value: stunServerUrl,
                prefix: 'stun:',
            }),
        };
    });
}

/**
 * A single peer-to-peer WebRTC controller. It is to be used like this:
 *
 * 1. Call {@link WebrtcController.createOffer} to start off a WebRTC handshake. Send this offer to
 *    another WebRTC connection or {@link WebrtcController} instance.
 * 2. Call {@link WebrtcController.createAnswer} to accept someone else's WebRTC handshake offer and
 *    create a WebRTC handshake answer. Send this answer back to whoever sent the WebRTC offer.
 * 3. Call {@link WebrtcController.acceptAnswer} on the {@link WebrtcController} instance that first
 *    created the offer.
 *
 * If everything went well, after those 3 steps you'll now have a live WebRTC connection!
 *
 * @category Internal
 */
export class WebrtcController<MessageData extends JsonCompatibleValue> extends ListenTarget<
    WebrtcEvents<MessageData>
> {
    private dataChannel: undefined | Readonly<RTCDataChannel>;
    private connection: undefined | Readonly<RTCPeerConnection>;
    /** Indicates whether the WebRTC connection is live or not. */
    public readonly isConnected: boolean = false;

    constructor(public readonly clientId: ClientId) {
        super();
    }

    /** Create a WebRTC offer. This is the first step in the WebRTC handshake process. */
    public async createOffer(stunServerUrls: ReadonlyArray<string>): Promise<WebrtcOffer> {
        const candidatePromise = this.createConnection(stunServerUrls);
        assert.isDefined(this.connection);
        this.handleDataChannel(this.connection.createDataChannel('chat'));
        await this.connection.setLocalDescription(await this.connection.createOffer());

        await candidatePromise;

        const offer = toPlainSessionDescription(
            assertWrap.isDefined(this.connection.localDescription),
        );
        assertValidShape(offer, webrtcOfferShape);

        return offer;
    }

    /** Accepts a WebRTC answer. This is the third (and last) step in the WebRTC handshake process. */
    public async acceptAnswer(rawAnswer: string | Readonly<RTCSessionDescriptionInit>) {
        const answer = check.isString(rawAnswer) ? JSON.parse(rawAnswer) : rawAnswer;
        assert.isDefined(this.connection);
        assertValidShape(answer, webrtcAnswerShape);
        await this.connection.setRemoteDescription(answer);
    }

    /**
     * Accepts a WebRTC offer and creates a WebRTC answer. This is the second step in the WebRTC
     * handshake process.
     */
    public async createAnswer(
        rawOffer: string | Readonly<RTCSessionDescriptionInit>,
        stunServerUrls: ReadonlyArray<string>,
    ): Promise<WebrtcAnswer> {
        const offer: RTCSessionDescriptionInit = check.isString(rawOffer)
            ? JSON.parse(rawOffer)
            : rawOffer;

        const candidatePromise = this.createConnection(stunServerUrls);
        assert.isDefined(this.connection);
        this.connection.addEventListener('datachannel', (event) => {
            this.handleDataChannel(event.channel);
        });

        await this.connection.setRemoteDescription(offer);
        await this.connection.setLocalDescription(await this.connection.createAnswer());

        if (stunServerUrls.length) {
            await candidatePromise;
        }

        const answer = toPlainSessionDescription(
            assertWrap.isDefined(this.connection.localDescription),
        );

        assertValidShape(answer, webrtcAnswerShape);

        return answer;
    }

    /**
     * Send a message to the other peer in the WebRTC connection. This will throw an error if the
     * connection has not been established yet.
     */
    public sendMessage(data: Readonly<MessageData>) {
        assert.isTrue(
            this.isConnected,
            `There is no WebRTC connection to send a message to from ${this.clientId}.`,
        );
        assert.isDefined(
            this.dataChannel,
            `There is no WebRTC connection to send a message to from ${this.clientId}.`,
        );

        this.dataChannel.send(JSON.stringify(data));
    }

    public override destroy() {
        this.dataChannel?.close();
        this.connection?.close();
        super.destroy();
    }

    private handleDataChannel(dataChannel: Readonly<RTCDataChannel>) {
        this.dataChannel?.close();
        this.dataChannel = dataChannel;
        this.dataChannel.addEventListener('open', () => {
            makeWritable(this).isConnected = true;
            this.dispatch(
                new WebrtcConnectEvent({
                    detail: true,
                }),
            );
        });
        this.dataChannel.addEventListener('closing', () => {
            makeWritable(this).isConnected = false;
            this.dispatch(
                new WebrtcConnectEvent({
                    detail: false,
                }),
            );
        });
        this.dataChannel.addEventListener('message', (event) => {
            const detail: any = wrapInTry(
                () => (check.isString(event.data) ? JSON.parse(event.data) : event.data),
                {
                    fallbackValue: event.data,
                },
            );

            this.dispatch(
                new WebrtcMessageEvent<MessageData>({
                    detail,
                }),
            );
        });
    }

    private createConnection(stunServerUrls: ReadonlyArray<string>) {
        if (this.connection) {
            throw new Error('Connection already created!');
        }

        const deferredIceCandidatePromise = new DeferredPromise();
        const iceCandidateListener = (event: RTCPeerConnectionIceEvent) => {
            // all candidates are done
            if (!event.candidate) {
                assert.isDefined(this.connection);
                deferredIceCandidatePromise.resolve();
                this.connection.removeEventListener('icecandidate', iceCandidateListener);
            }
        };

        this.connection = new RTCPeerConnection({
            iceServers: formatStunServerUrls(stunServerUrls),
        });
        this.connection.addEventListener('icecandidate', iceCandidateListener);

        /**
         * This must be awaited so the candidate list can finish populating before we present the
         * offer to the user.
         */
        return deferredIceCandidatePromise.promise;
    }
}
