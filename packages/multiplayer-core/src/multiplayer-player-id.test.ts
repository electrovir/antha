import {applyBrand} from '@augment-vir/common';
import {describe, itCases} from '@augment-vir/test';
import type {ClientId} from './multiplayer-id.js';
import {
    createMultiplayerPlayerId,
    extractMultiplayerPlayerIdParts,
    type MultiplayerPlayerId,
} from './multiplayer-player-id.js';

describe(createMultiplayerPlayerId.name, () => {
    itCases(createMultiplayerPlayerId, [
        {
            it: 'combines a client id and local player slot',
            input: {
                clientId: applyBrand<ClientId>('c_test'),
                playerPosition: '2',
            },
            expect: applyBrand<MultiplayerPlayerId>('c_test:2'),
        },
        {
            it: 'rejects separators in player slots',
            input: {
                clientId: applyBrand<ClientId>('c_test'),
                playerPosition: '2:extra',
            },
            throws: {
                matchConstructor: Error,
            },
        },
    ]);
});

describe(extractMultiplayerPlayerIdParts.name, () => {
    itCases(extractMultiplayerPlayerIdParts, [
        {
            it: 'extracts the client id and local player slot',
            input: {
                playerId: applyBrand<MultiplayerPlayerId>('c_test:2'),
            },
            expect: {
                clientId: applyBrand<ClientId>('c_test'),
                playerPosition: '2',
            },
        },
        {
            it: 'rejects malformed player ids',
            input: {
                playerId: applyBrand<MultiplayerPlayerId>('c_test:2:extra'),
            },
            throws: {
                matchConstructor: Error,
            },
        },
    ]);
});
