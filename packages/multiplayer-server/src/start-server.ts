import {defaultMultiplayerApiOrigin} from '@antha/multiplayer-core';
import {omitObjectKeys, type SetRequired} from '@augment-vir/common';
import {startApiServer, type RunApiUserOptions, type StartApiServerOutput} from '@rest-vir/host';
import {
    implementMultiplayerApi,
    type MultiplayerServerOptions,
} from './multiplayer-api-implementation.js';

/**
 * Starts the multiplayer server.
 *
 * @category Main
 */
export async function startMultiplayerServer(
    options: Readonly<
        MultiplayerServerOptions &
            SetRequired<Pick<RunApiUserOptions, 'host' | 'lockPort' | 'port'>, 'port'> & {
                debug?: boolean | undefined;
            }
    >,
) {
    const {api, serverState} = implementMultiplayerApi(options);
    const startOutput = (await startApiServer(api, {
        ...omitObjectKeys(options, [
            'backendOrigin',
            'debug',
            'games',
            'logger',
        ]),
        externalOrigin: options.backendOrigin || defaultMultiplayerApiOrigin,
        /** This server cannot currently be distributed. */
        workerCount: 1,
    })) as Required<Omit<StartApiServerOutput, 'cluster' | 'worker'>>;

    return {
        ...startOutput,
        serverState,
    };
}
