# @antha/entity-2d

This package provides a pre-built [Antha game engine](https://www.npmjs.com/package/@antha/engine) mod for creating, updating, rendering, and collision-checking 2D entities. It uses the PixiJS application supplied by [`@antha/graphics-2d`](https://npmjs.com/package/@antha/graphics-2d) to display entity views.

## Install

```sh
npm i @antha/entity-2d
```

## Usage

<!-- example-link: src/readme-examples/creating-logic-entity.example.ts -->

```TypeScript
import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {createAnthaGraphics2dMod} from '@antha/graphics-2d';
import {type AnthaEntity2dModState, createAnthaEntityMod2d} from '@antha/entity-2d';

type GameState = AnthaEntity2dModState<{
    hasCreatedScoreEntity: boolean;
}>;

const {defineLogicEntity, mod: entityMod} = createAnthaEntityMod2d<{
    hasCreatedScoreEntity: boolean;
}>();

class ScoreEntity extends defineLogicEntity({
    key: 'score',
    paramsShape: undefined,
}) {
    public override update() {}
}

const engine = new AnthaEngine<GameState>({
    initState: {
        hasCreatedScoreEntity: false,
    },
    mods: [
        createAnthaGraphics2dMod(),
        entityMod,
        defineAnthaMod<GameState>({
            modName: 'game-logic',
            async execute({state}) {
                if (state.entityStore && !state.hasCreatedScoreEntity) {
                    state.hasCreatedScoreEntity = true;
                    await state.entityStore.addEntity(ScoreEntity);
                }
            },
        }),
    ],
});

engine.startLoop();
```
