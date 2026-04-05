import {
    defineMultiplayerService,
    MultiplayerWebSocketMessageType,
    type ClientIdentification,
    type MultiplayerClientRoom,
    type MultiplayerClientRooms,
    type MultiplayerService,
} from '@antha/multiplayer-lock-step';
import {check} from '@augment-vir/assert';
import {
    callAsynchronously,
    createUuidV4,
    getOrSet,
    mapObjectValues,
    omitObjectKeys,
    stringify,
    type ArrayElement,
    type PartialWithUndefined,
    type Uuid,
} from '@augment-vir/common';
import {
    checkOriginRequirement,
    CommonWebSocketState,
    type OriginRequirement,
} from '@rest-vir/define-service';
import {
    defaultServiceLogger,
    HttpStatus,
    implementService,
    silentServiceLogger,
    type ServerWebSocket,
    type ServiceLogger,
} from '@rest-vir/implement-service';
import {convertDuration} from 'date-vir';
import {type RequireAtLeastOne} from 'type-fest';

/**
 * Multiplayer server options.
 *
 * @category Internal
 */
export type MultiplayerServerOptions = PartialWithUndefined<{
    /**
     * The Multiplayer server's logger.
     *
     * For help setting this, see any of the following from `@rest-vir/implement-service':
     *
     * - `silentServiceLogger`
     * - `defaultServiceLogger`
     * - `createServiceLogger`
     */
    logger: ServiceLogger;
    backendOrigin: string;
}> & {
    games: RequireAtLeastOne<{
        /**
         * Allow specific games by id. If a game id is not matched, the below `default` requirement
         * is checked. If no game id is matched and there is no specified `default` requirement, the
         * request is blocked.
         *
         * If a game id's origin requirement is `undefined`, it is not considered a match.
         */
        byId: {
            [GameId in string]: OriginRequirement;
        };
        /**
         * The default requirement for all unmatched game ids. If this is omitted or `undefined`,
         * all unmatched game ids are blocked.
         */
        default: OriginRequirement;
    }>;
};

/**
 * An individual multiplayer client.
 *
 * @category Internal
 */
export type MultiplayerClient = Pick<ClientIdentification, 'clientId'> & {
    clientSecret: string;
    webSocket: ServerWebSocket<MultiplayerService['webSockets']['/connect']>;
};

/**
 * A multiplayer room.
 *
 * @category Internal
 */
export type MultiplayerServerRoom = {
    clientsAwaitingAnswer: Record<Uuid, MultiplayerClient>;
    hostClient: MultiplayerClient;
    clientCount: number;
    roomPassword: string;
    lastHostPingTimestamp: number;
} & Pick<MultiplayerClientRoom, 'roomName' | 'roomId'>;

/**
 * A collection of multiplayer rooms.
 *
 * @category Internal
 */
export type MultiplayerServerRooms = {
    [GameId in string]: {
        [RoomId in Uuid]: MultiplayerServerRoom;
    };
};

/**
 * Internal state for the multiplayer server.
 *
 * @category Internal
 */
export type MultiplayerServerState = {
    multiplayerRooms: MultiplayerServerRooms;
    webSocketMessageQueue: {
        gameId: string;
        webSocket: ServerWebSocket<MultiplayerService['webSockets']['/connect']>;
        message: MultiplayerService['webSockets']['/connect']['MessageFromClientType'];
    }[];
    isProcessingQueue: boolean;
    updateRoomsIntervalId: ReturnType<typeof setInterval> | undefined;
    /**
     * This is separate from the multiplayer rooms object because this object is directly
     * transferred to any client that hits the `/rooms` endpoint to keep CPU load minimal. This
     * object is only updated when necessary.
     */
    roomsForFetching: {
        [GameId in string]: MultiplayerClientRooms;
    };

    logger: ServiceLogger;
};

/**
 * The default logger for {@link ImplementedMultiplayerService}.
 *
 * @category Internal
 */
export const defaultMultiplayerServiceLogger: ServiceLogger = {
    error: defaultServiceLogger.error,
    info: silentServiceLogger.info,
};

/**
 * The implemented service returned from {@link implementMultiplayerService}.
 *
 * @category Internal
 */
export type ImplementedMultiplayerService = ReturnType<
    typeof implementMultiplayerService
>['service'];

/**
 * Implements the multiplayer server.
 *
 * @category Internal
 */
