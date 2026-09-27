import {ensureError, type PartialWithUndefined} from '@augment-vir/common';
import {type AnyDuration, convertDuration} from 'date-vir';

/**
 * Timeout option accepted by every multiplayer connection method.
 *
 * @category Internal
 */
export type MultiplayerConnectionTimeoutOptions = PartialWithUndefined<{
    /**
     * Max duration for the whole connection attempt. When it elapses, the attempt rejects and every
     * fetch it started is aborted.
     *
     * @default no timeout
     */
    timeout: AnyDuration;
}>;

/**
 * Same as `AbortSignal.timeout` but accepts a duration object. Returns `undefined` when no timeout
 * is given.
 *
 * @category Internal
 */
export function createTimeoutSignal(timeout: Readonly<AnyDuration> | undefined) {
    return timeout
        ? AbortSignal.timeout(
              convertDuration(timeout, {
                  milliseconds: true,
              }).milliseconds,
          )
        : undefined;
}

/**
 * Same as awaiting `promise` but rejects with `abortSignal.reason` as soon as `abortSignal` aborts.
 * The original promise keeps running.
 *
 * @category Internal
 */
export async function rejectOnAbort<T>(promise: Promise<T>, abortSignal: AbortSignal | undefined) {
    if (!abortSignal) {
        return await promise;
    }

    abortSignal.throwIfAborted();

    return await new Promise<T>((resolve, reject) => {
        const listenerCleanup = new AbortController();

        abortSignal.addEventListener(
            'abort',
            () => {
                reject(ensureError(abortSignal.reason));
            },
            {
                once: true,
                signal: listenerCleanup.signal,
            },
        );

        promise.then(resolve, reject).finally(() => {
            listenerCleanup.abort();
        });
    });
}
