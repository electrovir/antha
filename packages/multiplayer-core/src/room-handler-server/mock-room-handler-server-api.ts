import {type MaybePromise, type PartialWithUndefined} from '@augment-vir/common';
import {
    CommonWebSocketState,
    createMockClientWebSocketConstructor,
    createMockEndpointResponse,
    createMockResponse,
    generateApi,
    HttpStatus,
    makeMockApi,
    type MockEndpointResponseOptions,
    WebSocketLocation,
} from '@rest-vir/define-service';
import {
    defineMultiplayerService,
    type MultiplayerClientRooms,
    type MultiplayerService,
} from '../multiplayer-service/multiplayer-service.js';
import {createMultiplayerRoomHandler} from './multiplayer-room-handler.js';

/**
 * Creates a mock multiplayer API that can be used without running a backend server. The returned
 * API mocks all HTTP endpoints and WebSocket connections.
 *
 * - If a client connects to a room that doesn't exist, the room is created and the client becomes the
 *   host.
 * - If a client connects to a room that already exists, the offer is forwarded to the host and the
 *   host's answer is relayed back to the connecting client.
 *
 * This is useful for demos, testing, and development scenarios where you want the multiplayer code
 * path to work without a real backend.
 *
 * Use the returned mock API with lower-level controllers like
 * {@link LockStepGameStateController.multiplayerConnect} or {@link WebrtcMultiplayerController}.
 *
 * @category Main
 * @example
 *
 * ```ts
 * import {
 *     createMockMultiplayerApi,
 *     LockStepGameStateController,
 * } from '@antha/multiplayer-lock-step';
 *
 * const mockApi = createMockMultiplayerApi();
 * const lockStep = new LockStepGameStateController({milliseconds: 16});
 * await lockStep.multiplayerConnect('my-game', mockApi, [], {
 *     roomId: 'some-room-id',
 *     roomName: 'My Room',
 *     roomPassword: '',
 * });
 * ```
 */
export function createMockRoomHandlerServerApi(
    options?: Readonly<
        PartialWithUndefined<{
            /** Mock rooms to return from the `/rooms` endpoint. */
            rooms: Readonly<MultiplayerClientRooms>;
        }>
    >,
) {
    const multiplayerService = defineMultiplayerService();
    const api = generateApi(multiplayerService);
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

    const mockEndpoints: Readonly<{
        [Path in keyof MultiplayerService['endpoints']]: () => MaybePromise<
            Readonly<MockEndpointResponseOptions<(typeof multiplayerService.endpoints)[Path]>>
        >;
    }> = {
        '/'() {
            return {
                body: 'ok',
            };
        },
        '/health'() {
            return {
                body: 'ok',
            };
        },
        '/rooms'() {
            return {
                body: roomHandler.getRoomsForFetching(defaultGameId),
            };
        },
    };

    return makeMockApi(api, {
        async fetch(url, requestInit, endpoint) {
            if (!endpoint) {
                return createMockResponse({
                    status: HttpStatus.NotFound,
                });
            }

            const responseParams = await mockEndpoints[endpoint.path]();

            return createMockEndpointResponse(endpoint, responseParams);
        },
        webSocketConstructor: createMockClientWebSocketConstructor(
            multiplayerService.webSockets['/connect'],
            {
                sendCallback({webSocket, messageData, messageSource}) {
                    if (messageSource !== WebSocketLocation.OnClient) {
                        return;
                    }

                    roomHandler.enqueueMessage({
                        gameId: defaultGameId,
                        message: messageData,
                        transport: {
                            send(message) {
                                webSocket.sendFromHost(message);
                            },
                            readyState: CommonWebSocketState.Open,
                        },
                    });
                    roomHandler.processQueue();
                },
            },
        ),
    });
}
