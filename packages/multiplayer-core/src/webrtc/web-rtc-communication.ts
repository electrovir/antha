import {defineShape, exactShape} from 'object-shape-tester';

/**
 * All possible message types sent to and from the game-vir multiplayer server. These are used to
 * establish WebRTC connections.
 *
 * @category Internal
 */
export enum MultiplayerWebSocketMessageType {
    /**
     * Sent to the multiplayer server from a client when they want to connect. The offer is then
     * forwarded to the host client.
     *
     * If a host has not been set yet, then this client becomes the host.
     */
    Offer = 'offer',
    /**
     * Sent to the multiplayer server from a host client (in response to an offer), then forwarded
     * to the client.
     *
     * If the offer was rejected, this will contain significantly less data.
     */
    Answer = 'answer',

    /**
     * Sent from the multiplayer server to a client WebSocket after their offer has been processed
     * to instruct the client on what kind of client they are (member or host).
     */
    OfferResult = 'offer-result',

    /**
     * A message sent to the multiplayer server from the host client to keep the room info up to
     * date. This will be sent repeatedly on an interval.
     */
    HostPing = 'host-ping',

    /** An error message. */
    Error = 'error',
}

/**
 * Shape definition for {@link WebrtcAnswer}.
 *
 * @category Internal
 */
export const webrtcAnswerShape = defineShape({
    type: exactShape(MultiplayerWebSocketMessageType.Answer),
    sdp: '',
});
/**
 * WebRTC handshake answer data.
 *
 * @category Internal
 */
export type WebrtcAnswer = typeof webrtcAnswerShape.runtimeType;

/**
 * Shape definition for {@link WebrtcOffer}.
 *
 * @category Internal
 */
export const webrtcOfferShape = defineShape({
    type: exactShape(MultiplayerWebSocketMessageType.Offer),
    sdp: '',
});

/**
 * WebRTC handshake offer data.
 *
 * @category Internal
 */
export type WebrtcOffer = typeof webrtcOfferShape.runtimeType;
