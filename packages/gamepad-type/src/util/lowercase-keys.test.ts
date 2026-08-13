import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {makeObjectKeysLowercase} from './lowercase-keys.js';

describe(makeObjectKeysLowercase.name, () => {
    it('preserves symbol keys', () => {
        const symbolKey = Symbol.for('gamepad-key');

        assert.strictEquals(
            makeObjectKeysLowercase({
                [symbolKey]: 'value',
            })[symbolKey],
            'value',
        );
    });
});