export function implementMultiplayerService(options: MultiplayerServerOptions) {
    const serverState: MultiplayerServerState = {
        logger: options.logger || defaultMultiplayerServiceLogger,
        multiplayerRooms: {},
        webSocketMessageQueue: [],
        isProcessingQueue: false,
        updateRoomsIntervalId: undefined,

        roomsForFetching: {},
    };
    const serviceDefinition = defineMultiplayerService(options.backendOrigin);

    const service = implementService({
        service: serviceDefinition,
        logger: serverState.logger,
        async createContext({
            searchParams,
            endpointDefinition,
            webSocketDefinition,
            requestHeaders,
        }) {
            const definition = endpointDefinition || webSocketDefinition;

            if (!definition) {
                return {
                    reject: {
                        statusCode: HttpStatus.NotFound,
                    },
                };
            } else if (
                serviceDefinition.endpoints['/'].path === definition.path ||
                serviceDefinition.endpoints['/health'].path === definition.path
            ) {
                return {
                    context: {
                        gameId: '',
                    },
                };
            }

            const gameId = 'gameId' in searchParams ? searchParams.gameId[0] : undefined;
            const originRequirement =
                check.isString(gameId) && gameId
                    ? options.games.byId?.[gameId] || options.games.default
                    : undefined;

            if (!check.isString(gameId) || !gameId) {
                serverState.logger.error(new TypeError(`Invalid game ID: '${gameId}'`));
                return {
                    reject: {
                        statusCode: HttpStatus.Unauthorized,
                    },
                };
            } else if (!(await checkOriginRequirement(requestHeaders.origin, originRequirement))) {
                serverState.logger.error(
                    new TypeError(`Origin check failed for game: '${gameId}'`),
                );
                return {
                    reject: {
                        statusCode: HttpStatus.Unauthorized,
                    },
                };
            }

            return {
                context: {
                    gameId,
                },
            };
        },
    })({
        endpoints: {
            '/'() {
                return {
                    statusCode: HttpStatus.Ok,
                    responseData: 'ok',
                };
            },
            '/health'() {
                return {
                    statusCode: HttpStatus.Ok,
                    responseData: 'ok',
                };
            },
            '/rooms'({context}) {
                return {
                    statusCode: HttpStatus.Ok,
                    responseData: serverState.roomsForFetching[context.gameId] || {},
                };
            },
        },
        webSockets: {
            '/connect': {
                message({message, webSocket, context}) {
                    serverState.webSocketMessageQueue.push({
                        gameId: context.gameId,
                        message,
                        webSocket,
                    });
                    void callAsynchronously(() => processQueue(serverState));
                },
            },
        },
    });

    return {
        serverState,
        service,
    };
}

const updateRoomsForFetchingIntervalDuration = convertDuration(
    {
        seconds: 5,
    },
    {
        milliseconds: true,
    },
);

function updateRoomsForFetchingOnInterval(
    serverState: Pick<
        MultiplayerServerState,
        'roomsForFetching' | 'multiplayerRooms' | 'logger' | 'updateRoomsIntervalId'
    >,
) {
    if (serverState.updateRoomsIntervalId) {
        return;
    }

    serverState.updateRoomsIntervalId = setInterval(() => {
        Object.keys(serverState.multiplayerRooms).forEach((gameId) =>
            updateRoomsForFetching(gameId, serverState),
        );

        if (!Object.keys(serverState.multiplayerRooms).length) {
            clearInterval(serverState.updateRoomsIntervalId);
            serverState.updateRoomsIntervalId = undefined;
        }
    }, updateRoomsForFetchingIntervalDuration.milliseconds);
}

function updateRoomsForFetching(
    gameId: string,
    serverState: Pick<
        MultiplayerServerState,
        'roomsForFetching' | 'multiplayerRooms' | 'logger' | 'updateRoomsIntervalId'
    >,
) {
    const gameRooms = serverState.multiplayerRooms[gameId];

    if (!gameRooms) {
        return;
    }

    Object.values(gameRooms).forEach((multiplayerRoom) => {
        if (
            /** Delete a room if its host is no longer active. */
            multiplayerRoom.hostClient.webSocket.readyState !== CommonWebSocketState.Open ||
            /** Delete a room if it has had no updates from the host for two cycles. */
            multiplayerRoom.lastHostPingTimestamp <=
                Date.now() - updateRoomsForFetchingIntervalDuration.milliseconds * 2
        ) {
            delete gameRooms[multiplayerRoom.roomId];
        }
    });

    if (!Object.keys(gameRooms).length) {
        delete serverState.multiplayerRooms[gameId];
        delete serverState.roomsForFetching[gameId];
        return;
    }

    serverState.roomsForFetching[gameId] = mapObjectValues(
        gameRooms,
        (roomId, multiplayerRoom): MultiplayerClientRoom => {
            return {
                clientCount: multiplayerRoom.clientCount,
                hasRoomPassword: !!multiplayerRoom.roomPassword,
                roomId,
                roomName: multiplayerRoom.roomName,
            };
        },
    );
}

