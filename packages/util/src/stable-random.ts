import {clamp, SeededRandom, type SeededRandomState} from '@augment-vir/common';
import {StableMath, type StableMathOptions} from './stable-math.js';

export {SeededRandom} from '@augment-vir/common';

/**
 * Create a deterministic pseudo-random generator from a seed.
 *
 * @category Random
 */
export function createStableRandom(seed: string | number) {
    return SeededRandom.fromSeed(seed);
}

/**
 * Recreate a deterministic pseudo-random generator from exported state.
 *
 * @category Random
 */
export function createStableRandomFromState(state: Readonly<SeededRandomState>) {
    return SeededRandom.fromState([
        ...state,
    ]);
}

/**
 * Generate the next deterministic pseudo-random number.
 *
 * @category Random
 */
export function stableRandom(random: Readonly<SeededRandom>) {
    return random.next();
}

/**
 * Generate a deterministic pseudo-random integer between `min` and `max`, inclusive.
 *
 * @category Random
 */
export function stableRandomInteger({
    random,
    min,
    max,
}: Readonly<{
    random: Readonly<SeededRandom>;
    min: number;
    max: number;
}>) {
    const integerMin = Math.ceil(min);
    const integerMax = Math.floor(max);

    return Math.floor(random.next() * (integerMax - integerMin + 1)) + integerMin;
}

/**
 * Generate the next deterministic pseudo-random floating-point number within a range.
 *
 * @category Random
 */
export function stableRandomFloat({
    random,
    min,
    max,
    options,
}: Readonly<{
    random: Readonly<SeededRandom>;
    min: number;
    max: number;
    options?: Readonly<StableMathOptions> | undefined;
}>) {
    return StableMath.round(min + stableRandom(random) * (max - min), options);
}

/**
 * Generate a deterministic pseudo-random boolean at the given percent chance.
 *
 * @category Random
 */
export function stableRandomBoolean({
    random,
    percentLikelyToBeTrue = 50,
}: Readonly<{
    random: Readonly<SeededRandom>;
    percentLikelyToBeTrue?: number | undefined;
}>) {
    return (
        stableRandomInteger({
            random,
            min: 0,
            max: 99,
        }) <
        clamp(Math.floor(percentLikelyToBeTrue), {
            min: 0,
            max: 100,
        })
    );
}
