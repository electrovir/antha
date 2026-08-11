import {
    getOrSet,
    mapObjectValues,
    omitObjectKeys,
    stringify,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {CommonWebSocketState} from '@rest-vir/api';
import {convertDuration} from 'date-vir';
import {
    type MultiplayerClientRoom,
    type MultiplayerClientRooms,
    type MultiplayerConnectClientMessage,
    type MultiplayerConnectHostMessage,
} from '../multiplayer-api/multiplayer-api.js';
import {createMultiplayerId, type ClientId, type RoomId} from '../multiplayer-id.js';
import {MultiplayerWebSocketMessageType} from '../webrtc/web-rtc-communication.js';

/**
 * A transport-agnostic client handle that the room handler uses to send messages and check
 * connection state. Both real server WebSockets and mock WebSockets implement this.
 *
 * @category Internal
 */
export type MultiplayerTransportClient = {
    /** Send a signaling message to the connected transport client. */
    send: (message: MultiplayerConnectHostMessage) => void;
    /** Current WebSocket-compatible connection state. */
    readyState: CommonWebSocketState;
};

/**
 * An individual multiplayer client tracked by the room handler.
 *
 * @category Internal
 */
export type RoomHandlerClient = {
    clientId: ClientId;
    clientSecret: string;
    transport: MultiplayerTransportClient;
};

/**
 * A multiplayer room managed by the room handler.
 *
 * @category Internal
 */
export type RoomHandlerRoom = {
    clientsAwaitingAnswer: Record<ClientId, RoomHandlerClient>;
    hostClient: RoomHandlerClient;
    clientCount: number;
    roomPassword: string;
    lastHostPingTimestamp: number;
} & Pick<MultiplayerClientRoom, 'roomName' | 'roomId'>;

/**
 * A collection of rooms grouped by game id.
 *
 * @category Internal
 */
export type RoomHandlerRooms = {
    [GameId in string]: Record<RoomId, RoomHandlerRoom>;
};

/**
 * Logger interface for the room handler.
 *
 * @category Internal
 */
export type RoomHandlerLogger = {
    /** Log informational room handler messages. */
    info: (...args: ReadonlyArray<unknown>) => void;
    /** Log room handler errors. */
    error: (error: Error) => void;
};

/**
 * The internal state for the multiplayer room handler.
 *
 * @category Internal
 */
export type MultiplayerRoomHandlerState = {
    rooms: RoomHandlerRooms;
    messageQueue: {
        gameId: string;
        transport: MultiplayerTransportClient;
        message: MultiplayerConnectClientMessage;
    }[];
    isProcessingQueue: boolean;
    updateRoomsIntervalId: ReturnType<typeof setInterval> | undefined;
    /**
     * Precomputed client-friendly room listing, updated on an interval for real servers or on
     * demand for mocks.
     */
    roomsForFetching: {
        [GameId in string]: MultiplayerClientRooms;
    };
    logger: RoomHandlerLogger;
};

/**
 * Options for creating a {@link MultiplayerRoomHandler}.
 *
 * @category Internal
 */
export type MultiplayerRoomHandlerOptions = PartialWithUndefined<{
    logger: RoomHandlerLogger;
    /**
     * When true, disables the periodic interval that cleans up stale rooms and updates
     * `roomsForFetching`. This is useful for mock/frontend environments where the interval is
     * unnecessary.
     */
    disablePeriodicCleanup: boolean;
}>;

const silentLogger: RoomHandlerLogger = {
    info() {},
    error() {},
};

/**
 * Creates a transport-agnostic multiplayer room handler. This contains the core room management and
 * message routing logic shared between the real server and mock/frontend implementations.
 *
 * @category Internal
 */
export function createMultiplayerRoomHandler(options?: Readonly<MultiplayerRoomHandlerOptions>) {
    const state: MultiplayerRoomHandlerState = {
        rooms: {},
        messageQueue: [],
        isProcessingQueue: false,
        updateRoomsIntervalId: undefined,
        roomsForFetching: {},
        logger: options?.logger || silentLogger,
    };

    return {
        state,

        /** Enqueue a message without immediately processing the queue. */
        enqueueMessage(params: {
            gameId: string;
            transport: MultiplayerTransportClient;
            message: MultiplayerConnectClientMessage;
        }) {
            state.messageQueue.push(params);
        },

        /** Process all queued messages. Safe to call multiple times; re-entrant calls are no-ops. */
        processQueue() {
            processQueue(state, options?.disablePeriodicCleanup || false);
        },

        /** Get the client-friendly room listing for a game. */
        getRoomsForFetching(gameId: string): MultiplayerClientRooms {
            updateRoomsForFetching(gameId, state);
            return state.roomsForFetching[gameId] || {};
        },

        /** Force an immediate update of the rooms-for-fetching cache for a game. */
        updateRoomsForFetching(gameId: string) {
            updateRoomsForFetching(gameId, state);
        },
    };
}

/**
 * The return type of {@link createMultiplayerRoomHandler}.
 *
 * @category Internal
 */
export type MultiplayerRoomHandler = ReturnType<typeof createMultiplayerRoomHandler>;

const updateRoomsForFetchingIntervalDuration = convertDuration(
    {
        seconds: 5,
    },
    {
        milliseconds: true,
    },
);

function updateRoomsForFetchingOnInterval(
    state: Pick<
        MultiplayerRoomHandlerState,
        'roomsForFetching' | 'rooms' | 'logger' | 'updateRoomsIntervalId'
    >,
) {
    if (state.updateRoomsIntervalId) {
        return;
    }

    state.updateRoomsIntervalId = setInterval(() => {
        Object.keys(state.rooms).forEach((gameId) => updateRoomsForFetching(gameId, state));

        if (!Object.keys(state.rooms).length) {
            clearInterval(state.updateRoomsIntervalId);
            state.updateRoomsIntervalId = undefined;
        }
    }, updateRoomsForFetchingIntervalDuration.milliseconds);
}

function updateRoomsForFetching(
    gameId: string,
    state: Pick<
        MultiplayerRoomHandlerState,
        'roomsForFetching' | 'rooms' | 'logger' | 'updateRoomsIntervalId'
    >,
) {
    const gameRooms = state.rooms[gameId];

    if (!gameRooms) {
        return;
    }

    Object.values(gameRooms).forEach((room) => {
        if (
            /** Delete a room if its host is no longer active. */
            room.hostClient.transport.readyState !== CommonWebSocketState.Open ||
            /** Delete a room if the host reports no active room clients. */
            room.clientCount <= 0 ||
            /** Delete a room if it has had no updates from the host for two cycles. */
            room.lastHostPingTimestamp <=
                Date.now() - updateRoomsForFetchingIntervalDuration.milliseconds * 2
        ) {
            delete gameRooms[room.roomId];
        }
    });

    if (!Object.keys(gameRooms).length) {
        delete state.rooms[gameId];
        delete state.roomsForFetching[gameId];
        return;
    }

    state.roomsForFetching[gameId] = mapObjectValues(
        gameRooms,
        (roomId, room): MultiplayerClientRoom => {
            return {
                clientCount: room.clientCount,
                hasRoomPassword: !!room.roomPassword,
                roomId,
                roomName: room.roomName,
            };
        },
    );
}

function processQueueItem(
    state: MultiplayerRoomHandlerState,
    {
        message,
        transport,
        gameId,
    }: {
        gameId: string;
        transport: MultiplayerTransportClient;
        message: MultiplayerConnectClientMessage;
    },
) {
    const room =
        state.rooms[gameId]?.[message.roomId]?.hostClient.transport.readyState ===
        CommonWebSocketState.Open
            ? state.rooms[gameId][message.roomId]
            : undefined;
    const currentClient: RoomHandlerClient = {
        clientId: message.clientId,
        transport,
        clientSecret: 'clientSecret' in message ? message.clientSecret : '',
    };

    if (message.type === MultiplayerWebSocketMessageType.Offer) {
        if (room) {
            /** The client is connecting to an existing room with a valid host. */
            if (room.roomPassword && message.roomPassword !== room.roomPassword) {
                transport.send({
                    messageId: message.messageId,
                    type: MultiplayerWebSocketMessageType.Error,
                    errorMessage: 'Invalid password.',
                });
            } else {
                state.logger.info(
                    `Sending offer to host ${room.hostClient.clientId} in room ${room.roomName} (${room.roomId})`,
                );
                room.clientsAwaitingAnswer[currentClient.clientId] = currentClient;
                room.hostClient.transport.send(
                    omitObjectKeys(message, [
                        'clientSecret',
                        'roomPassword',
                    ]),
                );
                transport.send({
                    messageId: message.messageId,
                    type: MultiplayerWebSocketMessageType.OfferResult,
                    hostClientId: room.hostClient.clientId,
                });
            }
        } else {
            /**
             * The client is either creating a new room or joining a room that just died (so create
             * a new one).
             */
            const newRoom: RoomHandlerRoom = {
                clientsAwaitingAnswer: {},
                hostClient: currentClient,
                roomName: message.roomName,
                roomId: message.roomId,
                roomPassword: message.roomPassword,
                clientCount: 1,
                lastHostPingTimestamp: Date.now(),
            };
            state.logger.info(
                `Creating new room '${newRoom.roomName}' with id '${newRoom.roomId}' and host '${currentClient.clientId}'`,
            );
            getOrSet(state.rooms, gameId, () => {
                return {};
            })[newRoom.roomId] = newRoom;
            updateRoomsForFetching(gameId, state);
            transport.send({
                messageId: message.messageId,
                type: MultiplayerWebSocketMessageType.OfferResult,
                hostClientId: newRoom.hostClient.clientId,
            });
        }
    } else if (message.type === MultiplayerWebSocketMessageType.Answer) {
        /** The host client is sending an answer to one of its clients. */

        state.logger.info(`Received answer from ${message.clientId}`);

        const client = room?.clientsAwaitingAnswer[message.clientId];

        if (client && client.transport.readyState === CommonWebSocketState.Open) {
            /**
             * Now that we're sending an answer to this client, we can remove it from the list of
             * clients that are waiting for answers.
             */
            delete room.clientsAwaitingAnswer[message.clientId];
            state.logger.info(
                `Sending answer to host ${message.clientId} in room ${room.roomName} (${room.roomId}).`,
            );

            state.logger.info(`Sending answer to ${client.clientId}`);
            client.transport.send(message);
        } else {
            const errorMessage = `No client found waiting for an answer by id ${message.clientId}`;
            state.logger.error(new Error(errorMessage));
            transport.send({
                messageId: message.messageId,
                type: MultiplayerWebSocketMessageType.Error,
                errorMessage,
            });
            return;
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    } else if (message.type === MultiplayerWebSocketMessageType.HostPing) {
        const existingRoom = state.rooms[gameId]?.[message.roomId];

        if (existingRoom && existingRoom.hostClient.clientSecret !== message.clientSecret) {
            /** A client that isn't the room's host is trying to ping it. */
            transport.send({
                messageId: message.messageId,
                type: MultiplayerWebSocketMessageType.Error,
                errorMessage: 'Invalid room to ping.',
            });
        } else {
            /** Refresh the room, re-establishing it if needed. */
            const pingedRoom: RoomHandlerRoom = existingRoom ?? {
                clientsAwaitingAnswer: {},
                hostClient: currentClient,
                roomId: message.roomId,
                roomName: message.roomName,
                roomPassword: message.roomPassword,
                clientCount: message.clientCount,
                lastHostPingTimestamp: Date.now(),
            };

            pingedRoom.hostClient = currentClient;
            pingedRoom.clientCount = message.clientCount;
            pingedRoom.roomName = message.roomName;
            pingedRoom.roomPassword = message.roomPassword;
            pingedRoom.lastHostPingTimestamp = Date.now();

            getOrSet(state.rooms, gameId, () => {
                return {};
            })[pingedRoom.roomId] = pingedRoom;

            updateRoomsForFetching(gameId, state);
        }
    } else {
        transport.send({
            messageId: createMultiplayerId.socketMessage(),
            type: MultiplayerWebSocketMessageType.Error,
            errorMessage: `Invalid message: ${stringify(message)}`,
        });
    }
}

function processQueue(state: MultiplayerRoomHandlerState, disablePeriodicCleanup: boolean) {
    if (state.isProcessingQueue) {
        return;
    }
    state.isProcessingQueue = true;

    if (!disablePeriodicCleanup) {
        updateRoomsForFetchingOnInterval(state);
    }

    let nextItem: (typeof state.messageQueue)[number] | undefined;

    while ((nextItem = state.messageQueue.shift())) {
        processQueueItem(state, nextItem);
    }
    state.isProcessingQueue = false;
}
