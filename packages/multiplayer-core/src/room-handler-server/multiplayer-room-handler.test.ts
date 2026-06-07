import {assert} from '@augment-vir/assert';
import {type MaybePromise, type PartialWithUndefined} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {CommonWebSocketState} from '@rest-vir/api';
import {
    type MultiplayerConnectClientMessage,
    type MultiplayerConnectHostMessage,
} from '../multiplayer-api/multiplayer-api.js';
import {createMultiplayerId} from '../multiplayer-id.js';
import {MultiplayerWebSocketMessageType} from '../webrtc/web-rtc-communication.js';
import {
    createMultiplayerRoomHandler,
    type MultiplayerRoomHandler,
    type MultiplayerTransportClient,
    type RoomHandlerLogger,
} from './multiplayer-room-handler.js';

type OfferMessage = Extract<
    MultiplayerConnectClientMessage,
    {type: MultiplayerWebSocketMessageType.Offer}
>;

type AnswerMessage = Extract<
    MultiplayerConnectClientMessage,
    {type: MultiplayerWebSocketMessageType.Answer}
>;

type HostPingMessage = Extract<
    MultiplayerConnectClientMessage,
    {type: MultiplayerWebSocketMessageType.HostPing}
>;

type FakeTransport = MultiplayerTransportClient & {
    sentMessages: MultiplayerConnectHostMessage[];
};

function createFakeTransport(readyState = CommonWebSocketState.Open): FakeTransport {
    const sentMessages: MultiplayerConnectHostMessage[] = [];

    return {
        sentMessages,
        readyState,
        send(message) {
            sentMessages.push(message);
        },
    };
}

function createOfferMessage({
    clientId = createMultiplayerId.client(),
    clientSecret = 'secret',
    data = {
        type: MultiplayerWebSocketMessageType.Offer,
        sdp: 'offer-sdp',
    },
    messageId = createMultiplayerId.socketMessage(),
    roomId = createMultiplayerId.room(),
    roomName = 'Room',
    roomPassword = '',
}: Readonly<PartialWithUndefined<Omit<OfferMessage, 'type'>>> = {}): OfferMessage {
    return {
        type: MultiplayerWebSocketMessageType.Offer,
        clientId,
        clientSecret,
        data,
        messageId,
        roomId,
        roomName,
        roomPassword,
    };
}

function createAnswerMessage({
    clientId = createMultiplayerId.client(),
    data = {
        type: MultiplayerWebSocketMessageType.Answer,
        sdp: 'answer-sdp',
    },
    messageId = createMultiplayerId.socketMessage(),
    roomId = createMultiplayerId.room(),
    roomName = 'Room',
}: Readonly<PartialWithUndefined<Omit<AnswerMessage, 'type'>>> = {}): AnswerMessage {
    return {
        type: MultiplayerWebSocketMessageType.Answer,
        clientId,
        data,
        messageId,
        roomId,
        roomName,
    };
}

function createHostPingMessage({
    clientCount = 2,
    clientId = createMultiplayerId.client(),
    clientSecret = 'secret',
    messageId = createMultiplayerId.socketMessage(),
    roomId = createMultiplayerId.room(),
    roomName = 'Room',
    roomPassword = '',
}: Readonly<PartialWithUndefined<Omit<HostPingMessage, 'type'>>> = {}): HostPingMessage {
    return {
        type: MultiplayerWebSocketMessageType.HostPing,
        clientCount,
        clientId,
        clientSecret,
        messageId,
        roomId,
        roomName,
        roomPassword,
    };
}

function enqueueAndProcess({
    gameId = 'test-game',
    handler,
    message,
    transport,
}: Readonly<{
    gameId?: string | undefined;
    handler: MultiplayerRoomHandler;
    message: MultiplayerConnectClientMessage;
    transport: MultiplayerTransportClient;
}>) {
    handler.enqueueMessage({
        gameId,
        message,
        transport,
    });
    handler.processQueue();
}

async function withCapturedInterval(
    callback: (params: Readonly<{runIntervalCallback(): void}>) => MaybePromise<void>,
) {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const intervalCallbacks: (() => void)[] = [];

    Object.defineProperty(globalThis, 'setInterval', {
        configurable: true,
        value(intervalCallback: () => void) {
            intervalCallbacks.push(intervalCallback);

            return intervalCallbacks.length;
        },
        writable: true,
    });
    Object.defineProperty(globalThis, 'clearInterval', {
        configurable: true,
        value() {},
        writable: true,
    });

    try {
        await callback({
            runIntervalCallback() {
                const intervalCallback = intervalCallbacks[0];
                assert.isDefined(intervalCallback);
                intervalCallback();
            },
        });
    } finally {
        Object.defineProperty(globalThis, 'setInterval', {
            configurable: true,
            value: originalSetInterval,
            writable: true,
        });
        Object.defineProperty(globalThis, 'clearInterval', {
            configurable: true,
            value: originalClearInterval,
            writable: true,
        });
    }
}

