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
} from '../index.js';

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
