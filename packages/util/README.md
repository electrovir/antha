# @antha/util

This package provides small game dev focused utilities that are made for use with the [Antha game engine](https://www.npmjs.com/package/@antha/engine) but are mostly useful even outside of it. This package includes (amongst other things), the following:

-   stabilized, seeded random functions
-   stabilized Math operations through rounding

## Install

```sh
npm i @antha/util
```

## Usage

<!-- example-link: src/readme-examples/generating-stable-randomness.example.ts -->

```TypeScript
import {createStableRandom, StableMath, stableRandomInteger} from '@antha/util';

const random = createStableRandom('game-seed');
const enemyType = stableRandomInteger({
    random,
    min: 1,
    max: 3,
});
const angle = StableMath.degreesToRadians(90);
```
