# @antha/graphics-2d

This package provides a pre-built [Antha game engine](https://www.npmjs.com/package/@antha/engine) mod that creates and manages a PixiJS application and its canvas.

## Install

```sh
npm i @antha/graphics-2d
```

## Usage

<!-- example-link: src/readme-examples/drawing-graphics.example.ts -->

```TypeScript
import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {type AnthaGraphics2dModState, createAnthaGraphics2dMod, Graphics} from '@antha/graphics-2d';

type GameState = AnthaGraphics2dModState & {
    hasAddedCircle: boolean;
};

const engine = new AnthaEngine<GameState>({
    initState: {
        hasAddedCircle: false,
    },
    mods: [
        createAnthaGraphics2dMod(),
        defineAnthaMod<GameState>({
            modName: 'game-logic',
            execute({state}) {
                if (!state.pixi?.pixiApplication || state.hasAddedCircle) {
                    return;
                }

                state.hasAddedCircle = true;
                state.pixi.pixiApplication.stage.addChild(
                    new Graphics().circle(0, 0, 20).fill('white'),
                );
            },
        }),
    ],
});

engine.startLoop();
```
