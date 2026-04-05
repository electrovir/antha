import {
    MultiplayerWebSocketMessageType,
    type MultiplayerClientRooms,
    type MultiplayerService,
} from '@antha/multiplayer-core';
import {assert, assertWrap, waitUntil} from '@augment-vir/assert';
import {
    awaitedForEach,
    createUuidV4,
    extractErrorMessage,
    randomString,
    type ArrayElement,
    type MaybePromise,
    type Uuid,
    type Values,
} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {AnyOrigin, type ClientWebSocket} from '@rest-vir/define-service';
import {testService, type FetchTestService} from '@rest-vir/run-service';
import {type DistributedOmit} from 'type-fest';
import {
    implementMultiplayerService,
    type ImplementedMultiplayerService,
    type MultiplayerServerState,
} from './implemented-multiplayer-service.js';

type SetupRoomsOutput<Rooms extends string[][]> = {
    [Key in keyof Rooms]: {
        roomId: Uuid;
        roomName: string;
        clients: Record<ArrayElement<Rooms[Key]>, TestClient>;
    };
};

type TestClient = {
    webSocket: ClientWebSocket<MultiplayerService['webSockets']['/connect']>;
    clientId: Uuid;
    clientName: string;
    clientSecret: string;
};

type MultiplayerServiceCallbackParams = Readonly<{
    serverState: MultiplayerServerState;
    fetchEndpoint: FetchTestService<ImplementedMultiplayerService>;
    createClient: (name: string) => Promise<TestClient>;
    webSocketMessages: Record<
        string,
        DistributedOmit<
            MultiplayerService['webSockets']['/connect']['MessageFromHostType'],
            'messageId'
        >[]
    >;
    setupRooms: <const Rooms extends string[][]>(rooms: Rooms) => Promise<SetupRoomsOutput<Rooms>>;
    logs: {
        info: unknown[];
        error: string[];
    };
    closeAllWebSockets: () => Promise<void>;
}>;

function testMultiplayerService(
    description: string,
    callback: (params: MultiplayerServiceCallbackParams) => MaybePromise<void>,
) {
    it(description, async () => {
        const logs = {
            info: [] as unknown[],
            error: [] as string[],
        };

        const {service, serverState} = implementMultiplayerService({
            games: {
                byId: {
                    test: AnyOrigin,
                },
            },
            logger: {
                error(error) {
                    logs.error.push(extractErrorMessage(error));
                },
                info(...args) {
                    logs.info.push(...args);
                },
            },
        });

        const allClients: TestClient[] = [];

        const webSocketMessages: Record<
            string,
            DistributedOmit<
                MultiplayerService['webSockets']['/connect']['MessageFromHostType'],
                'messageId'
            >[]
        > = {};

        async function createClient(
            clientName: string,
        ): ReturnType<MultiplayerServiceCallbackParams['createClient']> {
            const webSocket = await connectWebSocket['/connect']({
                searchParams: {
                    gameId: ['test'],
                },
                listeners: {
                    open() {
                        webSocketMessages[clientName] = [];
                    },
                    message({message}) {
                        const {messageId, ...cleanMessage} = message;

                        assertWrap.isDefined(webSocketMessages[clientName]).push(cleanMessage);
                    },
                },
            });

            const testClient = {
                webSocket,
                clientId: createUuidV4(),
                clientName,
                clientSecret: randomString(32),
            };

            allClients.push(testClient);

            return testClient;
        }

        async function setupRooms<Rooms extends string[][]>(
            rooms: Rooms,
        ): Promise<SetupRoomsOutput<Rooms>> {
            const roomIds: Uuid[] = [];

            const finishedRooms = await Promise.all(
                rooms.map(
                    async (roomClients, roomIndex): Promise<Values<SetupRoomsOutput<Rooms>>> => {
                        if (roomClients.length) {
                            const roomId = createUuidV4();
                            roomIds.push(roomId);
                            const roomName = `room-${roomIndex}`;
                            const clients: Record<string, TestClient> = {};

                            await awaitedForEach(roomClients, async (clientName) => {
                                const client = await createClient(clientName);
                                clients[clientName] = client;

                                client.webSocket.send({
                                    messageId: createUuidV4(),
                                    clientId: client.clientId,
                                    data: {
                                        sdp: 'test',
                                        type: MultiplayerWebSocketMessageType.Offer,
                                    },
                                    roomId,
                                    roomName,
                                    type: MultiplayerWebSocketMessageType.Offer,
                                    roomPassword: '',
                                    clientSecret: client.clientSecret,
                                });
                            });

                            return {
                                roomId,
                                roomName,
                                clients,
                            };
                        } else {
                            throw new Error('Cannot create a mock room without any clients.');
                        }
                    },
                ),
            );

            await waitUntil.hasKeys(
                roomIds,
                async () =>
                    await (
                        await fetchEndpoint['/rooms']({
                            searchParams: {
                                gameId: ['test'],
                            },
                        })
                    ).json(),
            );

            return finishedRooms as SetupRoomsOutput<Rooms>;
        }

        async function closeAllWebSockets(this: void) {
            await Promise.all(allClients.map((client) => client.webSocket.close()));
        }

        const {connectWebSocket, fetchEndpoint, kill} = await testService(service);

        try {
            await callback({
                serverState,
                createClient,
                setupRooms,
                fetchEndpoint,
                logs,
                webSocketMessages,
                closeAllWebSockets,
            });
        } finally {
            await closeAllWebSockets();
            await kill();
        }
    });
}

