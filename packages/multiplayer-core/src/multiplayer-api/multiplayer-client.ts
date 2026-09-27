import {check} from '@augment-vir/assert';
import {findDevServerPort, RestVirClient, type FindPortOptions} from '@rest-vir/api';
import {
    createTimeoutSignal,
    type MultiplayerConnectionTimeoutOptions,
} from './connection-timeout.js';
import {defaultMultiplayerApiOrigin, multiplayerApi} from './multiplayer-api.js';

/**
 * The output from {@link createMultiplayerApiClient}, regardless of what the given `serverOrigin`
 * is.
 *
 * @category Main
 */
export type MultiplayerApiClient = Awaited<ReturnType<typeof createMultiplayerApiClient>>;

/**
 * Creates an API client for accessing the multiplayer server at the given origin.
 *
 * @category Main
 */
export async function createMultiplayerApiClient({
    backendOrigin,
    portScanOptions,
    timeout,
}: {
    backendOrigin?: string | undefined;
    /**
     * Set to `undefined` or `false` to disable port scanning. Set to `true` to enable port
     * scanning. Set to an options object to configure port scanning.
     */
    portScanOptions: undefined | Omit<FindPortOptions, 'startOrigin'> | boolean;
} & MultiplayerConnectionTimeoutOptions) {
    const initialOrigin = backendOrigin || defaultMultiplayerApiOrigin;
    const customPortScanOptions = check.isBoolean(portScanOptions) ? undefined : portScanOptions;
    const abortSignal = createTimeoutSignal(timeout);

    const foundPort = portScanOptions
        ? await findDevServerPort(multiplayerApi, {
              startOrigin: initialOrigin,
              timeout,
              ...customPortScanOptions,
              fetchOverride(url, requestInit, endpoint) {
                  const requestInitWithSignal: RequestInit = {
                      ...requestInit,
                      signal: abortSignal ?? null,
                  };

                  return customPortScanOptions?.fetchOverride
                      ? customPortScanOptions.fetchOverride(url, requestInitWithSignal, endpoint)
                      : globalThis.fetch(url, requestInitWithSignal);
              },
          })
        : undefined;

    return new RestVirClient(multiplayerApi, foundPort?.origin || initialOrigin);
}
