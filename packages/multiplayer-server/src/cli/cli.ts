import {assert} from '@augment-vir/assert';
import {ensureErrorAndPrependMessage, log} from '@augment-vir/common';
import {loadConfig} from 'config-vir';
import {atLeastOneDurationShape, convertDuration} from 'date-vir';
import {intersectShape, nullableShape} from 'object-shape-tester';
import {startMultiplayerServer, startMultiplayerServerOptionsShape} from '../start-server.js';

/**
 * Shape definition for {@link MultiplayerServerCliConfig}.
 *
 * @category Internal
 */
const multiplayerServerCliConfigShape = intersectShape(startMultiplayerServerOptionsShape, {
    /**
     * How often to reload the config file.
     *
     * @default `{minutes: 5}`
     */
    configReloadInterval: nullableShape(atLeastOneDurationShape()),
});

/**
 * Config for the CLI.
 *
 * @category CLI
 */
export type MultiplayerServerCliConfig = typeof multiplayerServerCliConfigShape.runtimeType;

/**
 * Load a config file and start the multiplayer server from its options.
 *
 * @category Internal
 */
export async function runMultiplayerServerCli(configFilePath: string) {
    const config = await loadServerCliConfig(configFilePath, {});

    assert.isDefined(config, 'No config loaded.');

    await startMultiplayerServer(config);
}

async function loadServerCliConfig(
    configFilePath: string,
    existingConfig: Partial<MultiplayerServerCliConfig>,
): Promise<MultiplayerServerCliConfig | undefined> {
    try {
        Object.assign(
            existingConfig,
            await loadConfig({
                configPath: configFilePath,
                configShape: multiplayerServerCliConfigShape,
            }),
        );

        return existingConfig as MultiplayerServerCliConfig;
    } catch (error) {
        log.error(ensureErrorAndPrependMessage(error, 'Failed to reload multiplayer config.'));
        return undefined;
    } finally {
        globalThis.setTimeout(
            async () => {
                await loadServerCliConfig(configFilePath, existingConfig);
            },
            convertDuration(
                existingConfig.configReloadInterval || {
                    minutes: 5,
                },
                {
                    milliseconds: true,
                },
            ).milliseconds,
        );
    }
}