function processQueueItem(
    serverState: MultiplayerServerState,
    {message, webSocket, gameId}: ArrayElement<typeof serverState.webSocketMessageQueue>,
) {
    const multiplayerRoom =
        serverState.multiplayerRooms[gameId]?.[message.roomId]?.hostClient.webSocket.readyState ===
        CommonWebSocketState.Open
            ? serverState.multiplayerRooms[gameId][message.roomId]
            : undefined;
    const currentClient: MultiplayerClient = {
        clientId: message.clientId,
        webSocket,
        clientSecret: 'clientSecret' in message ? message.clientSecret : '',
    };

    if (message.type === MultiplayerWebSocketMessageType.Offer) {
        if (multiplayerRoom) {
            /** The client is connecting to an existing room with a valid host. */
            if (
                multiplayerRoom.roomPassword &&
                message.roomPassword !== multiplayerRoom.roomPassword
            ) {
                webSocket.send({
                    messageId: message.messageId,
                    type: MultiplayerWebSocketMessageType.Error,
                    errorMessage: 'Invalid password.',
                });
            } else {
                serverState.logger.info(
                    `Sending offer to host ${multiplayerRoom.hostClient.clientId} in room ${multiplayerRoom.roomName} (${multiplayerRoom.roomId})`,
                );
                multiplayerRoom.clientsAwaitingAnswer[currentClient.clientId] = currentClient;
                multiplayerRoom.hostClient.webSocket.send(
                    omitObjectKeys(message, [
                        'clientSecret',
                        'roomPassword',
                    ]),
                );
                webSocket.send({
                    messageId: message.messageId,
                    type: MultiplayerWebSocketMessageType.OfferResult,
                    hostClientId: multiplayerRoom.hostClient.clientId,
                });
            }
        } else {
            /**
             * The client is either creating a new room or joining a room that just died (so create
             * a new one).
             */
            const newRoom: MultiplayerServerRoom = {
                clientsAwaitingAnswer: {},
                hostClient: currentClient,
                roomName: message.roomName,
                roomId: message.roomId,
                roomPassword: message.roomPassword,
                clientCount: 1,
                lastHostPingTimestamp: Date.now(),
            };
            serverState.logger.info(
                `Creating new room '${newRoom.roomName}' with id '${newRoom.roomId}' and host '${currentClient.clientId}'`,
            );
            getOrSet(serverState.multiplayerRooms, gameId, () => {
                return {};
            })[newRoom.roomId] = newRoom;
            updateRoomsForFetching(gameId, serverState);
            webSocket.send({
                messageId: message.messageId,
                type: MultiplayerWebSocketMessageType.OfferResult,
                hostClientId: newRoom.hostClient.clientId,
            });
        }
    } else if (message.type === MultiplayerWebSocketMessageType.Answer) {
        /** The host client is sending an answer to one of its clients. */

        serverState.logger.info(`Received answer from ${message.clientId}`);

        const client = multiplayerRoom?.clientsAwaitingAnswer[message.clientId];

        if (client && client.webSocket.readyState === CommonWebSocketState.Open) {
            /**
             * Now that we're sending an answer to this client, we can remove it from the list of
             * clients that are waiting for answers.
             */
            delete multiplayerRoom.clientsAwaitingAnswer[message.clientId];
            serverState.logger.info(
                `Sending answer to host ${message.clientId} in room ${multiplayerRoom.roomName} (${multiplayerRoom.roomId}).`,
            );

            serverState.logger.info(`Sending answer to ${client.clientId}`);
            client.webSocket.send(message);
        } else {
            const errorMessage = `No client found waiting for an answer by id ${message.clientId}`;
            serverState.logger.error(new Error(errorMessage));
            webSocket.send({
                messageId: message.messageId,
                type: MultiplayerWebSocketMessageType.Error,
                errorMessage,
            });
            return;
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    } else if (message.type === MultiplayerWebSocketMessageType.HostPing) {
        if (multiplayerRoom && multiplayerRoom.hostClient.clientSecret === message.clientSecret) {
            multiplayerRoom.clientCount = message.clientCount;
            multiplayerRoom.roomName = message.roomName;
            multiplayerRoom.roomPassword = message.roomPassword;
            multiplayerRoom.lastHostPingTimestamp = Date.now();

            updateRoomsForFetching(gameId, serverState);
        } else {
            webSocket.send({
                messageId: message.messageId,
                type: MultiplayerWebSocketMessageType.Error,
                errorMessage: `Invalid room to ping.`,
            });
        }
    } else {
        webSocket.send({
            messageId: createUuidV4(),
            type: MultiplayerWebSocketMessageType.Error,
            errorMessage: `Invalid message: ${stringify(message)}`,
        });
    }
}

function processQueue(serverState: MultiplayerServerState) {
    if (serverState.isProcessingQueue) {
        return;
    }
    serverState.isProcessingQueue = true;
    updateRoomsForFetchingOnInterval(serverState);

    let nextItem: ArrayElement<typeof serverState.webSocketMessageQueue> | undefined;

    while ((nextItem = serverState.webSocketMessageQueue.shift())) {
        processQueueItem(serverState, nextItem);
    }
    serverState.isProcessingQueue = false;
}
