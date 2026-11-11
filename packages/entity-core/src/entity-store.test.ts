import {assert, assertWrap} from '@augment-vir/assert';
import {awaitedForEach} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {defineShape} from 'object-shape-tester';
import {EntityStore} from './entity-store.js';
import {
    createTestStore,
    createTestSuite,
    emptyEntityUpdateParams,
    type TestEntity,
    type TestJoint,
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

        public override contactHit(otherEntity: TestEntity, hit: string) {
            contactLog.push(`${this.params.name} hit ${otherEntity.params.name} ${hit}`);
        }

        public override sensorStart(visitorEntity: TestEntity) {
            contactLog.push(`${this.params.name} sensed ${visitorEntity.params.name}`);
        }

        public override sensorEnd(visitorEntity: TestEntity) {
            contactLog.push(`${this.params.name} lost ${visitorEntity.params.name}`);
        }

        public override jointStrained(joint: TestJoint, otherEntity: TestEntity) {
            contactLog.push(
                `${this.params.name} strained ${otherEntity.params.name} ${joint.definition.stiffness}`,
            );
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
        const strainedJoint = store.addJoint({
            entities: [
                first,
                second,
            ],
            definition: {
                stiffness: 3,
            },
        });
        const destroyedJoint = store.addJoint({
            entities: [
                first,
                destroyed,
            ],
            definition: {
                stiffness: 4,
            },
        });
        store.physicsWorld.queuedContacts = {
            strainedJoints: [
                strainedJoint.jointId,
                destroyedJoint.jointId,
                999,
            ],
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
            sensorStarted: [
                [
                    first.entityId,
                    second.entityId,
                ],
                [
                    first.entityId,
                    destroyed.entityId,
                ],
            ],
            sensorEnded: [
                [
                    second.entityId,
                    first.entityId,
                ],
                [
                    999,
                    first.entityId,
                ],
            ],
            hits: [
                {
                    entityId: first.entityId,
                    otherEntityId: second.entityId,
                    hit: 'hard',
                },
                {
                    entityId: first.entityId,
                    otherEntityId: destroyed.entityId,
                    hit: 'missed',
                },
                {
                    entityId: 999,
                    otherEntityId: first.entityId,
                    hit: 'missed',
                },
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
            'first sensed second',
            'second lost first',
            'first hit second hard',
            'first strained second 3',
            'second strained first 3',
        ]);
        assert.deepEquals(
            [
                store.getEntity(first.entityId),
                store.getEntity(destroyed.entityId),
                store.getEntity(999),
            ],
            [
                first,
                undefined,
                undefined,
            ],
        );
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

    it('registers, snapshots, hashes, and restores entities and joints', async () => {
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
        const moved = await store.addEntity(Named, {
            params: {
                name: 'moved',
            },
            x: 5,
        });
        const plain = await store.addEntity(Plain);
        const destroyed = await store.addEntity(Plain);
        store.addJoint({
            entities: [
                plain,
                moved,
            ],
            definition: {
                stiffness: 2,
            },
        });
        store.addJoint({
            entities: [
                moved,
                destroyed,
            ],
            definition: {
                stiffness: 5,
            },
        });
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
        const restored = await restoredStore.loadSnapshot(snapshot);

        assert.deepEquals(
            {
                snapshot,
                registeredKeys: Object.keys(store.entityKeyConstructorMap),
                hashesMatch: restoredStore.hashEntities() === hash,
                resetCount: restoredStore.physicsWorld.resetCount,
                lastStepTime: restoredStore.lastStepTime as number | undefined,
                namedCount: restoredStore.getEntities(Named).size,
                restoredJointBodies: restored.joints.map((joint) => {
                    return joint.bodies.map((body) => body.x);
                }),
            },
            {
                snapshot: {
                    entities: [
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
                    joints: [
                        {
                            entityIndexes: [
                                1,
                                0,
                            ],
                            definition: {
                                stiffness: 2,
                            },
                        },
                    ],
                },
                registeredKeys: [
                    'Named',
                    'Plain',
                ],
                hashesMatch: true,
                resetCount: 1,
                lastStepTime: undefined,
                namedCount: 1,
                restoredJointBodies: [
                    [
                        0,
                        5,
                    ],
                ],
            },
        );
    });

    it('saves and restores physics states with snapshots', async () => {
        const {Plain} = createTestEntities();
        const store = createTestStore();
        const kept = await store.addEntity(Plain);
        const joined = await store.addEntity(Plain);
        const destroyed = await store.addEntity(Plain);
        store.addJoint({
            entities: [
                kept,
                joined,
            ],
            definition: {
                stiffness: 1,
            },
        });
        destroyed.destroy();

        const snapshot = store.createSnapshot({
            includePhysicsState: true,
        });
        const restoredStore = createTestStore({
            preregisteredEntities: [
                Plain,
            ],
        });
        const restored = await restoredStore.loadSnapshot(snapshot);
        const [restoredState] = restoredStore.physicsWorld.restoredStates;

        assert.deepEquals(
            {
                state: [...assertWrap.isDefined(snapshot.physicsState)],
                hasStateWithoutOption: 'physicsState' in store.createSnapshot(),
                restoredBodyIndexes: restoredState?.bodies.map((body) => {
                    return restored.entities.findIndex((entity) => entity.physics === body);
                }),
                restoredJointIndexes: restoredState?.joints.map((joint) => {
                    return restored.joints.indexOf(joint);
                }),
            },
            {
                state: [
                    2,
                    1,
                    1,
                ],
                hasStateWithoutOption: false,
                restoredBodyIndexes: [
                    0,
                    1,
                ],
                restoredJointIndexes: [
                    0,
                ],
            },
        );
    });

    it('rejects invalid physics states before destroying anything', async () => {
        const {Plain} = createTestEntities();
        const store = createTestStore();
        await store.addEntity(Plain);

        await assert.throws(
            store.loadSnapshot({
                entities: [],
                joints: [],
                physicsState: [] as any,
            }),
            {
                matchMessage: 'physicsState must be a Uint8Array',
            },
        );
        await assert.throws(
            store.loadSnapshot({
                entities: [],
                joints: [],
                physicsState: new Uint8Array([
                    1,
                    0,
                    0,
                ]),
            }),
            {
                matchMessage: 'Test physics state does not match',
            },
        );
        assert.deepEquals(
            {
                entityCount: store.currentEntityInstances.size,
                resetCount: store.physicsWorld.resetCount,
            },
            {
                entityCount: 1,
                resetCount: 0,
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
            store.loadSnapshot({
                entities: [
                    {
                        entityKey: 'Plain',
                        body: {
                            x: 'wrong',
                        },
                    } as any,
                ],
                joints: [],
            }),
            {
                matchMessage: 'Invalid entity snapshot entry at index 0',
            },
        );
        await assert.throws(store.loadSnapshot([] as any), {
            matchMessage: 'Entity snapshot must be an object',
        });
        await assert.throws(store.loadSnapshot({} as any), {
            matchMessage: 'Entity snapshot entities must be an array',
        });
        await assert.throws(
            store.loadSnapshot({
                entities: [],
            } as any),
            {
                matchMessage: 'Entity snapshot joints must be an array',
            },
        );
        const validEntity = {
            entityKey: 'Plain',
            body: {
                x: 0,
            },
        };
        await assert.throws(
            store.loadSnapshot({
                entities: [
                    validEntity,
                ],
                joints: [
                    {
                        entityIndexes: [
                            0,
                            0,
                        ],
                        definition: {
                            stiffness: 'wrong',
                        },
                    } as any,
                ],
            }),
            {
                matchMessage: 'Invalid joint snapshot entry at index 0',
            },
        );
        await awaitedForEach(
            [
                [
                    0,
                    0,
                ],
                [
                    0,
                    1,
                    2,
                ],
                [
                    0,
                    2,
                ],
                [
                    0,
                    -1,
                ],
                [
                    0,
                    0.5,
                ],
            ],
            async (entityIndexes) => {
                await assert.throws(
                    store.loadSnapshot({
                        entities: [
                            validEntity,
                            validEntity,
                        ],
                        joints: [
                            {
                                entityIndexes: entityIndexes as [
                                    number,
                                    number,
                                ],
                                definition: {
                                    stiffness: 1,
                                },
                            },
                        ],
                    }),
                    {
                        matchMessage: 'entityIndexes must be two different indexes into entities',
                    },
                );
            },
        );
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

    it('adds and removes joints', async () => {
        const {Plain} = createTestEntities();
        const store = createTestStore();
        const first = await store.addEntity(Plain);
        const second = await store.addEntity(Plain);
        const third = await store.addEntity(Plain);
        const outsider = await createTestStore().addEntity(Plain);
        const definition = {
            stiffness: 1,
        };
        const removed = store.addJoint({
            entities: [
                first,
                second,
            ],
            definition,
        });
        store.addJoint({
            entities: [
                second,
                third,
            ],
            definition,
        });
        const kept = store.addJoint({
            entities: [
                first,
                third,
            ],
            definition,
        });

        store.removeJoint(removed);
        store.removeJoint(removed);
        store.removeEntity(second);

        assert.deepEquals(
            [...store.physicsWorld.joints],
            [
                kept,
            ],
        );
        assert.throws(
            () => {
                store.addJoint({
                    entities: [
                        first,
                        first,
                    ],
                    definition,
                });
            },
            {
                matchMessage: 'Cannot join an entity to itself.',
            },
        );
        assert.throws(
            () => {
                store.addJoint({
                    entities: [
                        first,
                        outsider,
                    ],
                    definition,
                });
            },
            {
                matchMessage: 'it is not in this store',
            },
        );
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
