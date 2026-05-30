import {
    defineApi,
    defineEndpoint,
    defineWebSocket,
    HttpMethod,
    HttpStatus,
    type WebSocketClientMessageType,
    type WebSocketHostMessageType,
} from '@rest-vir/api';
import {defineShape, exactShape, recordShape, tupleShape, unionShape} from 'object-shape-tester';
import {buildUrl} from 'url-vir';
import {multiplayerIdShapes} from '../multiplayer-id.js';
import {
    answerMessageShape,
    errorMessageShape,
    forwardedOfferMessageShape,
    hostPingMessageShape,
    offerMessageShape,
    offerResultShape,
} from './multiplayer-socket-messages.js';

/**
 * Shape definition for {@link MultiplayerClientRoom}.
 *
 * @category Internal
 */
export const multiplayerClientRoomShape = defineShape({
    roomName: '',
    roomId: multiplayerIdShapes.room(),
    clientCount: -1,
    hasRoomPassword: false,
});

/**
 * Room stats presented to clients when they fetch the current list of rooms.
 *
 * @category Internal
 */
export type MultiplayerClientRoom = typeof multiplayerClientRoomShape.runtimeType;

/**
 * Shape definition for {@link MultiplayerClientRooms}.
 *
 * @category Internal
 */
export const multiplayerClientRoomsShape = defineShape(
    recordShape({
        keys: multiplayerIdShapes.room(),
        values: multiplayerClientRoomShape,
        partial: true,
    }),
);
/**
 * A collection of {@link MultiplayerClientRoom} instances.
 *
 * @category Internal
 */
export type MultiplayerClientRooms = typeof multiplayerClientRoomsShape.runtimeType;

/**
 * The default, or starting, port for the multiplayer API.
 *
 * @category Internal
 */
export const defaultMultiplayerApiPort = 3500;
/**
 * The default multiplayer API origin.
 *
 * @category Internal
 */
export const defaultMultiplayerApiOrigin = buildUrl('http://localhost', {
    port: defaultMultiplayerApiPort,
}).origin;

/**
 * Multiplayer API root endpoint.
 *
 * @category Internal
 */
export const multiplayerRootEndpoint = defineEndpoint({
    path: '/',
    requests: {
        [HttpMethod.Get]: {
            responses: {
                [HttpStatus.Ok]: {
                    responseData: exactShape('ok'),
                },
            },
        },
    },
});

/**
 * Multiplayer API health endpoint.
 *
 * @category Internal
 */
export const multiplayerHealthEndpoint = defineEndpoint({
    path: '/health',
    requests: {
        [HttpMethod.Get]: {
            responses: {
                [HttpStatus.Ok]: {
                    responseData: exactShape('ok'),
                },
            },
        },
    },
});

/**
 * Multiplayer room listing endpoint.
 *
 * @category Internal
 */
export const multiplayerRoomsEndpoint = defineEndpoint({
    path: '/rooms',
    requests: {
        [HttpMethod.Get]: {
            responses: {
                [HttpStatus.Ok]: {
                    responseData: multiplayerClientRoomsShape,
                },
            },
            searchParams: {
                gameId: tupleShape(''),
            },
        },
    },
});

/**
 * Multiplayer signaling WebSocket.
 *
 * @category Internal
 */
export const multiplayerConnectWebSocket = defineWebSocket({
    path: '/connect',
    clientMessage: unionShape(answerMessageShape, offerMessageShape, hostPingMessageShape),
    hostMessage: unionShape(
        answerMessageShape,
        forwardedOfferMessageShape,
        offerResultShape,
        errorMessageShape,
    ),
    searchParams: {
        gameId: tupleShape(''),
    },
});

/**
 * Message sent from a multiplayer WebSocket client.
 *
 * @category Internal
 */
export type MultiplayerConnectClientMessage = WebSocketClientMessageType<
    typeof multiplayerConnectWebSocket
>;

/**
 * Message sent from the multiplayer WebSocket host.
 *
 * @category Internal
 */
export type MultiplayerConnectHostMessage = WebSocketHostMessageType<
    typeof multiplayerConnectWebSocket
>;

/**
 * The multiplayer API definition.
 *
 * @category Internal
 */
export const multiplayerApi = defineApi({
    apiName: 'multiplayer-api',
    endpoints: [
        multiplayerRootEndpoint,
        multiplayerHealthEndpoint,
        multiplayerRoomsEndpoint,
    ],
    webSockets: [
        multiplayerConnectWebSocket,
    ],
});

/** @category Internal */
export type MultiplayerApi = typeof multiplayerApi;
