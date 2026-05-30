import {type PartialWithUndefined} from '@augment-vir/common';
import {createMockHost, HttpMethod, HttpStatus} from '@rest-vir/api';
import {
    multiplayerApi,
    multiplayerConnectWebSocket,
    multiplayerHealthEndpoint,
    multiplayerRoomsEndpoint,
    multiplayerRootEndpoint,
    type MultiplayerClientRooms,
} from '../multiplayer-api/multiplayer-api.js';
import {createMultiplayerRoomHandler} from './multiplayer-room-handler.js';

/**
 * Creates a mock multiplayer API client that can be used without running a backend server. The
 * returned API client mocks all HTTP endpoints and WebSocket connections.
 *
 * - If a client connects to a room that doesn't exist, the room is created and the client becomes the
 *   host.
 * - If a client connects to a room that already exists, the offer is forwarded to the host and the
 *   host's answer is relayed back to the connecting client.
 *
 * This is useful for demos, testing, and development scenarios where you want the multiplayer code
 * path to work without a real backend.
 *
 * Use the returned mock API client with lower-level multiplayer controllers.
 *
 * @category Main
 * @example
 *
 * ```ts
 * import {
 *     createMockRoomHandlerServerApiClient,
 *     LockStepGameStateController,
 * } from '@antha/multiplayer-lock-step';
 *
 * const mockApiClient = createMockRoomHandlerServerApiClient();
 * const lockStep = new LockStepGameStateController({milliseconds: 16});
 * await lockStep.multiplayerConnect('my-game', mockApiClient, [], {
 *     roomId: 'some-room-id',
 *     roomName: 'My Room',
 *     roomPassword: '',
 * });
 * ```
 */
export function createMockRoomHandlerServerApiClient(
    options?: Readonly<
        PartialWithUndefined<{
            /** Mock rooms to return from the `/rooms` endpoint. */
            rooms: Readonly<MultiplayerClientRooms>;
        }>
    >,
) {
    const defaultGameId = 'mock';

    const roomHandler = createMultiplayerRoomHandler({
        disablePeriodicCleanup: true,
    });

    /** Seed any initially provided rooms into the fetching cache. */
    if (options?.rooms) {
        Object.assign(roomHandler.state.roomsForFetching, {
            [defaultGameId]: {
                ...options.rooms,
            },
        });
    }

    return createMockHost(multiplayerApi, {
        endpoints: {
            [multiplayerRootEndpoint.path]: {
                [HttpMethod.Get]() {
                    return {
                        [HttpStatus.Ok]: {
                            responseData: 'ok',
                        },
                    };
                },
            },
            [multiplayerHealthEndpoint.path]: {
                [HttpMethod.Get]() {
                    return {
                        [HttpStatus.Ok]: {
                            responseData: 'ok',
                        },
                    };
                },
            },
            [multiplayerRoomsEndpoint.path]: {
                [HttpMethod.Get]() {
                    return {
                        [HttpStatus.Ok]: {
                            responseData: roomHandler.getRoomsForFetching(defaultGameId),
                        },
                    };
                },
            },
        },
        webSockets: {
            [multiplayerConnectWebSocket.path]: {
                message({message, webSocket}) {
                    roomHandler.enqueueMessage({
                        gameId: defaultGameId,
                        message,
                        transport: {
                            send(hostMessage) {
                                webSocket.send(hostMessage);
                            },
                            get readyState() {
                                return webSocket.readyState;
                            },
                        },
                    });
                    roomHandler.processQueue();
                },
                close() {
                    roomHandler.updateRoomsForFetching(defaultGameId);
                },
            },
        },
    });
}
