import {handleError, sendLog} from 'sentry-vir';
import {type AnthaLogger, type BaseAnthaLogger} from './antha-logger.js';
import {baseEmptyAnthaLogger} from './empty-antha-logger.js';

const baseSentryAnthaLogger: BaseAnthaLogger = {
    error(message, context) {
        handleError(message, context);
    },
    info(message, context) {
        sendLog.info(message, context);
    },
    warning(message, context) {
        sendLog.warning(message, context);
    },
};

/**
 * A pre-built {@link AnthaLogger} that sends logs to Sentry. Note that `initSentry` from
 * `sentry-vir` must be called elsewhere for these logs to actually make it to sentry.
 *
 * @category Logger
 */
export const sentryAnthaLogger: AnthaLogger = {
    ...baseSentryAnthaLogger,
    if(condition) {
        if (condition) {
            return baseSentryAnthaLogger;
        } else {
            return baseEmptyAnthaLogger;
        }
    },
};
