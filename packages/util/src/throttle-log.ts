import {
    defaultLoggerOptions,
    emptyLog,
    getOrSetFromMap,
    log,
    LogColorKey,
    mapEnumToObject,
    mergeDefinedProperties,
    toLogString,
    type Logger,
    type LoggerLogs,
    type LoggerOptions,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {
    calculateRelativeDate,
    getNowInUtcTimezone,
    isDateAfter,
    type AnyDuration,
    type FullDate,
    type UtcTimezone,
} from 'date-vir';
import {FuzzyIndex, type FuzzyIndexKey} from 'fuzzy-vir';

/** @category Internal */
export type ThrottleLogCacheEntry = {
    intervalCount: number;
    intervalStartAt: FullDate<UtcTimezone>;
};

/** @category Internal */
export const throttleLogCache = new Map<FuzzyIndexKey, ThrottleLogCacheEntry>();

/** @category Internal */
export const fuzzyLogIndex = new FuzzyIndex({
    onEvict(logKey) {
        throttleLogCache.delete(logKey);
    },
});

/** @category Internal */
export type ThrottleLogOptions = {
    disableThrottling: boolean;
    throttleInterval: AnyDuration;
};

/** @category Internal */
export const defaultThrottleLogOptions: ThrottleLogOptions = {
    disableThrottling: false,
    throttleInterval: {
        seconds: 5,
    },
};

/** @category Internal */
export enum ThrottleLogTransitionKind {
    None = 'none',
    Started = 'started',
    Ended = 'ended',
}

/** @category Internal */
export type ThrottleLogTransition =
    | {
          kind: ThrottleLogTransitionKind.None;
      }
    | {
          kind: ThrottleLogTransitionKind.Started;
      }
    | {
          kind: ThrottleLogTransitionKind.Ended;
          suppressedCount: number;
      };

/**
 * Output from {@link shouldThrottleLog}.
 *
 * @category Internal
 */
export type ThrottleLogResult = {
    shouldThrottle: boolean;
    logKey: string | undefined;
    transition: ThrottleLogTransition;
};

/** @category Internal */
export function clearThrottleLogCache() {
    throttleLogCache.clear();
    fuzzyLogIndex.destroy();
}

const throttleLogStringOptions: LoggerOptions = {
    ...defaultLoggerOptions,
    omitColors: true,
};

/** @category Internal */
export function shouldThrottleLog(
    logMessage: string,
    throttleOptions: Readonly<PartialWithUndefined<ThrottleLogOptions>> = {},
): ThrottleLogResult {
    const options = mergeDefinedProperties(defaultThrottleLogOptions, throttleOptions);

    if (options.disableThrottling) {
        return {
            shouldThrottle: false,
            logKey: undefined,
            transition: {
                kind: ThrottleLogTransitionKind.None,
            },
        };
    }

    const logKey = fuzzyLogIndex.insert(logMessage);
    const now = getNowInUtcTimezone();
    const logThrottleData = getOrSetFromMap(throttleLogCache, logKey, () => {
        return {
            intervalCount: 0,
            intervalStartAt: now,
        };
    });
    const transitionCandidates: ThrottleLogTransition[] = [];

    if (
        isDateAfter({
            fullDate: now,
            relativeTo: calculateRelativeDate(
                logThrottleData.intervalStartAt,
                options.throttleInterval,
            ),
        })
    ) {
        const suppressedCount = logThrottleData.intervalCount - 1;

        if (suppressedCount > 0) {
            transitionCandidates.push({
                kind: ThrottleLogTransitionKind.Ended,
                suppressedCount,
            });
        }

        logThrottleData.intervalStartAt = now;
        logThrottleData.intervalCount = 0;
    }

    logThrottleData.intervalCount++;

    const shouldThrottle = logThrottleData.intervalCount > 1;

    if (shouldThrottle && logThrottleData.intervalCount === 2) {
        transitionCandidates.push({
            kind: ThrottleLogTransitionKind.Started,
        });
    }

    return {
        shouldThrottle,
        logKey,
        transition: transitionCandidates[0] || {
            kind: ThrottleLogTransitionKind.None,
        },
    };
}

/**
 * Create a custom throttle logger.
 *
 * @category Internal
 */
export function createThrottleLog({
    logger = log,
    ...options
}: Readonly<
    PartialWithUndefined<
        {
            logger: Logger;
        } & ThrottleLogOptions
    >
> = {}): Logger {
    const throttledLoggerLogs: LoggerLogs = mapEnumToObject(LogColorKey, (colorKey) => {
        return (...args: ReadonlyArray<unknown>) => {
            const throttleResult = shouldThrottleLog(createThrottleLogMessage(args), options);

            if (!throttleResult.shouldThrottle) {
                logger[colorKey](...args);
            }
        };
    });

    return {
        ...throttledLoggerLogs,
        if(condition) {
            return condition ? throttledLoggerLogs : emptyLog;
        },
    };
}

/**
 * A logger that throttles logs so you can put logs in every frame without blowing up your console.
 *
 * @category Util
 */
export const throttleLog = createThrottleLog();

function createThrottleLogMessage(args: ReadonlyArray<unknown>) {
    return toLogString({
        args,
        colorKey: LogColorKey.Plain,
        options: throttleLogStringOptions,
    }).text;
}
