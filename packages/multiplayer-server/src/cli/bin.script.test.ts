import {
    createMultiplayerApiClient,
    createMultiplayerId,
    multiplayerConnectWebSocket,
    multiplayerHealthEndpoint,
    multiplayerRoomsEndpoint,
    MultiplayerWebSocketMessageType,
    type ClientId,
    type MultiplayerClientRooms,
    type MultiplayerConnectHostMessage,
    type RoomId,
} from '@antha/multiplayer-core';
import {assert, waitUntil} from '@augment-vir/assert';
import {DeferredPromise, randomString} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {type ClientWebSocket} from '@rest-vir/api';
import {spawn, type ChildProcess} from 'node:child_process';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const monoRepoDirPath = resolve(import.meta.dirname, '..', '..', '..', '..');
const packageDirPath = resolve(import.meta.dirname, '..', '..');

type CliTestClient = {
    clientId: ClientId;
    clientSecret: string;
    messages: MultiplayerConnectHostMessage[];
    webSocket: ClientWebSocket<typeof multiplayerConnectWebSocket>;
};

type SendOfferOptions = Pick<CliTestClient, 'clientId' | 'clientSecret' | 'webSocket'> & {
    roomId: RoomId;
    roomName: string;
};

type SendHostPingOptions = SendOfferOptions & {
    clientCount: number;
};

type ConfigContentsOptions = {
    configReloadIntervalSource?: string | undefined;
    games: string;
};

function createConfigContents({
    configReloadIntervalSource = '{milliseconds: 10}',
    games,
}: Readonly<ConfigContentsOptions>) {
    return `
        import {defaultServerLogger} from '@rest-vir/host';

        export default {
            configReloadInterval: ${configReloadIntervalSource},
            games: ${games},
            host: '127.0.0.1',
            lockPort: false,
            logger: defaultServerLogger,
            port: 0,
        };
    `;
}

