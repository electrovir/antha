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
} from '../index.js';

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
