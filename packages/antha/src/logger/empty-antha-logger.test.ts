import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {baseEmptyAnthaLogger, emptyAnthaLogger} from './empty-antha-logger.js';

describe('emptyAnthaLogger', () => {
    it('has no-op error', () => {
        emptyAnthaLogger.error('should do nothing');
    });

    it('has no-op info', () => {
        emptyAnthaLogger.info('should do nothing');
    });

    it('has no-op warning', () => {
        emptyAnthaLogger.warning('should do nothing');
    });

    it('if always returns the base empty logger', () => {
        assert.strictEquals(emptyAnthaLogger.if(true), baseEmptyAnthaLogger);
        assert.strictEquals(emptyAnthaLogger.if(false), baseEmptyAnthaLogger);
    });
});
