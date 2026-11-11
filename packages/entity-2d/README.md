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

Shapes with `isSensor` report entities that enter and leave them through `sensorStart` and `sensorEnd` instead of colliding. Set `enableHitEvents` on a body to get `contactHit` calls for fast collisions, and set a shape's `oneWayDirection` for platforms that can be jumped up through. Connect two entities with `entityStore.addJoint`. Each joint gets a `jointStrained` call when it pulls harder than its force or torque threshold.

`this.physics` also handles runtime materials (`setMaterial`) and kinematic movement to a target pose (`setTargetTransform`). `entityStore.physicsWorld` handles queries (`castRay`, `castShape`, `overlapBox`, `overlapShape`), explosions (`explode`), and character movement (`castMover`, `collideMover`, `solveMoverPlanes`).

Materials take `rollingResistance` to slow rolling circles and capsules, and `tangentSpeed` to move whatever touches them along their surface, like a conveyor belt. `entityStore.physicsWorld.setHooks` installs `customFilter` and `preSolve` callbacks, which only run for shapes with `enableCustomFiltering` or `enablePreSolve`, and `mixFriction` and `mixRestitution` callbacks for combining materials.

`entityStore.createSnapshot({includePhysicsState: true})` also saves Box2D's internal state, so loading the snapshot resumes the exact same simulation. Box2D marks this format as experimental, so saved states may not load in a newer Box2D version.

`entityStore.physicsWorld.drawDebug` returns whatever you turn on, such as shapes, joints, contacts, and bounding boxes, as plain polygons, segments, and points to draw however you like. `getProfile`, `getCounters`, `getAwakeBodyCount`, and `getStateHash` report on the simulation. `startRecording` and `stopRecording` capture every step, and `PhysicsReplay2d.create(recording)` plays a recording back, steps it, and seeks to any frame. `PhysicsReplay2d.replaysExactly(recording)` checks that a recording replays to the same state.

`PhysicsGeometry2d.create()` gives shape math without a world: mass, bounds, point and ray tests, shape casts, distances, time of impact, and contacts between single shapes. Its `createTree` makes a `DynamicTree2d`, a bounding-box tree for your own broad-phase queries.

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

## Dev

<!-- cspell:word emsdk -->

`src/box2d/box2d.mjs` is Box2D compiled to WebAssembly, together with the C bindings in `src/box2d/bindings.c`. Rebuild it whenever `bindings.c` changes:

1. Install [emsdk](https://emscripten.org/docs/getting_started/downloads.html) into `~/emsdk`.
2. Put emcc on your path: `export PATH="$HOME/emsdk:$HOME/emsdk/upstream/emscripten:$PATH"`
3. From the monorepo root, run `cd packages/scripts && npm run build:physics`. This rebuilds both Box2D and Box3D.

The build clones the Box2D source into `node_modules/.cache/antha-physics/` and reuses it on later runs.

To upgrade Box2D, change its `tag` and `commit` in `packages/scripts/src/build-physics.script.ts`, then rebuild. Physics states saved with the old version may not load in the new one.
