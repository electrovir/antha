import {type AnthaLogger, type BaseAnthaLogger} from './antha-logger.js';

/**
 * Base log methods of {@link emptyAnthaLogger}.
 *
 * @category Internal
 */
export const baseEmptyAnthaLogger: BaseAnthaLogger = {
    error() {},
    info() {},
    warning() {},
};

/**
 * A pre-built {@link AnthaLogger} that discards every log, including those made through `.if()`.
 * Pass it as the `logger` option to silence `AnthaEngine`, which otherwise defaults to
 * `browserAnthaLogger`.
 *
 * @category Logger
 */
export const emptyAnthaLogger: AnthaLogger = {
    ...baseEmptyAnthaLogger,
    if() {
        return baseEmptyAnthaLogger;
    },
};