describe('multiplayer service', () => {
    testMultiplayerService(
        'hosts multiple room connections',
        async ({setupRooms, webSocketMessages, fetchEndpoint, closeAllWebSockets}) => {
            assert.isTrue((await fetchEndpoint['/health']()).ok, 'server health should be okay');
            assert.deepEquals(
                await (
                    await fetchEndpoint['/rooms']({
                        searchParams: {
                            gameId: ['test'],
                        },
                    })
                ).json(),
                {},
                'rooms should be empty on server init',
            );

            const rooms = await setupRooms([
                [
                    'a-host',
                ],
                [
                    'b-host',
                    'b-member-1',
                ],
            ]);

            await waitUntil.deepEquals(
                {
                    [rooms[0].clients['a-host'].clientName]: [
                        {
                            type: MultiplayerWebSocketMessageType.OfferResult,
                            hostClientId: rooms[0].clients['a-host'].clientId,
                        },
                    ],
                    [rooms[1].clients['b-host'].clientName]: [
                        {
                            type: MultiplayerWebSocketMessageType.OfferResult,
                            hostClientId: rooms[1].clients['b-host'].clientId,
                        },
                        {
                            clientId: rooms[1].clients['b-member-1'].clientId,
                            data: {
                                sdp: 'test',
                                type: MultiplayerWebSocketMessageType.Offer,
                            },
                            roomId: rooms[1].roomId,
                            roomName: rooms[1].roomName,
                            type: MultiplayerWebSocketMessageType.Offer,
                        },
                    ],
                    [rooms[1].clients['b-member-1'].clientName]: [
                        {
                            type: MultiplayerWebSocketMessageType.OfferResult,
                            hostClientId: rooms[1].clients['b-host'].clientId,
                        },
                    ],
                },
                () => webSocketMessages,
                undefined,
                "Room B host should have received Room B member 1's offer message",
            );

            rooms[1].clients['b-host'].webSocket.send({
                messageId: createUuidV4(),
                type: MultiplayerWebSocketMessageType.HostPing,
                clientCount: 2,
                clientId: rooms[1].clients['b-host'].clientId,
                clientSecret: rooms[1].clients['b-host'].clientSecret,
                roomId: rooms[1].roomId,
                roomName: rooms[1].roomName,
                roomPassword: '',
            });

            await waitUntil.deepEquals(
                {
                    [rooms[0].roomId]: {
                        roomName: rooms[0].roomName,
                        roomId: rooms[0].roomId,
                        clientCount: 1,
                        hasRoomPassword: false,
                    },
                    [rooms[1].roomId]: {
                        roomName: rooms[1].roomName,
                        roomId: rooms[1].roomId,
                        clientCount: 2,
                        hasRoomPassword: false,
                    },
                } satisfies MultiplayerClientRooms,
                async () =>
                    await (
                        await fetchEndpoint['/rooms']({
                            searchParams: {
                                gameId: ['test'],
                            },
                        })
                    ).json(),
                {
                    interval: {
                        seconds: 1,
                    },
                    timeout: {
                        seconds: 20,
                    },
                },
                'Rooms should have appropriate members',
            );

            await closeAllWebSockets();

            await waitUntil.isEmpty(
                async () =>
                    await (
                        await fetchEndpoint['/rooms']({
                            searchParams: {
                                gameId: ['test'],
                            },
                        })
                    ).json(),
                {
                    interval: {
                        seconds: 2,
                    },
                    timeout: {
                        minutes: 1,
                    },
                },
                'Rooms should empty out when their clients have all closed.',
            );
        },
    );
});
