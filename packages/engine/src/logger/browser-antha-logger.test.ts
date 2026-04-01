import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {browserAnthaLogger} from './browser-antha-logger.js';
import {baseEmptyAnthaLogger} from './empty-antha-logger.js';

describe('browserAnthaLogger', () => {
    it('calls console.error', () => {
        const errors: unknown[] = [];
        const originalError = console.error;
        console.error = (...args: unknown[]) => errors.push(args);
        try {
            browserAnthaLogger.error('test error', {
                context: {
                    key: 'value',
                },
            });
            assert.isLengthExactly(errors, 1);
        } finally {
            console.error = originalError;
        }
    });

    it('calls console.info', () => {
        const infos: unknown[] = [];
        const originalInfo = console.info;
        console.info = (...args: unknown[]) => infos.push(args);
        try {
            browserAnthaLogger.info('test info', {
                context: {
                    key: 'value',
                },
            });
            assert.isLengthExactly(infos, 1);
        } finally {
            console.info = originalInfo;
        }
    });

    it('calls console.warn', () => {
        const warnings: unknown[] = [];
        const originalWarn = console.warn;
        console.warn = (...args: unknown[]) => warnings.push(args);
        try {
            browserAnthaLogger.warning('test warning', {
                context: {
                    key: 'value',
                },
            });
            assert.isLengthExactly(warnings, 1);
        } finally {
            console.warn = originalWarn;
        }
    });

    it('returns base logger when condition is true', () => {
        const result = browserAnthaLogger.if(true);
        assert.isDefined(result.error);
        assert.isDefined(result.info);
        assert.isDefined(result.warning);

        const errors: unknown[] = [];
        const originalError = console.error;
        console.error = (...args: unknown[]) => errors.push(args);
        try {
            result.error('conditional error');
            assert.isLengthExactly(errors, 1);
        } finally {
            console.error = originalError;
        }
    });

    it('returns empty logger when condition is false', () => {
        const result = browserAnthaLogger.if(false);
        assert.strictEquals(result, baseEmptyAnthaLogger);
    });
});
