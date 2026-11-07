# @antha/entity-2d

This package provides a pre-built [Antha game engine](https://www.npmjs.com/package/@antha/engine) mod for creating, updating, and rendering 2D entities with [Box2D](https://box2d.org) physics. It uses the PixiJS application supplied by [`@antha/graphics-2d`](https://npmjs.com/package/@antha/graphics-2d) to display entity views.

## Install

```sh
npm i @antha/entity-2d
```

## Usage

<!-- example-link: src/readme-examples/creating-logic-entity.example.ts -->

```TypeScript
import {createAnthaAssetMod} from '@antha/asset';
import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {createAnthaGraphics2dMod} from '@antha/graphics-2d';
import {type AnthaEntity2dModState, createAnthaEntity2dSuite} from '@antha/entity-2d';

type GameState = AnthaEntity2dModState<{
    hasCreatedScoreEntity: boolean;
}>;

const {defineLogicEntity, updateEntitiesMod} = createAnthaEntity2dSuite<{
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
        createAnthaAssetMod(),
        updateEntitiesMod,
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

## Physics

Every entity has a Box2D body, available as `this.physics`. Set its body type and shapes with `defineEntity`'s `physics` option, either directly or as a function of the entity's params. Entities without `physics` get a static body with no shapes, which only holds a position.

Bodies only collide when one of their classes lists the other in `touches` (or sets `touchesSelf`). An entity suite supports at most 64 classes that touch anything. Colliding entities get `contactStart` and `contactEnd` calls.

`updateEntitiesMod` steps physics at a fixed rate, one `update` call per entity per step, and draws each view between the last two steps so motion stays smooth at any frame rate. Set the step length with `createAnthaEntity2dSuite`'s `physics.stepDuration`. Velocities are in game units per second.

<!-- example-link: src/readme-examples/physics-entities.example.ts -->

```TypeScript
import {createAnthaAssetMod} from '@antha/asset';
import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {createAnthaGraphics2dMod} from '@antha/graphics-2d';
import {defineShape} from 'object-shape-tester';
import {Graphics} from 'pixi.js';
import {
    type AnthaEntity2dModState,
    type BaseEntity2d,
    BodyType,
    createAnthaEntity2dSuite,
    ShapeType,
} from '@antha/entity-2d';

type GameState = AnthaEntity2dModState<{
    hasSpawned: boolean;
}>;

const {defineEntity, updateEntitiesMod} = createAnthaEntity2dSuite<{
    hasSpawned: boolean;
}>({
    physics: {
        stepDuration: {
            seconds: 1 / 60,
        },
    },
});

class FloorEntity extends defineEntity({
    key: 'floor',
    physics: {
        type: BodyType.Static,
        shapes: [
            {
                type: ShapeType.Box,
                width: 800,
                height: 20,
            },
        ],
    },
}) {
    public override createView() {
        return {
            view: new Graphics().rect(-400, -10, 800, 20).fill('#888888'),
        };
    }
}

class BallEntity extends defineEntity({
    key: 'ball',
    paramsShape: defineShape({
        radius: 10,
    }),
    physics(params) {
        return {
            type: BodyType.Dynamic,
            shapes: [
                {
                    type: ShapeType.Circle,
                    radius: params.radius,
                    material: {
                        restitution: 0.5,
                    },
                },
            ],
        };
    },
    /** Balls land on the floor but pass through each other. */
    touches: [
        FloorEntity,
    ],
}) {
    public override createView() {
        return {
            view: new Graphics().circle(0, 0, this.params.radius).fill('#44aaff'),
        };
    }

    public override contactStart(otherEntity: BaseEntity2d) {
        if (otherEntity instanceof FloorEntity) {
            this.view.tint = '#ff4444';
        }
    }
}

const engine = new AnthaEngine<GameState>({
    initState: {
        hasSpawned: false,
    },
    mods: [
        createAnthaGraphics2dMod(),
        createAnthaAssetMod(),
        updateEntitiesMod,
        defineAnthaMod<GameState>({
            modName: 'game-logic',
            async execute({state}) {
                if (!state.entityStore || state.hasSpawned) {
                    return;
                }
                state.hasSpawned = true;

                state.entityStore.physicsWorld.setGravity({
                    x: 0,
                    y: 500,
                });
                await state.entityStore.addEntity(FloorEntity, {
                    position: {
                        x: 400,
                        y: 500,
                    },
                });
                await state.entityStore.addEntity(BallEntity, {
                    params: {
                        radius: 20,
                    },
                    position: {
                        x: 400,
                        y: 100,
                    },
                });
            },
        }),
    ],
});

engine.startLoop();
```

## Cross-origin isolation

Physics runs on multiple threads (set with `physics.threadCount`) when the page is cross-origin isolated, and on the main thread otherwise. Results are identical either way. To make a page cross-origin isolated without server headers, copy `node_modules/@antha/util/dist/cross-origin-isolation-service-worker.js` next to your `index.html` and load it before any other script:

```html
<script type="module" src="cross-origin-isolation-service-worker.js"></script>
```

Skip this if your server already sends cross-origin isolation headers.

### Vite

The threaded physics build starts its threads as ES module workers. Vite bundles workers as IIFE by default, which can't hold those, so set the worker format to `es` in your Vite config:

```ts
import {defineConfig} from 'vite';

export default defineConfig({
    worker: {
        format: 'es',
    },
});
```
