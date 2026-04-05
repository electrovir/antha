import {assert} from '@augment-vir/assert';
import {createUuidV4} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
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
        const rooms: MultiplayerClientRooms = {
            '23f3eef2-682d-4a78-afda-129006318cdf': {
                roomId: '23f3eef2-682d-4a78-afda-129006318cdf',
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
        const roomId = createUuidV4();

        const webSocket = await mockApi.webSockets['/connect'].connect({
            searchParams: {
                gameId: ['test-game'],
            },
        });

        webSocket.send({
            type: MultiplayerWebSocketMessageType.Offer,
            clientId: createUuidV4(),
            clientSecret: 'test-secret',
            roomId,
            roomName: 'New Room',
            roomPassword: '',
            messageId: createUuidV4(),
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

        webSocket.close();
    });
});
