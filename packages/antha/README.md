# antha

An easy to use drop-in package containing the [Antha game engine](https://www.npmjs.com/package/@antha/engine) with a bunch of pre-built mods already setup.

## Included mods

-   [@antha/asset](https://www.npmjs.com/package/@antha/asset): asset loading.
-   [@antha/audio](https://www.npmjs.com/package/@antha/audio): audio loading and playback.
-   [@antha/entity-2d](https://www.npmjs.com/package/@antha/entity-2d): 2D entities, rendering, and collision detection.
-   [@antha/fps](https://www.npmjs.com/package/@antha/fps): on-screen frames-per-second counter.
-   [@antha/graphics-2d](https://www.npmjs.com/package/@antha/graphics-2d): PixiJS application and canvas for rendering 2D graphics.
-   [@antha/input](https://www.npmjs.com/package/@antha/input): keyboard and gamepad input detection and bindings.

## Install

```sh
npm i antha
```

## Usage

<!-- example-link: src/readme-examples/creating-default-engine.example.ts -->

```TypeScript
import {createDefaultAnthaEngine} from 'antha';

const {engine} = createDefaultAnthaEngine();

engine.startLoop();
```
