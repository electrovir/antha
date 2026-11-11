import {BodyType} from '@antha/entity-core';
import {Container3D} from '@antha/graphics-3d';
import {assert, assertWrap} from '@augment-vir/assert';
import {awaitedBlockingMap, awaitedForEach, createArray} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {createAnthaEntity3dSuite} from './antha-entity-3d.mod.js';
import {EntityStore3d} from './entity-store-3d.js';
import {createTestStore, emptyEntityUpdateParams} from './entity-store-3d.mock.js';
import {type ViewCreation3d} from './entity.js';
import {JointType, ShapeType, type JointDefinition3d} from './physics.js';

describe(EntityStore3d.name, () => {
    it('places views blended between the last two steps', async () => {
        const suite = createAnthaEntity3dSuite();
        const store = await createTestStore(suite);

        class Mover extends suite.defineEntity({
            key: 'Mover',
            physics: {
                type: BodyType.Kinematic,
            },
        }) {
            public override createView(): ViewCreation3d {
                return {
                    view: new Container3D(),
                };
            }
        }

        const mover = await store.addEntity(Mover);
        mover.physics.previousTransform = {
            position: {
                x: 0,
                y: 0,
                z: 0,
            },
            rotation: {
                x: 0,
                y: 0,
                z: 0,
                w: 1,
            },
        };
        /** A quarter turn around y. */
        mover.physics.currentTransform = {
            position: {
                x: 2,
                y: 4,
                z: 6,
            },
            rotation: {
                x: 0,
                y: Math.SQRT1_2,
                z: 0,
                w: Math.SQRT1_2,
            },
        };
        store.lastStepTime = performance.now() - store.stepMs / 2;
        await store.renderAllEntities(emptyEntityUpdateParams);
        const {position, quaternion} = mover.view;

        const progress = position.x / 2;
        /** A quaternion around y turns by twice the arc cosine of `w`. */
        const angle = (2 * Math.acos(quaternion.w) * 180) / Math.PI;

        assert.deepEquals(
            {
                isBetweenSteps: progress > 0 && progress < 1,
                position: [
                    position.y,
                    position.z,
                ].map((value) => Math.round((value / progress) * 100) / 100),
                angleMatchesPosition: Math.abs(angle - progress * 90) < 0.5,
            },
            {
                isBetweenSteps: true,
                position: [
                    4,
                    6,
                ],
                angleMatchesPosition: true,
            },
        );
        store.destroy();
    });

    it('loads a snapshot with joints into another store', async () => {
        const suite = createAnthaEntity3dSuite();
        const store = await createTestStore(suite);

        class Ball extends suite.defineEntity({
            key: 'Ball',
            physics: {
                type: BodyType.Dynamic,
                shapes: [
                    {
                        type: ShapeType.Sphere,
                        radius: 1,
                    },
                ],
            },
        }) {}

        const ball = await store.addEntity(Ball, {
            position: {
                x: 1,
                y: 2,
                z: 3,
            },
            velocity: {
                x: 4,
                y: 0,
                z: 0,
            },
            angularVelocity: {
                x: 0,
                y: 1,
                z: 0,
            },
        });
        const otherBall = await store.addEntity(Ball);
        const jointDefinition = {
            type: JointType.Spherical,
            frameB: {
                position: {
                    x: 1,
                    y: 2,
                    z: 3,
                },
                rotation: {
                    x: 0,
                    y: 0,
                    z: 0,
                    w: 1,
                },
            },
            enableConeLimit: true,
            coneAngle: 0.5,
        } as const satisfies JointDefinition3d;
        store.addJoint({
            entities: [
                ball,
                otherBall,
            ],
            definition: jointDefinition,
        });
        const otherStore = await createTestStore(suite);
        otherStore.registerEntities({
            entities: [
                Ball,
            ],
        });
        const loaded = await otherStore.loadSnapshot(store.createSnapshot());

        assert.deepEquals(
            {
                states: loaded.entities.map((entity) => entity.physics.getState()),
                joints: loaded.joints.map((joint) => joint.getDefinition()),
            },
            {
                states: [
                    ball.physics.getState(),
                    otherBall.physics.getState(),
                ],
                joints: [
                    jointDefinition,
                ],
            },
        );
        store.destroy();
        otherStore.destroy();
    });

    it('continues the simulation exactly from snapshots with physics states', async () => {
        const suite = createAnthaEntity3dSuite();

        class Ball extends suite.defineEntity({
            key: 'Ball',
            physics: {
                type: BodyType.Dynamic,
                shapes: [
                    {
                        type: ShapeType.Sphere,
                        radius: 1,
                    },
                ],
            },
            touchesSelf: true,
        }) {}

        async function createBallStore() {
            const ballStore = await createTestStore(suite);
            ballStore.registerEntities({
                entities: [
                    Ball,
                ],
            });
            return ballStore;
        }
        async function stepAndRead(steppedStore: EntityStore3d) {
            await awaitedForEach(
                createArray(40, () => undefined),
                async () => {
                    await steppedStore.updateAllEntities(emptyEntityUpdateParams);
                },
            );
            return [...steppedStore.currentEntityInstances].map((entity) => {
                return entity.physics.getPosition();
            });
        }

        const store = await createBallStore();
        const balls = await awaitedBlockingMap(
            [
                0,
                1.9,
                3.8,
                40,
            ],
            async (x, index) => {
                return await store.addEntity(Ball, {
                    position: {
                        x,
                        y: index * 0.3,
                        z: 0,
                    },
                    velocity: {
                        x: index ? 0 : 6,
                        y: 0,
                        z: 0,
                    },
                });
            },
        );
        store.addJoint({
            entities: [
                assertWrap.isDefined(balls[0]),
                assertWrap.isDefined(balls[1]),
            ],
            definition: {
                type: JointType.Distance,
                length: 3,
                enableSpring: true,
                hertz: 1,
            },
        });
        await stepAndRead(store);
        assertWrap.isDefined(balls[3]).destroy();
        const snapshot = store.createSnapshot({
            includePhysicsState: true,
        });

        const expected = await stepAndRead(store);
        const stateStore = await createBallStore();
        await stateStore.loadSnapshot(snapshot);
        const plainStore = await createBallStore();
        await plainStore.loadSnapshot({
            ...snapshot,
            physicsState: undefined,
        });

        assert.deepEquals(
            {
                fromState: await stepAndRead(stateStore),
                plainMatches:
                    JSON.stringify(await stepAndRead(plainStore)) === JSON.stringify(expected),
            },
            {
                fromState: expected,
                plainMatches: false,
            },
        );

        store.destroy();
        stateStore.destroy();
        plainStore.destroy();
    });

    it('releases its scene when destroyed', async () => {
        const store = await createTestStore(createAnthaEntity3dSuite());
        store.destroy();

        assert.isUndefined((store as Partial<EntityStore3d>).view3d);
    });
});
