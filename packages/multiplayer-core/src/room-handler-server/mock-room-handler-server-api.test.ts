import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {createMultiplayerId} from '../multiplayer-id.js';
import {type MultiplayerClientRooms} from '../multiplayer-service/multiplayer-service.js';
import {MultiplayerWebSocketMessageType} from '../webrtc/web-rtc-communication.js';
import {createMockRoomHandlerServerApi} from './mock-room-handler-server-api.js';

describe(createMockRoomHandlerServerApi.name, () => {
    it('returns ok for health endpoint', async () => {
        const mockApi = createMockRoomHandlerServerApi();

        const result = await mockApi.endpoints['/health'].fetch();

        assert.isTrue(result.ok);
        assert.strictEquals(result.data, 'ok');
    });

    it('returns ok for root endpoint', async () => {
        const mockApi = createMockRoomHandlerServerApi();

        const result = await mockApi.endpoints['/'].fetch();

        assert.isTrue(result.ok);
        assert.strictEquals(result.data, 'ok');
    });

    it('returns empty rooms by default', async () => {
        const mockApi = createMockRoomHandlerServerApi();

        const result = await mockApi.endpoints['/rooms'].fetch({
            searchParams: {
                gameId: ['test-game'],
            },
        });

        assert.isTrue(result.ok);
        assert.deepEquals(result.data, {});
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

        const mockApi = createMockRoomHandlerServerApi({
            rooms,
        });

        const result = await mockApi.endpoints['/rooms'].fetch({
            searchParams: {
                gameId: ['test-game'],
            },
        });

        assert.isTrue(result.ok);
        assert.deepEquals(result.data, rooms);
    });

    it('creates a room when a client connects via WebSocket', async () => {
        const mockApi = createMockRoomHandlerServerApi();
        const roomId = createMultiplayerId.room();

        const webSocket = await mockApi.webSockets['/connect'].connect({
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

        const roomsResult = await mockApi.endpoints['/rooms'].fetch({
            searchParams: {
                gameId: ['test-game'],
            },
        });

        assert.isTrue(roomsResult.ok);
        assert.deepEquals(roomsResult.data[roomId], {
            roomId,
            roomName: 'New Room',
            clientCount: 1,
            hasRoomPassword: false,
        });

        await webSocket.close();
    });
});
