import {defaultMultiplayerApiOrigin, defaultMultiplayerApiPort} from '@antha/multiplayer-core';
import {startMultiplayerServer} from '@antha/multiplayer-server';
import {log} from '@augment-vir/common';
import {AnyOrigin} from '@rest-vir/api';

const multiplayerServer = await startMultiplayerServer({
    backendOrigin: defaultMultiplayerApiOrigin,
    games: {
        default: AnyOrigin,
    },
    host: 'localhost',
    lockPort: true,
    port: defaultMultiplayerApiPort,
});

log.success(
    `Multiplayer lock-step room server running at ${multiplayerServer.host}:${multiplayerServer.port}.`,
);
