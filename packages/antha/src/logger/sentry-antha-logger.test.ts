import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {baseEmptyAnthaLogger} from './empty-antha-logger.js';
import {sentryAnthaLogger} from './sentry-antha-logger.js';

describe('sentryAnthaLogger', () => {
    it('calls error without throwing', () => {
        sentryAnthaLogger.error('test sentry error');
    });

    it('calls info without throwing', () => {
        sentryAnthaLogger.info('test sentry info');
    });

    it('calls warning without throwing', () => {
        sentryAnthaLogger.warning('test sentry warning');
    });

    it('returns base logger when condition is true', () => {
        const result = sentryAnthaLogger.if(true);
        assert.isDefined(result.error);
        assert.isDefined(result.info);
        assert.isDefined(result.warning);
    });

    it('returns empty logger when condition is false', () => {
        assert.strictEquals(sentryAnthaLogger.if(false), baseEmptyAnthaLogger);
    });
});
