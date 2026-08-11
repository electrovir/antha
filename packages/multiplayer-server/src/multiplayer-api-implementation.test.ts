import {
    createMultiplayerId,
    multiplayerConnectWebSocket,
    multiplayerHealthEndpoint,
    multiplayerRoomsEndpoint,
    multiplayerRootEndpoint,
    MultiplayerWebSocketMessageType,
    type ClientId,
    type MultiplayerClientRooms,
    type MultiplayerConnectHostMessage,
    type RoomId,
} from '@antha/multiplayer-core';
import {assert, assertWrap, waitUntil} from '@augment-vir/assert';
import {
    awaitedForEach,
    extractErrorMessage,
    randomString,
    type ArrayElement,
    type DistributedOmit,
    type MaybePromise,
    type Values,
} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {AnyOrigin, HttpMethod, HttpStatus, type ClientWebSocket} from '@rest-vir/api';
import {testApi, type FetchTestEndpoint} from '@rest-vir/host';
import {
    implementMultiplayerApi,
    type ImplementedMultiplayerApi,
    type MultiplayerServerState,
} from './multiplayer-api-implementation.js';

type SetupRoomsOutput<Rooms extends string[][]> = {
    [Key in keyof Rooms]: {
        roomId: RoomId;
        roomName: string;
        clients: Record<ArrayElement<Rooms[Key]>, TestClient>;
    };
};

type TestClient = {
    webSocket: ClientWebSocket<typeof multiplayerConnectWebSocket>;
    clientId: ClientId;
    clientName: string;
    clientSecret: string;
};

type MultiplayerApiCallbackParams = Readonly<{
    api: ImplementedMultiplayerApi;
    serverState: MultiplayerServerState;
    fetchEndpoint: FetchTestEndpoint<ImplementedMultiplayerApi>;
    server: Awaited<ReturnType<typeof testApi<ImplementedMultiplayerApi>>>['server'];
    createClient: (name: string) => Promise<TestClient>;
    webSocketMessages: Record<
        string,
        DistributedOmit<MultiplayerConnectHostMessage, 'messageId'>[]
    >;
    setupRooms: <const Rooms extends string[][]>(rooms: Rooms) => Promise<SetupRoomsOutput<Rooms>>;
    logs: {
        info: unknown[];
        error: string[];
    };
    closeAllWebSockets: () => Promise<void>;
}>;

