import {assertWrap} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {HttpMethod, HttpStatus} from '@rest-vir/api';
import {assertValidShape} from 'object-shape-tester';
import {createMultiplayerId} from '../multiplayer-id.js';
import {multiplayerApi, multiplayerRoomsEndpoint} from './multiplayer-api.js';

describe(multiplayerApi.apiName, () => {
    it('allows valid rooms response', () => {
        const roomId = createMultiplayerId.room();

        assertValidShape(
            {
                [roomId]: {
                    roomId,
                    roomName: 'Room A',
                    clientCount: 2,
                    hasRoomPassword: false,
                },
            },
            assertWrap.isDefined(
                multiplayerRoomsEndpoint.requests[HttpMethod.Get].responses[HttpStatus.Ok]
                    .responseData,
            ),
            {
                allowExtraKeys: true,
            },
        );
    });
});
