import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {AnyOrigin} from '@rest-vir/api';
import {startMultiplayerServer} from './start-server.js';

describe(startMultiplayerServer.name, () => {
    it('starts and returns server state', async () => {
        const server = await startMultiplayerServer({
            games: {
                default: AnyOrigin,
            },
            host: 'localhost',
            lockPort: false,
            port: 0,
        });

        try {
            assert.isDefined(server.serverState.roomHandler);
            assert.isDefined(server.serverState.logger);
            assert.isDefined(server.server);
        } finally {
            await server.kill();
        }
    });

    it('starts with a custom backend origin', async () => {
        const server = await startMultiplayerServer({
            backendOrigin: 'http://localhost:4567',
            games: {
                default: AnyOrigin,
            },
            host: 'localhost',
            lockPort: false,
            port: 0,
        });

        try {
            assert.isDefined(server.serverState.roomHandler);
        } finally {
            await server.kill();
        }
    });
});
