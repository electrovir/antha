import {type AnthaLogger, type BaseAnthaLogger} from './antha-logger.js';
import {baseEmptyAnthaLogger} from './empty-antha-logger.js';

const baseBrowserAnthaLogger: BaseAnthaLogger = {
    error(message, context) {
        console.error(message, context);
    },
    info(message, context) {
        console.info(message, context);
    },
    warning(message, context) {
        console.warn(message, context);
    },
};

/**
 * A pre-built {@link AnthaLogger} that simply logs everything to the browser's console. This is the
 * default logger in `AnthaEngine`.
 *
 * @category Logger
 */
export const browserAnthaLogger: AnthaLogger = {
    ...baseBrowserAnthaLogger,
    if(condition) {
        if (condition) {
            return baseBrowserAnthaLogger;
        } else {
            return baseEmptyAnthaLogger;
        }
    },
};
