import {loadConfig} from 'config-vir';
import {startMultiplayerServer, startMultiplayerServerOptionsShape} from '../start-server.js';

/**
 * Load a config file and start the multiplayer server from its options.
 *
 * @category Internal
 */
export async function runMultiplayerServerCli(configFilePath: string) {
    const config = await loadConfig({
        configPath: configFilePath,
        configShape: startMultiplayerServerOptionsShape,
    });

    await startMultiplayerServer(config);
}
