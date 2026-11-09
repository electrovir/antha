# @antha/entity-3d

This package provides a pre-built [Antha game engine](https://www.npmjs.com/package/@antha/engine) mod for creating, updating, and rendering 3D entities with [Box3D](https://www.npmjs.com/package/box3d.js) physics. It uses the 3D scene supplied by [`@antha/graphics-3d`](https://npmjs.com/package/@antha/graphics-3d) to display entity views.

## Install

`@pixi/3d` is a peer dependency and is still in closed beta, so it isn't on npm. Install the beta tarball you were given first:

```sh
npm i ./pixi-3d-0.1.0-beta.2.tgz
npm i @antha/entity-3d
```

## Physics

Every entity has a Box3D body, available as `this.physics`. Set its body type and shapes with `defineEntity`'s `physics` option, either directly or as a function of the entity's params. Entities without `physics` get a static body with no shapes, which only holds a position. Units are meters, kilograms, and seconds, with y pointing up.

Bodies only collide when one of their classes lists the other in `touches` (or sets `touchesSelf`). An entity suite supports at most 64 classes that touch anything. Colliding entities get `contactStart` and `contactEnd` calls.

`updateEntitiesMod` steps physics at a fixed rate, one `update` call per entity per step, and draws each view between the last two steps so motion stays smooth at any frame rate. Set the step length with `createAnthaEntity3dSuite`'s `physics.stepDuration`.

An entity's view is destroyed with its entity, but its geometry and materials are kept because entities often share them. Override `viewDestroyOptions` when each entity owns its own, as below.

<!-- example-link: src/readme-examples/physics-entities.example.ts -->

```TypeScript
import {createAnthaAssetMod} from '@antha/asset';
import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {createAnthaGraphics2dMod} from '@antha/graphics-2d';
import {
    createAnthaGraphics3dMod,
    CubeGeometry,
    DirectionalLight,
    Material3D,
    Mesh3D,
    SphereGeometry,
} from '@antha/graphics-3d';
import {defineShape} from 'object-shape-tester';
import {
    type AnthaEntity3dModState,
    type BaseEntity3d,
    BodyType,
    createAnthaEntity3dSuite,
    ShapeType,
} from '@antha/entity-3d';

type GameState = AnthaEntity3dModState<{
    hasSpawned: boolean;
}>;

const {defineEntity, updateEntitiesMod} = createAnthaEntity3dSuite<{
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
                width: 10,
                height: 0.5,
                depth: 10,
            },
        ],
    },
}) {
    protected override readonly viewDestroyOptions = {
        children: true,
        geometry: true,
        material: true,
    };

    public override createView() {
        return {
            view: new Mesh3D({
                geometry: new CubeGeometry({
                    width: 10,
                    height: 0.5,
                    depth: 10,
                }),
                material: new Material3D({
                    baseColor: '#888888',
                }),
            }),
        };
    }
}

class BallEntity extends defineEntity({
    key: 'ball',
    paramsShape: defineShape({
        radius: 0.5,
    }),
    physics(params) {
        return {
            type: BodyType.Dynamic,
            shapes: [
                {
                    type: ShapeType.Sphere,
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
    protected override readonly viewDestroyOptions = {
        children: true,
        geometry: true,
        material: true,
    };

    protected readonly material = new Material3D({
        baseColor: '#44aaff',
    });

    public override createView() {
        return {
            view: new Mesh3D({
                geometry: new SphereGeometry({
                    radius: this.params.radius,
                }),
                material: this.material,
            }),
        };
    }

    public override contactStart(otherEntity: BaseEntity3d) {
        if (otherEntity instanceof FloorEntity) {
            this.material.baseColor = '#ff4444';
        }
    }
}

const engine = new AnthaEngine<GameState>({
    initState: {
        hasSpawned: false,
    },
    mods: [
        createAnthaGraphics2dMod(),
        createAnthaGraphics3dMod(),
        createAnthaAssetMod(),
        updateEntitiesMod,
        defineAnthaMod<GameState>({
            modName: 'game-logic',
            async execute({state}) {
                if (!state.entityStore || state.hasSpawned) {
                    return;
                }
                state.hasSpawned = true;

                state.entityStore.view3d.root.addChild(
                    new DirectionalLight({
                        intensity: 3,
                    }),
                );
                state.entityStore.view3d.camera.position.set(0, 3, 10);
                state.entityStore.physicsWorld.setGravity({
                    x: 0,
                    y: -10,
                    z: 0,
                });
                await state.entityStore.addEntity(FloorEntity);
                await state.entityStore.addEntity(BallEntity, {
                    params: {
                        radius: 0.5,
                    },
                    position: {
                        x: 0,
                        y: 5,
                        z: 0,
                    },
                });
            },
        }),
    ],
});

engine.startLoop();
```
