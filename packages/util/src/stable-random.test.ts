import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {
    createStableRandom,
    createStableRandomFromState,
    stableRandom,
    stableRandomBoolean,
    stableRandomInteger,
} from './stable-random.js';

describe('stable random', () => {
    it('repeats output for the same seed', () => {
        const firstRandom = createStableRandom('test seed');
        const secondRandom = createStableRandom('test seed');

        assert.deepEquals(
            [
                stableRandom(firstRandom),
                stableRandom(firstRandom),
                stableRandom(firstRandom),
            ],
            [
                stableRandom(secondRandom),
                stableRandom(secondRandom),
                stableRandom(secondRandom),
            ],
        );
    });

    it('restores output from exported state', () => {
        const random = createStableRandom('state seed');
        stableRandom(random);
        const clonedRandom = createStableRandomFromState(random.exportState());

        assert.strictEquals(stableRandom(random), stableRandom(clonedRandom));
    });

    it('generates stable inclusive integers', () => {
        const random = createStableRandom('integer seed');

        assert.deepEquals(
            [
                stableRandomInteger({
                    random,
                    min: 1,
                    max: 3,
                }),
                stableRandomInteger({
                    random,
                    min: 1,
                    max: 3,
                }),
                stableRandomInteger({
                    random,
                    min: 1,
                    max: 3,
                }),
            ],
            [
                2,
                3,
                2,
            ],
        );
    });

    it('generates stable booleans', () => {
        const random = createStableRandom('boolean seed');

        assert.deepEquals(
            [
                stableRandomBoolean({
                    random,
                }),
                stableRandomBoolean({
                    random,
                }),
                stableRandomBoolean({
                    random,
                }),
            ],
            [
                true,
                false,
                false,
            ],
        );
    });

    it('clamps stable boolean percentages', () => {
        assert.isFalse(
            stableRandomBoolean({
                random: createStableRandom('never true'),
                percentLikelyToBeTrue: 0,
            }),
        );
        assert.isFalse(
            stableRandomBoolean({
                random: createStableRandom('negative never true'),
                percentLikelyToBeTrue: -1,
            }),
        );
        assert.isTrue(
            stableRandomBoolean({
                random: createStableRandom('always true'),
                percentLikelyToBeTrue: 100,
            }),
        );
        assert.isTrue(
            stableRandomBoolean({
                random: createStableRandom('above always true'),
                percentLikelyToBeTrue: 101,
            }),
        );
    });

    it('floors stable boolean percentages', () => {
        const random = createStableRandom('floor seed');
        const expectedRandom = createStableRandom('floor seed');

        assert.strictEquals(
            stableRandomBoolean({
                random,
                percentLikelyToBeTrue: 59.67,
            }),
            stableRandomInteger({
                random: expectedRandom,
                min: 0,
                max: 99,
            }) < 59,
        );
    });
});