function testMultiplayerApi(
    description: string,
    callback: (params: MultiplayerApiCallbackParams) => MaybePromise<void>,
) {
    it(description, async () => {
        const logs = {
            info: [] as unknown[],
            error: [] as string[],
        };

        const {api, serverState} = implementMultiplayerApi({
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
            DistributedOmit<MultiplayerConnectHostMessage, 'messageId'>[]
        > = {};

        async function createClient(
            clientName: string,
        ): ReturnType<MultiplayerApiCallbackParams['createClient']> {
            const webSocket = await connectWebSocket(multiplayerConnectWebSocket, {
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
                clientId: createMultiplayerId.client(),
                clientName,
                clientSecret: randomString(32),
            };

            allClients.push(testClient);

            return testClient;
        }

        async function setupRooms<Rooms extends string[][]>(
            rooms: Rooms,
        ): Promise<SetupRoomsOutput<Rooms>> {
            const roomIds: RoomId[] = [];

            const finishedRooms = await Promise.all(
                rooms.map(
                    async (roomClients, roomIndex): Promise<Values<SetupRoomsOutput<Rooms>>> => {
                        if (roomClients.length) {
                            const roomId = createMultiplayerId.room();
                            roomIds.push(roomId);
                            const roomName = `room-${roomIndex}`;
                            const clients: Record<string, TestClient> = {};

                            await awaitedForEach(roomClients, async (clientName) => {
                                const client = await createClient(clientName);
                                clients[clientName] = client;

                                client.webSocket.send({
                                    messageId: createMultiplayerId.socketMessage(),
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

            await waitUntil.hasKeys(roomIds, async () => {
                return await (
                    await fetchEndpoint(multiplayerRoomsEndpoint, HttpMethod.Get, {
                        searchParams: {
                            gameId: ['test'],
                        },
                    })
                ).json();
            });

            return finishedRooms as SetupRoomsOutput<Rooms>;
        }

        async function closeAllWebSockets(this: void) {
            await Promise.all(allClients.map((client) => client.webSocket.close()));
        }

        const {connectWebSocket, fetchEndpoint, kill, server} = await testApi(api);

        try {
            await callback({
                api,
                serverState,
                createClient,
                setupRooms,
                fetchEndpoint,
                server,
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

describe('multiplayer API', () => {
    testMultiplayerApi(
        'handles endpoint authorization paths',
        async ({api, fetchEndpoint, logs, server}) => {
            assert.deepEquals(
                await (await fetchEndpoint(multiplayerRootEndpoint, HttpMethod.Get)).json(),
                'ok',
            );
            assert.deepEquals(
                await (await fetchEndpoint(multiplayerHealthEndpoint, HttpMethod.Get)).json(),
                'ok',
            );

            assert.strictEquals(
                (
                    await server.inject({
                        method: HttpMethod.Get,
                        url: '/missing',
                    })
                ).statusCode,
                404,
            );

            const hostContextRuntimeParams = {
                api,
                request: {},
                response: {},
                server: {},
            } satisfies Record<string, unknown> as Pick<
                Parameters<typeof api.implementation.createHostContext>[0],
                'api' | 'request' | 'response' | 'server'
            >;

            assert.deepEquals(
                await api.implementation.createHostContext({
                    ...hostContextRuntimeParams,
                    endpointDefinition: undefined,
                    method: HttpMethod.Get,
                    requestData: undefined,
                    requestHeaders: {},
                    searchParams: {},
                    webSocketDefinition: undefined,
                }),
                {
                    reject: {
                        statusCode: HttpStatus.NotFound,
                    },
                },
            );

            assert.deepEquals(
                await api.implementation.createHostContext({
                    ...hostContextRuntimeParams,
                    endpointDefinition: multiplayerRoomsEndpoint,
                    method: HttpMethod.Get,
                    requestData: undefined,
                    requestHeaders: {},
                    searchParams: {},
                    webSocketDefinition: undefined,
                }),
                {
                    reject: {
                        statusCode: HttpStatus.Unauthorized,
                    },
                },
            );
            assert.isTrue(logs.error.includes("Invalid game ID: 'undefined'"));
        },
    );

    it('checks default game configuration and request origins', async () => {
        const logs = {
            info: [] as unknown[],
            error: [] as string[],
        };

        const {api} = implementMultiplayerApi({
            games: {
                default: 'https://allowed.example',
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
        const {server, kill} = await testApi(api);

        try {
            assert.strictEquals(
                (
                    await server.inject({
                        headers: {
                            origin: 'https://allowed.example',
                        },
                        method: HttpMethod.Get,
                        url: '/rooms?gameId=empty',
                    })
                ).statusCode,
                200,
            );
            assert.strictEquals(
                (
                    await server.inject({
                        headers: {
                            origin: 'https://blocked.example',
                        },
                        method: HttpMethod.Get,
                        url: '/rooms?gameId=empty',
                    })
                ).statusCode,
                401,
            );
            assert.isTrue(logs.error.includes("Origin check failed for game: 'empty'"));
        } finally {
            await kill();
        }
    });

    testMultiplayerApi(
        'hosts multiple room connections',
        async ({setupRooms, webSocketMessages, fetchEndpoint, closeAllWebSockets}) => {
            assert.isTrue(
                (await fetchEndpoint(multiplayerHealthEndpoint, HttpMethod.Get)).ok,
                'server health should be okay',
            );
            assert.deepEquals(
                await (
                    await fetchEndpoint(multiplayerRoomsEndpoint, HttpMethod.Get, {
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
                messageId: createMultiplayerId.socketMessage(),
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
                async () => {
                    return await (
                        await fetchEndpoint(multiplayerRoomsEndpoint, HttpMethod.Get, {
                            searchParams: {
                                gameId: ['test'],
                            },
                        })
                    ).json();
                },
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
                async () => {
                    return await (
                        await fetchEndpoint(multiplayerRoomsEndpoint, HttpMethod.Get, {
                            searchParams: {
                                gameId: ['test'],
                            },
                        })
                    ).json();
                },
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
