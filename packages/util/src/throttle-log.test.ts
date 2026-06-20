import {assert} from '@augment-vir/assert';
import {createArrayLogger, type Logger} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {
    clearThrottleLogCache,
    createThrottleLog,
    shouldThrottleLog,
    throttleLog,
    ThrottleLogTransitionKind,
} from './throttle-log.js';

describe(shouldThrottleLog.name, () => {
    it('allows the first log in an interval', () => {
        clearThrottleLogCache();

        assert.deepEquals(shouldThrottleLog('Failed to load room.'), {
            shouldThrottle: false,
            logKey: 'Failed to load room.',
            transition: {
                kind: ThrottleLogTransitionKind.None,
            },
        });
    });

    it('skips cache lookup when disabled', () => {
        clearThrottleLogCache();

        assert.deepEquals(
            shouldThrottleLog('Failed to load room.', {
                disableThrottling: true,
            }),
            {
                shouldThrottle: false,
                logKey: undefined,
                transition: {
                    kind: ThrottleLogTransitionKind.None,
                },
            },
        );
    });

    it('starts throttling on the second matching log in an interval', () => {
        clearThrottleLogCache();

        const firstResult = shouldThrottleLog('Failed to load room 123.');
        const secondResult = shouldThrottleLog('Failed to load room 456.');

        assert.deepEquals(
            {
                firstResult,
                secondResult: {
                    shouldThrottle: secondResult.shouldThrottle,
                    logKey: secondResult.logKey,
                    transition: secondResult.transition,
                },
            },
            {
                firstResult: {
                    shouldThrottle: false,
                    logKey: 'Failed to load room 123.',
                    transition: {
                        kind: ThrottleLogTransitionKind.None,
                    },
                },
                secondResult: {
                    shouldThrottle: true,
                    logKey: 'Failed to load room 123.',
                    transition: {
                        kind: ThrottleLogTransitionKind.Started,
                    },
                },
            },
        );
    });

    it('reports suppressed logs after the interval resets', () => {
        clearThrottleLogCache();

        const firstOptions = {
            throttleInterval: {
                hours: 1,
            },
        };

        shouldThrottleLog('Failed to load room.', firstOptions);
        shouldThrottleLog('Failed to load room.', firstOptions);
        shouldThrottleLog('Failed to load room.', firstOptions);

        const result = shouldThrottleLog('Failed to load room.', {
            ...firstOptions,
            throttleInterval: {
                milliseconds: -1,
            },
        });

        assert.deepEquals(
            {
                shouldThrottle: result.shouldThrottle,
                logKey: result.logKey,
                transition: result.transition,
            },
            {
                shouldThrottle: false,
                logKey: 'Failed to load room.',
                transition: {
                    kind: ThrottleLogTransitionKind.Ended,
                    suppressedCount: 2,
                },
            },
        );
    });
});

describe('throttleLog', () => {
    it('implements Logger', () => {
        const throttledLog: Logger = throttleLog;

        assert.isDefined(throttledLog);
    });

    it('throttles matching logs across log methods', () => {
        clearThrottleLogCache();

        const arrayLogger = createArrayLogger();
        const throttledLog = createThrottleLog({
            logger: arrayLogger.log,
        });

        throttledLog.info('Failed to load room.');
        throttledLog.warning('Failed to load room.');
        throttledLog.error('Different failure.');

        assert.deepEquals(arrayLogger.logs, {
            stdout: [
                'Failed to load room.',
            ],
            stderr: [
                'Different failure.',
            ],
        });
    });

    it('honors conditional logging without throttling skipped logs', () => {
        clearThrottleLogCache();

        const arrayLogger = createArrayLogger();
        const throttledLog = createThrottleLog({
            logger: arrayLogger.log,
        });

        throttledLog.if(false).info('Failed to load room.');
        throttledLog.warning('Failed to load room.');

        assert.deepEquals(arrayLogger.logs, {
            stdout: [],
            stderr: [
                'Failed to load room.',
            ],
        });
    });
});
