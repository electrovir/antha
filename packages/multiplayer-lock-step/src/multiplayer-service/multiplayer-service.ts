import {AnyOrigin, defineService, HttpMethod} from '@rest-vir/define-service';
import {
    defineShape,
    exactShape,
    recordShape,
    tupleShape,
    unionShape,
    uuidShape,
} from 'object-shape-tester';
import {buildUrl} from 'url-vir';
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
    roomId: uuidShape(),
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
        keys: uuidShape(),
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
 * The output from {@link defineMultiplayerService}, regardless of what the passed-in `serviceOrigin`
 * is.
 *
 * @category Internal
 */
export type MultiplayerService = ReturnType<typeof defineMultiplayerService>;

/**
 * The default, or starting, port for the multiplayer service.
 *
 * @category Internal
 */
export const defaultMultiplayerServicePort = 3500;
/**
 * The default multiplayer service origin.
 *
 * @category Internal
 */
export const defaultMultiplayerServiceOrigin = buildUrl('http://localhost', {
    port: defaultMultiplayerServicePort,
}).origin;

/**
 * The multiplayer service definition.
 *
 * @category Internal
 */
export function defineMultiplayerService(backendOrigin = defaultMultiplayerServiceOrigin) {
    return defineService({
        serviceName: 'multiplayer-service',
        requiredClientOrigin: AnyOrigin,
        serviceOrigin: backendOrigin,
        endpoints: {
            /** Same as health. */
            '/': {
                methods: {
                    [HttpMethod.Get]: true,
                },
                requestDataShape: undefined,
                responseDataShape: exactShape('ok'),
                requiredClientOrigin: AnyOrigin,
            },
            '/health': {
                methods: {
                    [HttpMethod.Get]: true,
                },
                requestDataShape: undefined,
                responseDataShape: exactShape('ok'),
                requiredClientOrigin: AnyOrigin,
            },
            /** List all current public rooms. */
            '/rooms': {
                requestDataShape: undefined,
                responseDataShape: multiplayerClientRoomsShape,
                methods: {
                    [HttpMethod.Get]: true,
                },
                searchParamsShape: {
                    gameId: tupleShape(''),
                },
            },
        },
        webSockets: {
            '/connect': {
                messageFromClientShape: unionShape(
                    answerMessageShape,
                    offerMessageShape,
                    hostPingMessageShape,
                ),
                messageFromHostShape: unionShape(
                    answerMessageShape,
                    forwardedOfferMessageShape,
                    offerResultShape,
                    errorMessageShape,
                ),
                searchParamsShape: {
                    gameId: tupleShape(''),
                },
            },
        },
    });
}
