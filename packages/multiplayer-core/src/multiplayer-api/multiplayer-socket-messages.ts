import {defineShape, exactShape, intersectShape, unionShape} from 'object-shape-tester';
import {multiplayerIdShapes} from '../multiplayer-id.js';
import {
    MultiplayerWebSocketMessageType,
    webrtcAnswerShape,
    webrtcOfferShape,
} from '../webrtc/web-rtc-communication.js';

/**
 * A shape definition for {@link ClientIdentification} when joining or creating a room.
 *
 * @category Internal
 */
export const clientIdShape = defineShape({
    /** This id is used to keep track of each client on the multiplayer server. */
    clientId: multiplayerIdShapes.client(),
    /**
     * The id of the room that the user is communicating with. Set this either to to an existing
     * room to join that room, or a new id to create a new room.
     */
    roomId: multiplayerIdShapes.room(),
    /** The name of the room to create or join. */
    roomName: '',
});

/**
 * Data included in each multiplayer server message that is used to identify the message client and
 * the room they wish to join or host.
 *
 * @category Internal
 */
export type ClientIdentification = typeof clientIdShape.runtimeType;

/**
 * Base shape definition for every message type.
 *
 * @category Internal
 */
export const baseMessageShape = defineShape({
    /**
     * The id of the original message. If a message is ever a response to another message, the
     * message id will remain the same throughout the chain.
     */
    messageId: multiplayerIdShapes.socketMessage(),
});

/**
 * ==========================================================
 *
 * # Message Shape Definitions
 *
 * ==========================================================
 */

/**
 * Shape definition for "answer" messages.
 *
 * @category Internal
 */
export const answerMessageShape = defineShape(
    intersectShape(clientIdShape, baseMessageShape, {
        type: exactShape(MultiplayerWebSocketMessageType.Answer),
        /**
         * This data object matches the `RTCSessionDescriptionInit` type from the TS lib. This data
         * should be passed into `RTCPeerConnection.setRemoteDescription` to accept a WebRTC
         * answer.
         */
        data: unionShape(
            {
                rejected: exactShape(true),
            },
            webrtcAnswerShape,
        ),
    }),
);

/**
 * Shape definition for "host ping" messages.
 *
 * @category Internal
 */
export const hostPingMessageShape = defineShape(
    intersectShape(clientIdShape, baseMessageShape, {
        type: exactShape(MultiplayerWebSocketMessageType.HostPing),
        /** This secret is used to verify that the sender is indeed the host of the current room. */
        clientSecret: '',
        clientCount: -1,
        roomPassword: '',
    }),
);

/**
 * Shape definition for "offer" messages forwarded from the multiplayer server to the host.
 *
 * @category Internal
 */
export const forwardedOfferMessageShape = defineShape(
    intersectShape(clientIdShape, baseMessageShape, {
        type: exactShape(MultiplayerWebSocketMessageType.Offer),
        /**
         * This data object matches the `RTCSessionDescriptionInit` type from the TS lib. This data
         * should be passed into `RTCPeerConnection.setRemoteDescription` when creating an offer.
         */
        data: webrtcOfferShape,
    }),
);

/**
 * Shape definition for "offer" messages.
 *
 * @category Internal
 */
export const offerMessageShape = defineShape(
    intersectShape(forwardedOfferMessageShape, baseMessageShape, {
        /**
         * This secret is used to verify that a client is a host of a room. Do not share this with
         * other clients.
         */
        clientSecret: '',
        /**
         * Set this when joining a room with a password or when creating a room to set a room
         * password.
         */
        roomPassword: '',
    }),
);

/**
 * Shape definition for "offer result" messages.
 *
 * @category Internal
 */
export const offerResultShape = defineShape(
    intersectShape(baseMessageShape, {
        type: exactShape(MultiplayerWebSocketMessageType.OfferResult),
        hostClientId: multiplayerIdShapes.client(),
    }),
);

/**
 * Shape definition for error messages.
 *
 * @category Internal
 */
export const errorMessageShape = defineShape(
    intersectShape(baseMessageShape, {
        type: exactShape(MultiplayerWebSocketMessageType.Error),
        errorMessage: '',
    }),
);
