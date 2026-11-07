import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {defineShape} from 'object-shape-tester';
import {EntityStore} from './entity-store.js';
import {
    createTestStore,
    createTestSuite,
    emptyEntityUpdateParams,
    type TestEntity,
} from './entity-store.mock.js';
import {EntityDestroyEvent} from './entity.js';

function createTestEntities() {
    const suite = createTestSuite();
    const updateLog: string[] = [];
    const contactLog: string[] = [];

    class Named extends suite.defineEntity({
        key: 'Named',
        paramsShape: defineShape({
            name: '',
        }),
    }) {
        public override update() {
            updateLog.push(this.params.name);
            if (this.params.name === 'self-destructing') {
                this.destroy();
            }
        }

        public override contactStart(otherEntity: TestEntity) {
            contactLog.push(`${this.params.name} started ${otherEntity.params.name}`);
        }

        public override contactEnd(otherEntity: TestEntity) {
            contactLog.push(`${this.params.name} ended ${otherEntity.params.name}`);
        }
    }

    class Plain extends suite.defineEntity({
        key: 'Plain',
    }) {}

    return {
        suite,
        updateLog,
        contactLog,
        Named,
        Plain,
    };
}

describe(EntityStore.name, () => {
    it('steps entities and the world, removing destroyed entities', async () => {
        const {Named, updateLog} = createTestEntities();
        const store = createTestStore({
            stepDuration: {
                milliseconds: 20,
            },
        });
        const destroyedEarly = await store.addEntity(Named, {
            params: {
                name: 'destroyed early',
            },
        });
        await store.addEntity(Named, {
            params: {
                name: 'self-destructing',
            },
        });
        const kept = await store.addEntity(Named, {
            params: {
                name: 'kept',
            },
        });
        destroyedEarly.destroy();

        await store.updateAllEntities(emptyEntityUpdateParams);

        assert.deepEquals(
            {
                updateLog,
                remaining: [...store.currentEntityInstances],
                stepSeconds: store.physicsWorld.stepSeconds,
                keptStepCount: kept.physics.stepCount,
                bodyCount: store.physicsWorld.bodies.size,
                detachedEntityIds: store.detachedEntityIds,
                hasStepTime: store.lastStepTime != undefined,
            },
            {
                updateLog: [
                    'self-destructing',
                    'kept',
                ],
                remaining: [
                    kept,
                ],
                stepSeconds: [
                    0.02,
                ],
                keptStepCount: 1,
                bodyCount: 1,
                detachedEntityIds: [
                    1,
                    2,
                ],
                hasStepTime: true,
            },
        );
    });

    it('calls contact hooks on both entities, skipping missing or destroyed ones', async () => {
        const {Named, contactLog} = createTestEntities();
        const store = createTestStore();
        const first = await store.addEntity(Named, {
            params: {
                name: 'first',
            },
        });
        const second = await store.addEntity(Named, {
            params: {
                name: 'second',
            },
        });
        const destroyed = await store.addEntity(Named, {
            params: {
                name: 'destroyed',
            },
        });
        store.physicsWorld.queuedContacts = {
            started: [
                [
                    first.entityId,
                    second.entityId,
                ],
                [
                    first.entityId,
                    999,
                ],
                [
                    first.entityId,
                    destroyed.entityId,
                ],
                [
                    destroyed.entityId,
                    first.entityId,
                ],
            ],
            ended: [
                [
                    second.entityId,
                    first.entityId,
                ],
            ],
        };
        store.physicsWorld.step = (stepSeconds) => {
            destroyed.destroy();
            return Object.getPrototypeOf(store.physicsWorld).step.call(
                store.physicsWorld,
                stepSeconds,
            );
        };

        await store.updateAllEntities(emptyEntityUpdateParams);

        assert.deepEquals(contactLog, [
            'first started second',
            'second started first',
            'second ended first',
            'first ended second',
        ]);
    });

    it('places views with progress since the last step', async () => {
        const {Plain} = createTestEntities();
        const store = createTestStore({
            stepDuration: {
                milliseconds: 100,
            },
        });
        const entity = await store.addEntity(Plain);
        const destroyed = await store.addEntity(Plain);
        destroyed.destroy();

        await store.renderAllEntities(emptyEntityUpdateParams);
        store.lastStepTime = performance.now() + 1000;
        await store.renderAllEntities(emptyEntityUpdateParams);
        store.lastStepTime = performance.now() - 1000;
        await store.renderAllEntities(emptyEntityUpdateParams);

        assert.deepEquals(store.placedViews, [
            {
                entityId: entity.entityId,
                progress: 1,
            },
            {
                entityId: entity.entityId,
                progress: 0,
            },
            {
                entityId: entity.entityId,
                progress: 1,
            },
        ]);
    });

    it('defaults to 120 steps per second', () => {
        const store = createTestStore();

        assert.strictEquals(store.stepMs, 1000 / 120);
    });

    it('registers, snapshots, hashes, and restores entities', async () => {
        const {Named, Plain} = createTestEntities();
        const store = createTestStore({
            preregisteredEntities: [
                Named,
            ],
        });
        store.registerEntities({
            entities: [
                Plain,
            ],
        });
        await store.addEntity(Named, {
            params: {
                name: 'moved',
            },
            x: 5,
        });
        await store.addEntity(Plain);
        const destroyed = await store.addEntity(Plain);
        destroyed.destroy();

        const snapshot = store.createSnapshot();
        const hash = store.hashEntities();
        const restoredStore = createTestStore();
        restoredStore.registerEntities({
            entities: [
                Named,
                Plain,
            ],
        });
        restoredStore.lastStepTime = 1;
        await restoredStore.loadSnapshot(snapshot);

        assert.deepEquals(
            {
                snapshot,
                registeredKeys: Object.keys(store.entityKeyConstructorMap),
                hashesMatch: restoredStore.hashEntities() === hash,
                resetCount: restoredStore.physicsWorld.resetCount,
                lastStepTime: restoredStore.lastStepTime as number | undefined,
                namedCount: restoredStore.getEntities(Named).size,
            },
            {
                snapshot: [
                    {
                        entityKey: 'Named',
                        serializedParams: JSON.stringify({
                            name: 'moved',
                        }),
                        body: {
                            x: 5,
                        },
                    },
                    {
                        entityKey: 'Plain',
                        serializedParams: undefined,
                        body: {
                            x: 0,
                        },
                    },
                ],
                registeredKeys: [
                    'Named',
                    'Plain',
                ],
                hashesMatch: true,
                resetCount: 1,
                lastStepTime: undefined,
                namedCount: 1,
            },
        );
    });

    it('clears previous registrations', () => {
        const {Named, Plain} = createTestEntities();
        const store = createTestStore({
            preregisteredEntities: [
                Named,
            ],
        });
        store.registerEntities({
            entities: [
                Plain,
            ],
            clearPreviousRegistrations: true,
        });

        assert.deepEquals(Object.keys(store.entityKeyConstructorMap), [
            'Plain',
        ]);
    });

    it('rejects invalid snapshots before destroying anything', async () => {
        const {Plain} = createTestEntities();
        const store = createTestStore();
        await store.addEntity(Plain);

        await assert.throws(
            store.loadSnapshot([
                {
                    entityKey: 'Plain',
                    body: {
                        x: 'wrong',
                    },
                } as any,
            ]),
            {
                matchMessage: 'Invalid entity snapshot entry at index 0',
            },
        );
        await assert.throws(store.loadSnapshot({} as any), {
            matchMessage: 'Entity snapshot must be an array',
        });
        await assert.throws(
            store.deserializeEntity({
                entityKey: 'Missing',
                body: {
                    x: 0,
                },
            }),
            {
                matchMessage: "No entity registered for key 'Missing'",
            },
        );

        assert.isLengthExactly([...store.currentEntityInstances], 1);
    });

    it('destroys all entities while staying usable', async () => {
        const {Plain} = createTestEntities();
        const store = createTestStore();
        const destroyEvents: EntityDestroyEvent[] = [];
        store.listenTarget.listen(EntityDestroyEvent, (event) => {
            destroyEvents.push(event);
        });
        const entity = await store.addEntity(Plain);

        store.destroyAllEntities();
        await store.addEntity(Plain);

        assert.deepEquals(
            {
                destroyEventCount: destroyEvents.length,
                entityCount: store.currentEntityInstances.size,
                viewDestroyCount: entity.viewDestroyCount,
            },
            {
                destroyEventCount: 1,
                entityCount: 1,
                viewDestroyCount: 1,
            },
        );
    });

    it('destroys its world and rejects use after being destroyed', async () => {
        const {Plain} = createTestEntities();
        const store = createTestStore();
        const entity = await store.addEntity(Plain);

        store.destroy();

        assert.isTrue(entity.isDestroyed);
        assert.isTrue(store.physicsWorld.isDestroyed);
        assert.throws(() => store.destroy(), {
            matchMessage: 'Entity store is already destroyed.',
        });
        await assert.throws(store.addEntity(Plain), {
            matchMessage: 'Cannot operate on a destroyed entity store.',
        });
    });
});
