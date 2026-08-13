import {defaultMultiplayerApiOrigin} from '@antha/multiplayer-core';
import {omitObjectKeys} from '@augment-vir/common';
import {startApiServer, type StartApiServerOutput} from '@rest-vir/host';
import {defineShape, intersectShape, optionalShape, unionShape} from 'object-shape-tester';
import {
    implementMultiplayerApi,
    multiplayerServerOptionsShape,
} from './multiplayer-api-implementation.js';

/**
 * Shape definition for {@link StartMultiplayerServerOptions}.
 *
 * @category Internal
 */
export const startMultiplayerServerOptionsShape = defineShape(
    intersectShape(multiplayerServerOptionsShape, {
        host: optionalShape('', {
            alsoUndefined: true,
        }),
        lockPort: optionalShape(false, {
            alsoUndefined: true,
        }),
        port: unionShape(0, undefined),
        debug: optionalShape(false, {
            alsoUndefined: true,
        }),
    }),
);

/**
 * Args for {@link startMultiplayerServer}.
 *
 * @category Internal
 */
export type StartMultiplayerServerOptions = typeof startMultiplayerServerOptionsShape.runtimeType;

/**
 * Starts the multiplayer server.
 *
 * @category Main
 */
export async function startMultiplayerServer(options: Readonly<StartMultiplayerServerOptions>) {
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
