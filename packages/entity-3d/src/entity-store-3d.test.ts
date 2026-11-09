import {BodyType} from '@antha/entity-core';
import {Container3D} from '@antha/graphics-3d';
import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {createAnthaEntity3dSuite} from './antha-entity-3d.mod.js';
import {EntityStore3d} from './entity-store-3d.js';
import {createTestStore, emptyEntityUpdateParams} from './entity-store-3d.mock.js';
import {type ViewCreation3d} from './entity.js';
import {ShapeType} from './physics.js';

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

    it('loads a snapshot into another store', async () => {
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
        const otherStore = await createTestStore(suite);
        otherStore.registerEntities({
            entities: [
                Ball,
            ],
        });
        const loaded = await otherStore.loadSnapshot(store.createSnapshot());

        assert.deepEquals(
            loaded.map((entity) => entity.physics.getState()),
            [
                ball.physics.getState(),
            ],
        );
        store.destroy();
        otherStore.destroy();
    });

    it('releases its scene when destroyed', async () => {
        const store = await createTestStore(createAnthaEntity3dSuite());
        store.destroy();

        assert.isUndefined((store as Partial<EntityStore3d>).view3d);
    });
});
