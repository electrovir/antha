import {assert} from '@augment-vir/assert';
import {DeferredPromise} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {createTimeoutSignal, rejectOnAbort} from './connection-timeout.js';

describe(createTimeoutSignal.name, () => {
    it('returns undefined without a timeout', () => {
        assert.isUndefined(createTimeoutSignal(undefined));
    });

    it('aborts once the timeout elapses', async () => {
        const abortSignal = createTimeoutSignal({
            milliseconds: 10,
        });

        assert.isDefined(abortSignal);
        assert.isFalse(abortSignal.aborted);
        await assert.throws(() => rejectOnAbort(new DeferredPromise<void>().promise, abortSignal));
        assert.isTrue(abortSignal.aborted);
    });
});

describe(rejectOnAbort.name, () => {
    it('passes through results without a signal', async () => {
        assert.strictEquals(await rejectOnAbort(Promise.resolve('value'), undefined), 'value');
    });

    it('passes through results and errors before an abort', async () => {
        const abortController = new AbortController();

        assert.strictEquals(
            await rejectOnAbort(Promise.resolve('value'), abortController.signal),
            'value',
        );
        await assert.throws(
            () => rejectOnAbort(Promise.reject(new Error('original')), abortController.signal),
            {
                matchMessage: 'original',
            },
        );
    });

    it('rejects when already aborted', async () => {
        await assert.throws(
            () => rejectOnAbort(Promise.resolve(), AbortSignal.abort(new Error('aborted'))),
            {
                matchMessage: 'aborted',
            },
        );
    });

    it('rejects when aborted while waiting', async () => {
        const abortController = new AbortController();
        const pending = rejectOnAbort(new DeferredPromise<void>().promise, abortController.signal);

        abortController.abort(new Error('aborted later'));

        await assert.throws(() => pending, {
            matchMessage: 'aborted later',
        });
    });
});