describe('multiplayer server CLI', () => {
    it('starts a reachable server and manages room clients', async () => {
        const notCommittedDirPath = join(monoRepoDirPath, '.not-committed');
        await mkdir(notCommittedDirPath, {
            recursive: true,
        });
        const tempDirPath = await mkdtemp(join(notCommittedDirPath, 'multiplayer-server-cli-'));
        const configFilePath = join(tempDirPath, 'server-config.mjs');
        const serverReady = new DeferredPromise<{
            childProcess: ChildProcess;
            serverOrigin: string;
        }>();
        const clients: CliTestClient[] = [];

        await writeFile(
            configFilePath,
            createConfigContents({
                games: `{
                    default: '*',
                }`,
            }),
        );

        const cliOutputChunks: string[] = [];
        const cliProcess = spawn(
            process.execPath,
            [
                fileURLToPath(import.meta.resolve('tsx/cli')),
                resolve(packageDirPath, 'src/cli/bin.script.ts'),
                configFilePath,
            ],
            {
                cwd: packageDirPath,
            },
        );

        function handleCliOutput(output: string) {
            cliOutputChunks.push(output);

            const serverOrigin = cliOutputChunks
                .join('')
                .replaceAll(String.fromCodePoint(27), '')
                .replaceAll(/\[[0-9;]*m/g, '')
                .match(/started on (https?:\/\/\S+)/)?.[1];

            if (serverOrigin && !serverReady.isSettled) {
                serverReady.resolve({
                    childProcess: cliProcess,
                    serverOrigin,
                });
            }
        }

        cliProcess.stdout.on('data', (chunk) => handleCliOutput(String(chunk)));
        cliProcess.stderr.on('data', (chunk) => handleCliOutput(String(chunk)));
        cliProcess.once('error', (error) => {
            if (!serverReady.isSettled) {
                serverReady.reject(error);
            }
        });
        cliProcess.once('exit', (exitCode, signal) => {
            if (!serverReady.isSettled) {
                serverReady.reject(
                    new Error(
                        [
                            `The CLI exited before starting the server with code ${exitCode} and signal ${signal}.`,
                            cliOutputChunks.join(''),
                        ].join('\n'),
                    ),
                );
            }
        });

        try {
            const {serverOrigin} = await serverReady.promise;
            const apiClient = await createMultiplayerApiClient({
                backendOrigin: serverOrigin,
                portScanOptions: false,
            });

            async function fetchRooms() {
                const roomsResponse = await apiClient.fetch(multiplayerRoomsEndpoint).GET({
                    searchParams: {
                        gameId: ['test'],
                    },
                });
                assert.isDefined(roomsResponse.Ok);

                return roomsResponse.Ok.responseData;
            }

            async function createClient(): Promise<CliTestClient> {
                const messages: MultiplayerConnectHostMessage[] = [];
                const webSocket = await apiClient.connectWebSocket(multiplayerConnectWebSocket, {
                    searchParams: {
                        gameId: ['test'],
                    },
                    listeners: {
                        message({message}) {
                            messages.push(message);
                        },
                    },
                });
                const client = {
                    clientId: createMultiplayerId.client(),
                    clientSecret: randomString(32),
                    messages,
                    webSocket,
                };

                clients.push(client);
                return client;
            }

            function sendOffer({
                clientId,
                clientSecret,
                roomId,
                roomName,
                webSocket,
            }: SendOfferOptions) {
                webSocket.send({
                    clientId,
                    clientSecret,
                    data: {
                        sdp: 'test',
                        type: MultiplayerWebSocketMessageType.Offer,
                    },
                    messageId: createMultiplayerId.socketMessage(),
                    roomId,
                    roomName,
                    roomPassword: '',
                    type: MultiplayerWebSocketMessageType.Offer,
                });
            }

            function sendHostPing({
                clientCount,
                clientId,
                clientSecret,
                roomId,
                roomName,
                webSocket,
            }: SendHostPingOptions) {
                webSocket.send({
                    clientCount,
                    clientId,
                    clientSecret,
                    messageId: createMultiplayerId.socketMessage(),
                    roomId,
                    roomName,
                    roomPassword: '',
                    type: MultiplayerWebSocketMessageType.HostPing,
                });
            }

            const healthResponse = await apiClient.fetch(multiplayerHealthEndpoint).GET();
            assert.isDefined(healthResponse.Ok);
            assert.strictEquals(healthResponse.Ok.responseData, 'ok');
            assert.deepEquals(await fetchRooms(), {});

            const roomId = createMultiplayerId.room();
            const roomName = 'cli-test-room';
            const host = await createClient();

            sendOffer({
                ...host,
                roomId,
                roomName,
            });

            await waitUntil.deepEquals(
                {
                    [roomId]: {
                        roomName,
                        roomId,
                        clientCount: 1,
                        hasRoomPassword: false,
                    },
                } satisfies MultiplayerClientRooms,
                fetchRooms,
                undefined,
                'The CLI-started server should create a room from the host offer.',
            );
            await waitUntil.isTrue(() => {
                return host.messages.some((message) => {
                    return (
                        message.type === MultiplayerWebSocketMessageType.OfferResult &&
                        message.hostClientId === host.clientId
                    );
                });
            });

            const member = await createClient();
            sendOffer({
                ...member,
                roomId,
                roomName,
            });
            sendHostPing({
                ...host,
                clientCount: 2,
                roomId,
                roomName,
            });

            await waitUntil.deepEquals(
                {
                    [roomId]: {
                        roomName,
                        roomId,
                        clientCount: 2,
                        hasRoomPassword: false,
                    },
                } satisfies MultiplayerClientRooms,
                fetchRooms,
                undefined,
                'The CLI-started server should add a member to the existing room.',
            );
            await waitUntil.isTrue(() => {
                return (
                    member.messages.some((message) => {
                        return (
                            message.type === MultiplayerWebSocketMessageType.OfferResult &&
                            message.hostClientId === host.clientId
                        );
                    }) &&
                    host.messages.some((message) => {
                        return (
                            message.type === MultiplayerWebSocketMessageType.Offer &&
                            message.clientId === member.clientId
                        );
                    })
                );
            });

            await member.webSocket.close();
            sendHostPing({
                ...host,
                clientCount: 1,
                roomId,
                roomName,
            });
            await waitUntil.deepEquals(
                {
                    [roomId]: {
                        roomName,
                        roomId,
                        clientCount: 1,
                        hasRoomPassword: false,
                    },
                } satisfies MultiplayerClientRooms,
                fetchRooms,
                undefined,
                'The CLI-started server should remove a member after its WebSocket closes.',
            );

            await host.webSocket.close();
            await waitUntil.isEmpty(
                fetchRooms,
                undefined,
                'The CLI-started server should remove the room after its last client leaves.',
            );

            await writeFile(configFilePath, 'export default {games: "invalid"};');
            await waitUntil.isTrue(
                () => cliOutputChunks.join('').includes('ShapeMismatchError'),
                undefined,
                'The CLI should log a failed configuration reload.',
            );
            await writeFile(
                configFilePath,
                createConfigContents({
                    games: `{
                        default: 'https://blocked.example',
                    }`,
                }),
            );
            await waitUntil.isTrue(
                async () => {
                    const roomsUrl = new URL(multiplayerRoomsEndpoint.path, serverOrigin);
                    roomsUrl.searchParams.set('gameId', 'test');
                    const roomsResponse = await fetch(roomsUrl, {
                        headers: {
                            origin: 'https://allowed.example',
                        },
                    });

                    return roomsResponse.status === 401;
                },
                undefined,
                'The CLI should apply game changes after a failed configuration reload.',
            );
            await writeFile(
                configFilePath,
                createConfigContents({
                    configReloadIntervalSource: 'null',
                    games: `{
                        default: '*',
                    }`,
                }),
            );
            await waitUntil.isTrue(
                async () => {
                    const roomsUrl = new URL(multiplayerRoomsEndpoint.path, serverOrigin);
                    roomsUrl.searchParams.set('gameId', 'test');
                    const roomsResponse = await fetch(roomsUrl, {
                        headers: {
                            origin: 'https://allowed.example',
                        },
                    });

                    return roomsResponse.status === 200;
                },
                undefined,
                'The CLI should fall back to its default reload interval when none is configured.',
            );
        } finally {
            await Promise.all(clients.map(({webSocket}) => webSocket.close()));

            if (cliProcess.exitCode == undefined && cliProcess.signalCode == undefined) {
                cliProcess.kill('SIGTERM');
                await new Promise((resolveClose) => cliProcess.once('close', resolveClose));
            }

            await rm(tempDirPath, {
                force: true,
                recursive: true,
            });
        }
    });
});
