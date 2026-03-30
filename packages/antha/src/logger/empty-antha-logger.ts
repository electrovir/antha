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
 * A pre-built {@link AnthaLogger} that simply logs everything to the browser's console. This is the
 * default logger in `AnthaEngine`.
 *
 * @category Logger
 */
export const emptyAnthaLogger: AnthaLogger = {
    ...baseEmptyAnthaLogger,
    if() {
        return baseEmptyAnthaLogger;
    },
};