describe(createMultiplayerRoomHandler.name, () => {
    it('creates rooms and routes offers and answers', () => {
        const infoLogs: unknown[][] = [];
        const errors: Error[] = [];
        const logger: RoomHandlerLogger = {
            info(...args) {
                infoLogs.push([...args]);
            },
            error(error) {
                errors.push(error);
            },
        };
        const handler = createMultiplayerRoomHandler({
            disablePeriodicCleanup: true,
            logger,
        });
        const roomId = createMultiplayerId.room();
        const hostClientId = createMultiplayerId.client();
        const memberClientId = createMultiplayerId.client();
        const hostTransport = createFakeTransport();
        const memberTransport = createFakeTransport();
        const hostOffer = createOfferMessage({
            clientId: hostClientId,
            clientSecret: 'host-secret',
            roomId,
            roomName: 'Original Room',
            roomPassword: 'password',
        });

        enqueueAndProcess({
            handler,
            message: hostOffer,
            transport: hostTransport,
        });

        assert.deepEquals(hostTransport.sentMessages, [
            {
                messageId: hostOffer.messageId,
                type: MultiplayerWebSocketMessageType.OfferResult,
                hostClientId,
            },
        ]);
        assert.deepEquals(handler.getRoomsForFetching('test-game'), {
            [roomId]: {
                clientCount: 1,
                hasRoomPassword: true,
                roomId,
                roomName: 'Original Room',
            },
        });

        const rejectedOffer = createOfferMessage({
            clientId: memberClientId,
            roomId,
            roomPassword: 'wrong',
        });

        enqueueAndProcess({
            handler,
            message: rejectedOffer,
            transport: memberTransport,
        });

        const acceptedOffer = createOfferMessage({
            clientId: memberClientId,
            roomId,
            roomPassword: 'password',
        });

        enqueueAndProcess({
            handler,
            message: acceptedOffer,
            transport: memberTransport,
        });

        const answer = createAnswerMessage({
            clientId: memberClientId,
            messageId: acceptedOffer.messageId,
            roomId,
        });

        enqueueAndProcess({
            handler,
            message: answer,
            transport: hostTransport,
        });

        assert.deepEquals(
            {
                errors,
                hostMessages: hostTransport.sentMessages,
                infoLogCount: infoLogs.length,
                memberMessages: memberTransport.sentMessages,
            },
            {
                errors: [],
                hostMessages: [
                    {
                        messageId: hostOffer.messageId,
                        type: MultiplayerWebSocketMessageType.OfferResult,
                        hostClientId,
                    },
                    {
                        type: MultiplayerWebSocketMessageType.Offer,
                        clientId: memberClientId,
                        data: {
                            type: MultiplayerWebSocketMessageType.Offer,
                            sdp: 'offer-sdp',
                        },
                        messageId: acceptedOffer.messageId,
                        roomId,
                        roomName: 'Room',
                    },
                ],
                infoLogCount: 5,
                memberMessages: [
                    {
                        messageId: rejectedOffer.messageId,
                        type: MultiplayerWebSocketMessageType.Error,
                        errorMessage: 'Invalid password.',
                    },
                    {
                        messageId: acceptedOffer.messageId,
                        type: MultiplayerWebSocketMessageType.OfferResult,
                        hostClientId,
                    },
                    answer,
                ],
            },
        );
    });

    it('handles missing answer targets, host pings, invalid messages, and cleanup', () => {
        const errors: Error[] = [];
        const handler = createMultiplayerRoomHandler({
            disablePeriodicCleanup: true,
            logger: {
                info() {},
                error(error) {
                    errors.push(error);
                },
            },
        });
        const roomId = createMultiplayerId.room();
        const hostClientId = createMultiplayerId.client();
        const missingClientId = createMultiplayerId.client();
        const hostTransport = createFakeTransport();
        const memberTransport = createFakeTransport();

        const hostOffer = createOfferMessage({
            clientId: hostClientId,
            clientSecret: 'host-secret',
            roomId,
        });
        enqueueAndProcess({
            handler,
            message: hostOffer,
            transport: hostTransport,
        });
        const missingAnswer = createAnswerMessage({
            clientId: missingClientId,
            roomId,
        });
        enqueueAndProcess({
            handler,
            message: missingAnswer,
            transport: hostTransport,
        });
        enqueueAndProcess({
            handler,
            message: createHostPingMessage({
                clientId: hostClientId,
                clientCount: 3,
                clientSecret: 'host-secret',
                roomId,
                roomName: 'Updated Room',
            }),
            transport: hostTransport,
        });
        const invalidHostPing = createHostPingMessage({
            clientId: hostClientId,
            clientSecret: 'wrong',
            roomId,
        });
        enqueueAndProcess({
            handler,
            message: invalidHostPing,
            transport: memberTransport,
        });
        const invalidMessage = {
            clientId: createMultiplayerId.client(),
            messageId: createMultiplayerId.socketMessage(),
            roomId,
            roomName: 'Room',
            type: 'invalid',
        } satisfies Record<string, unknown> as unknown as MultiplayerConnectClientMessage;

        enqueueAndProcess({
            handler,
            message: invalidMessage,
            transport: memberTransport,
        });

        const invalidMessageError = memberTransport.sentMessages[1];
        assert.isDefined(invalidMessageError);

        assert.deepEquals(
            {
                errors: errors.map((error) => error.message),
                roomsForFetching: handler.getRoomsForFetching('test-game'),
                hostMessages: hostTransport.sentMessages,
                memberMessages: memberTransport.sentMessages,
            },
            {
                errors: [
                    'No client found waiting for an answer by id ' + missingClientId,
                ],
                roomsForFetching: {
                    [roomId]: {
                        clientCount: 3,
                        hasRoomPassword: false,
                        roomId,
                        roomName: 'Updated Room',
                    },
                },
                hostMessages: [
                    {
                        messageId: hostOffer.messageId,
                        type: MultiplayerWebSocketMessageType.OfferResult,
                        hostClientId,
                    },
                    {
                        messageId: missingAnswer.messageId,
                        type: MultiplayerWebSocketMessageType.Error,
                        errorMessage:
                            'No client found waiting for an answer by id ' + missingClientId,
                    },
                ],
                memberMessages: [
                    {
                        messageId: invalidHostPing.messageId,
                        type: MultiplayerWebSocketMessageType.Error,
                        errorMessage: 'Invalid room to ping.',
                    },
                    {
                        messageId: invalidMessageError.messageId,
                        type: MultiplayerWebSocketMessageType.Error,
                        errorMessage:
                            "Invalid message: {clientId:'" +
                            invalidMessage.clientId +
                            "',messageId:'" +
                            invalidMessage.messageId +
                            "',roomId:'" +
                            roomId +
                            "',roomName:'Room',type:'invalid'}",
                    },
                ],
            },
        );

        const gameRooms = handler.state.rooms['test-game'];
        assert.isDefined(gameRooms);
        const room = gameRooms[roomId];
        assert.isDefined(room);
        room.clientCount = 0;
        handler.updateRoomsForFetching('test-game');

        assert.deepEquals(handler.getRoomsForFetching('test-game'), {});
    });

    it('handles queue guards, missing rooms, periodic cleanup, and silent logger paths', async () => {
        await withCapturedInterval(({runIntervalCallback}) => {
            const handler = createMultiplayerRoomHandler();
            const roomId = createMultiplayerId.room();
            const transport = createFakeTransport();

            handler.updateRoomsForFetching('missing-game');
            handler.state.isProcessingQueue = true;
            const queuedAnswer = createAnswerMessage({
                roomId,
            });
            handler.enqueueMessage({
                gameId: 'test-game',
                message: queuedAnswer,
                transport,
            });
            handler.processQueue();

            assert.isLengthExactly(handler.state.messageQueue, 1);

            handler.state.isProcessingQueue = false;
            handler.processQueue();
            handler.processQueue();

            assert.isLengthExactly(handler.state.messageQueue, 0);

            handler.state.rooms['empty-game'] = {};
            runIntervalCallback();

            assert.deepEquals(
                {
                    intervalId: handler.state.updateRoomsIntervalId,
                    rooms: handler.state.rooms,
                    transportMessages: transport.sentMessages,
                },
                {
                    intervalId: undefined,
                    rooms: {},
                    transportMessages: [
                        {
                            messageId: queuedAnswer.messageId,
                            type: MultiplayerWebSocketMessageType.Error,
                            errorMessage:
                                'No client found waiting for an answer by id ' +
                                queuedAnswer.clientId,
                        },
                    ],
                },
            );
        });
    });

    it('removes inactive rooms from the fetching cache', () => {
        const handler = createMultiplayerRoomHandler({
            disablePeriodicCleanup: true,
        });
        const closedHostRoomId = createMultiplayerId.room();
        const staleRoomId = createMultiplayerId.room();
        const zeroClientRoomId = createMultiplayerId.room();
        const closedHostTransport = createFakeTransport();
        const staleTransport = createFakeTransport();
        const zeroClientTransport = createFakeTransport();

        [
            {
                roomId: closedHostRoomId,
                transport: closedHostTransport,
            },
            {
                roomId: staleRoomId,
                transport: staleTransport,
            },
            {
                roomId: zeroClientRoomId,
                transport: zeroClientTransport,
            },
        ].forEach(({roomId, transport}) => {
            enqueueAndProcess({
                handler,
                message: createOfferMessage({
                    roomId,
                }),
                transport,
            });
        });

        const gameRooms = handler.state.rooms['test-game'];
        assert.isDefined(gameRooms);
        const zeroClientRoom = gameRooms[zeroClientRoomId];
        const staleRoom = gameRooms[staleRoomId];
        assert.isDefined(zeroClientRoom);
        assert.isDefined(staleRoom);
        closedHostTransport.readyState = CommonWebSocketState.Closed;
        zeroClientRoom.clientCount = 0;
        staleRoom.lastHostPingTimestamp = 0;

        handler.updateRoomsForFetching('test-game');

        assert.deepEquals(
            {
                rooms: handler.state.rooms,
                roomsForFetching: handler.getRoomsForFetching('test-game'),
            },
            {
                rooms: {},
                roomsForFetching: {},
            },
        );
    });
});
