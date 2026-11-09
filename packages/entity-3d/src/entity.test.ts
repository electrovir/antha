import {BodyType} from '@antha/entity-core';
import {Container3D} from '@antha/graphics-3d';
import {assert} from '@augment-vir/assert';
import {awaitedForEach, createArray} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {createAnthaEntity3dSuite} from './antha-entity-3d.mod.js';
import {createTestStore, emptyEntityUpdateParams} from './entity-store-3d.mock.js';
import {type ViewCreation3d} from './entity.js';
import {ShapeType, type EntityPhysicsDefinition} from './physics.js';

const ballPhysics = {
    type: BodyType.Dynamic,
    shapes: [
        {
            type: ShapeType.Sphere,
            radius: 1,
        },
    ],
} as const satisfies EntityPhysicsDefinition;

async function createBallStore() {
    const suite = createAnthaEntity3dSuite();

    class Ball extends suite.defineEntity({
        key: 'Ball',
        physics: ballPhysics,
    }) {
        public override createView(): ViewCreation3d {
            return {
                view: new Container3D(),
            };
        }
    }

    return {
        store: await createTestStore(suite),
        Ball,
    };
}

describe('BaseEntity3d', () => {
    it('adds its view to the scene at the body transform and destroys it with the entity', async () => {
        const {store, Ball} = await createBallStore();

        const emptyRootChildCount = store.view3d.root.children.length;
        const ball = await store.addEntity(Ball, {
            position: {
                x: 1,
                y: 2,
                z: 3,
            },
        });
        const view = ball.view;
        const placement = {
            isInScene: view.parent === store.view3d.root,
            position: {
                x: view.position.x,
                y: view.position.y,
                z: view.position.z,
            },
        };
        ball.immediatelyDestroy();

        assert.deepEquals(
            {
                placement,
                isDestroyed: view.destroyed,
                addedRootChildren: store.view3d.root.children.length - emptyRootChildCount,
            },
            {
                placement: {
                    isInScene: true,
                    position: {
                        x: 1,
                        y: 2,
                        z: 3,
                    },
                },
                isDestroyed: true,
                addedRootChildren: 0,
            },
        );
        store.destroy();
    });

    it('takes the view out of the scene without destroying it when removed', async () => {
        const {store, Ball} = await createBallStore();

        const ball = await store.addEntity(Ball);
        store.removeEntity(ball);

        assert.deepEquals(
            {
                isInScene: !!ball.view.parent,
                isDestroyed: ball.view.destroyed,
            },
            {
                isInScene: false,
                isDestroyed: false,
            },
        );
        store.destroy();
    });

    it('creates a hidden view outside the scene when createView returns no view', async () => {
        const suite = createAnthaEntity3dSuite();
        const store = await createTestStore(suite);

        class Logic extends suite.defineLogicEntity({
            key: 'Logic',
        }) {}

        const logic = await store.addEntity(Logic);

        assert.deepEquals(
            {
                isVisible: logic.view.visible,
                hasParent: !!logic.view.parent,
            },
            {
                isVisible: false,
                hasParent: false,
            },
        );
        store.destroy();
    });

    it('collides entities that leave the contact hooks unimplemented', async () => {
        const suite = createAnthaEntity3dSuite();
        const store = await createTestStore(suite);

        class Quiet extends suite.defineEntity({
            key: 'Quiet',
            physics: ballPhysics,
            touchesSelf: true,
        }) {}

        await store.addEntity(Quiet, {
            velocity: {
                x: 10,
                y: 0,
                z: 0,
            },
        });
        const other = await store.addEntity(Quiet, {
            position: {
                x: 4,
                y: 0,
                z: 0,
            },
        });
        await awaitedForEach(
            createArray(60, () => undefined),
            async () => {
                await store.updateAllEntities(emptyEntityUpdateParams);
            },
        );
        const pushedX = other.physics.getPosition().x;
        other.physics.setPosition({
            x: 100,
            y: 0,
            z: 0,
        });
        await store.updateAllEntities(emptyEntityUpdateParams);

        assert.isAbove(pushedX, 4);
        store.destroy();
    });
});
