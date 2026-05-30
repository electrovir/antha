import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {
    multiplayerConnectWebSocket,
    multiplayerHealthEndpoint,
    multiplayerRoomsEndpoint,
    multiplayerRootEndpoint,
    type MultiplayerClientRooms,
} from '../multiplayer-api/multiplayer-api.js';
import {createMultiplayerId} from '../multiplayer-id.js';
import {MultiplayerWebSocketMessageType} from '../webrtc/web-rtc-communication.js';
import {createMockRoomHandlerServerApiClient} from './mock-room-handler-server-api-client.js';

describe(createMockRoomHandlerServerApiClient.name, () => {
    it('returns ok for health endpoint', async () => {
        const mockApiClient = createMockRoomHandlerServerApiClient();

        const result = await mockApiClient.fetch(multiplayerHealthEndpoint).GET();

        assert.isDefined(result.Ok);
        assert.strictEquals(result.Ok.responseData, 'ok');
    });

    it('returns ok for root endpoint', async () => {
        const mockApiClient = createMockRoomHandlerServerApiClient();

        const result = await mockApiClient.fetch(multiplayerRootEndpoint).GET();

        assert.isDefined(result.Ok);
        assert.strictEquals(result.Ok.responseData, 'ok');
    });

    it('returns empty rooms by default', async () => {
        const mockApiClient = createMockRoomHandlerServerApiClient();

        const result = await mockApiClient.fetch(multiplayerRoomsEndpoint).GET({
            searchParams: {
                gameId: ['test-game'],
            },
        });

        assert.isDefined(result.Ok);
        assert.deepEquals(result.Ok.responseData, {});
    });

    it('returns configured rooms', async () => {
        const roomId = createMultiplayerId.room();
        const rooms: MultiplayerClientRooms = {
            [roomId]: {
                roomId,
                roomName: 'Test Room',
                clientCount: 1,
                hasRoomPassword: false,
            },
        };

        const mockApiClient = createMockRoomHandlerServerApiClient({
            rooms,
        });

        const result = await mockApiClient.fetch(multiplayerRoomsEndpoint).GET({
            searchParams: {
                gameId: ['test-game'],
            },
        });

        assert.isDefined(result.Ok);
        assert.deepEquals(result.Ok.responseData, rooms);
    });

    it('creates a room when a client connects via WebSocket', async () => {
        const mockApiClient = createMockRoomHandlerServerApiClient();
        const roomId = createMultiplayerId.room();

        const webSocket = await mockApiClient.connectWebSocket(multiplayerConnectWebSocket, {
            searchParams: {
                gameId: ['test-game'],
            },
        });

        webSocket.send({
            type: MultiplayerWebSocketMessageType.Offer,
            clientId: createMultiplayerId.client(),
            clientSecret: 'test-secret',
            roomId,
            roomName: 'New Room',
            roomPassword: '',
            messageId: createMultiplayerId.socketMessage(),
            data: {
                type: MultiplayerWebSocketMessageType.Offer,
                sdp: 'mock-sdp',
            },
        });

        const roomsResult = await mockApiClient.fetch(multiplayerRoomsEndpoint).GET({
            searchParams: {
                gameId: ['test-game'],
            },
        });

        assert.isDefined(roomsResult.Ok);
        assert.deepEquals(roomsResult.Ok.responseData[roomId], {
            roomId,
            roomName: 'New Room',
            clientCount: 1,
            hasRoomPassword: false,
        });

        await webSocket.close();
    });
});
