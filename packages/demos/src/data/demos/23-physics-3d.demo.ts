/* eslint-disable sonarjs/pseudo-random */
import {createAnthaAssetMod} from '@antha/asset';
import {AnthaEngine, SkipExecution, type AnthaMod} from '@antha/engine';
import {
    BodyType,
    createAnthaEntity3dSuite,
    ShapeType,
    type AnthaEntity3dModState,
    type EntityStore3d,
} from '@antha/entity-3d';
import {createAnthaFpsMod} from '@antha/fps';
import {createAnthaGraphics2dMod} from '@antha/graphics-2d';
import {
    createAnthaGraphics3dMod,
    CubeGeometry,
    DirectionalLight,
    Material3D,
    Mesh3D,
    SphereGeometry,
} from '@antha/graphics-3d';
import {assertWrap} from '@augment-vir/assert';
import {randomInteger} from '@augment-vir/common';
import {createUtcFullDate} from 'date-vir';
import {css, html, listen} from 'element-vir';
import {defineShape} from 'object-shape-tester';
import {ViraButton, ViraColorVariant} from 'vira';
import {type AnthaDemo} from '../demo.js';

type Physics3dGameState = {
    hasSetUpScene: boolean;
};

const {defineEntity, updateEntitiesMod} = createAnthaEntity3dSuite<Physics3dGameState>();

const floorSize = 12;
const floorThickness = 0.5;

class FloorEntity extends defineEntity({
    key: 'Floor',
    physics: {
        type: BodyType.Static,
        shapes: [
            {
                type: ShapeType.Box,
                width: floorSize,
                height: floorThickness,
                depth: floorSize,
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
                    width: floorSize,
                    height: floorThickness,
                    depth: floorSize,
                }),
                material: new Material3D({
                    baseColor: '#777777',
                }),
            }),
        };
    }
}

const bodyParamsShape = defineShape({
    size: 1,
    color: '',
});

/** Bodies that fall off the floor are removed once they fall below this height. */
const removalHeight = -20;

class BallEntity extends defineEntity({
    key: 'Ball',
    paramsShape: bodyParamsShape,
    physics(params) {
        return {
            type: BodyType.Dynamic,
            shapes: [
                {
                    type: ShapeType.Sphere,
                    radius: params.size / 2,
                    material: {
                        restitution: 0.6,
                    },
                },
            ],
        };
    },
    touchesSelf: true,
    touches: [
        FloorEntity,
    ],
}) {
    protected override readonly viewDestroyOptions = {
        children: true,
        geometry: true,
        material: true,
    };

    public override createView() {
        return {
            view: new Mesh3D({
                geometry: new SphereGeometry({
                    radius: this.params.size / 2,
                }),
                material: new Material3D({
                    baseColor: this.params.color,
                }),
            }),
        };
    }
}

class CrateEntity extends defineEntity({
    key: 'Crate',
    paramsShape: bodyParamsShape,
    physics(params) {
        return {
            type: BodyType.Dynamic,
            shapes: [
                {
                    type: ShapeType.Box,
                    width: params.size,
                    height: params.size,
                    depth: params.size,
                },
            ],
        };
    },
    touchesSelf: true,
    touches: [
        FloorEntity,
        BallEntity,
    ],
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
                    width: this.params.size,
                    height: this.params.size,
                    depth: this.params.size,
                }),
                material: new Material3D({
                    baseColor: this.params.color,
                }),
            }),
        };
    }
}

const colors = [
    '#44aaff',
    '#ff5555',
    '#ffcc33',
    '#55dd77',
    '#cc66ff',
];

/** A random number within `range / 2` of zero. */
function randomSpread(range: number) {
    return range * (0.5 - Math.random());
}

async function dropBody(
    entityStore: EntityStore3d,
    entityClass: typeof BallEntity | typeof CrateEntity,
) {
    const spread = floorSize / 2 - 1;

    await entityStore.addEntity(entityClass, {
        params: {
            size:
                randomInteger({
                    min: 5,
                    max: 12,
                }) / 10,
            color: assertWrap.isDefined(
                colors[
                    randomInteger({
                        min: 0,
                        max: colors.length - 1,
                    })
                ],
            ),
        },
        position: {
            x: randomSpread(spread * 2),
            y: 8,
            z: randomSpread(spread * 2),
        },
        angularVelocity: {
            x: randomSpread(4),
            y: randomSpread(4),
            z: randomSpread(4),
        },
    });
}

const physics3dGameMod: AnthaMod<AnthaEntity3dModState<Physics3dGameState>> = {
    modName: 'physics-3d-game',
    async execute({state}) {
        /** Save off for type guarding purposes. */
        const entityStore = state.entityStore;
        if (!entityStore) {
            return SkipExecution;
        }

        if (!state.hasSetUpScene) {
            state.hasSetUpScene = true;

            const sun = new DirectionalLight({
                intensity: 3,
            });
            sun.rotation.set(-Math.PI / 3, Math.PI / 6, 0);
            entityStore.view3d.root.addChild(sun);
            entityStore.view3d.camera.position.set(0, 9, 16);
            entityStore.view3d.camera.lookAt({
                x: 0,
                y: 1,
                z: 0,
            });
            entityStore.physicsWorld.setGravity({
                x: 0,
                y: -9.8,
                z: 0,
            });

            await entityStore.addEntity(FloorEntity);
            await dropBody(entityStore, BallEntity);
            await dropBody(entityStore, CrateEntity);
        }

        entityStore.currentEntityInstances.forEach((entity) => {
            if (entity.physics.getPosition().y < removalHeight) {
                entity.destroy();
            }
        });
        const droppedCount = [...entityStore.currentEntityInstances].filter((entity) => {
            return !(entity instanceof FloorEntity);
        }).length;

        return html`
            <div
                style=${css`
                    position: absolute;
                    top: 8px;
                    right: 8px;
                    display: flex;
                    gap: 8px;
                    align-items: center;
                    color: white;
                    font-family: monospace;
                `}
            >
                <${ViraButton.assign({
                    text: 'Add ball',
                })}
                    ${listen('click', async () => {
                        await dropBody(entityStore, BallEntity);
                    })}
                ></${ViraButton}>
                <${ViraButton.assign({
                    text: 'Add crate',
                })}
                    ${listen('click', async () => {
                        await dropBody(entityStore, CrateEntity);
                    })}
                ></${ViraButton}>
                <${ViraButton.assign({
                    text: 'Clear',
                    color: ViraColorVariant.Neutral,
                })}
                    ${listen('click', () => {
                        entityStore.currentEntityInstances.forEach((entity) => {
                            if (!(entity instanceof FloorEntity)) {
                                entity.destroy();
                            }
                        });
                    })}
                ></${ViraButton}>
                <span>Bodies: ${droppedCount}</span>
            </div>
        `;
    },
};

export const physics3dDemo: AnthaDemo = {
    demoName: '3D Physics',
    demoPathId: 'physics-3d',
    demoSortDate: createUtcFullDate('2026-11-08T00:00:00.000Z'),
    engine() {
        return new AnthaEngine({
            mods: [
                createAnthaGraphics2dMod({
                    extraCanvasStyles: css`
                        border: 2px solid red;
                    `,
                }),
                createAnthaGraphics3dMod(),
                createAnthaFpsMod({
                    debugFps: true,
                }),
                createAnthaAssetMod(),
                updateEntitiesMod,
                physics3dGameMod,
            ],
        });
    },
};
