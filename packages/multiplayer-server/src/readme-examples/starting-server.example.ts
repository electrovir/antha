import {AnyOrigin} from '@rest-vir/api';
import {startMultiplayerServer} from '../index.js';

await startMultiplayerServer({
    backendOrigin: 'http://localhost:9348',
    games: {
        default: AnyOrigin,
    },
    host: 'localhost',
    lockPort: true,
    port: 9348,
});
