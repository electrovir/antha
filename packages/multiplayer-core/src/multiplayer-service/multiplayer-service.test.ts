import {describe, it} from '@augment-vir/test';
import {assertValidShape} from 'object-shape-tester';
import {defineMultiplayerService} from './multiplayer-service.js';

const multiplayerService = defineMultiplayerService('http://localhost:3000');

describe(multiplayerService.serviceName, () => {
    it('allows valid rooms response', () => {
        assertValidShape(
            {
                '23f3eef2-682d-4a78-afda-129006318cdf': {
                    roomId: '23f3eef2-682d-4a78-afda-129006318cdf',
                    roomName: 'Room A',
                    clientCount: 2,
                    hasRoomPassword: false,
                },
            },
            multiplayerService.endpoints['/rooms'].responseDataShape,
            {
                allowExtraKeys: true,
            },
        );
    });
});
