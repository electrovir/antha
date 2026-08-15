import {createMultiplayerApiClient, createMultiplayerId} from '../index.js';

const roomId = createMultiplayerId.room();
const multiplayerApiClient = await createMultiplayerApiClient({
    backendOrigin: 'http://localhost:9348',
    portScanOptions: false,
});
