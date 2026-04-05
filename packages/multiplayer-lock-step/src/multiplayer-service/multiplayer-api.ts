import {check} from '@augment-vir/assert';
import {generateApi, mapServiceDevPort} from '@rest-vir/define-service';
import {defineMultiplayerService} from './multiplayer-service.js';

/**
 * The output from {@link createMultiplayerApi}, regardless of what the given `serverOrigin` is.
 *
 * @category Main
 */
export type MultiplayerApi = Awaited<ReturnType<typeof createMultiplayerApi>>;

/**
 * Creates an API for accessing the multiplayer server at the given origin.
 *
 * @category Main
 */
export async function createMultiplayerApi({
    backendOrigin,
    portScanOptions,
}: {
    backendOrigin?: string | undefined;
    /**
     * Set to `undefined` or `false` to disable port scanning. Set to `true` to enable port
     * scanning. Set to an options object to configure port scanning.
     */
    portScanOptions: undefined | Parameters<typeof mapServiceDevPort>[1] | boolean;
}) {
    const initialService = defineMultiplayerService(backendOrigin);

    const service = portScanOptions
        ? await mapServiceDevPort(
              initialService,
              check.isBoolean(portScanOptions) ? undefined : portScanOptions,
          )
        : initialService;

    return generateApi(service);
}
