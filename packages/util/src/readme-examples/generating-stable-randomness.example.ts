import {createStableRandom, StableMath, stableRandomInteger} from '../index.js';

const random = createStableRandom('game-seed');
const enemyType = stableRandomInteger({
    random,
    min: 1,
    max: 3,
});
const angle = StableMath.degreesToRadians(90);
