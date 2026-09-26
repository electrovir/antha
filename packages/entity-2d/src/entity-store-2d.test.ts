import {AssetLoader} from '@antha/asset';
import {
    AnthaEngine,
    ModExecutionTriggerType,
    type ModExecuteParams,
    type ModInstanceId,
} from '@antha/engine';
import {createMockPixi} from '@antha/graphics-2d';
import {assert} from '@augment-vir/assert';
import {applyBrand, awaitedForEach, DeferredPromise, makeWritable} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {Circle} from 'detect-collisions';
import {Graphics} from 'pixi.js';
import {EntityHitboxSystem} from './entity-hitbox-system.js';
import {EntityStore2d, type SerializedEntity2d} from './entity-store-2d.js';
import {createTestStore, createTestSuite} from './entity-store-2d.mock.js';
import {entityPositionParamsShape, type BaseEntity2d, type ViewCreation2d} from './entity.js';

const testEngine = new AnthaEngine();
const emptyEntityUpdateParams = {
    currentTick: 0,
    engine: testEngine,
    executionTrigger: {
        type: ModExecutionTriggerType.Tick,
    },
    trigger: undefined,
    hostElement: document.createElement('div'),
    lastExecution: undefined,
    modInstanceId: applyBrand<ModInstanceId>('entity-test'),
    msSinceLastExecute: 0,
    state: testEngine.state,
    ticksSinceLastExecute: 0,
} satisfies ModExecuteParams;

function createCollisionView(): ViewCreation2d {
    return {
        view: new Graphics().rect(0, 0, 50, 50).fill('blue'),
        hitbox: new Circle(
            {
                x: 0,
                y: 0,
            },
            100,
        ),
    };
}

describe(EntityStore2d.name, () => {
    it('throws when calling updateAllEntities on a destroyed store', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);
        store.destroy();
        await assert.throws(
            () => {
                return store.updateAllEntities(emptyEntityUpdateParams);
            },
            {
                matchMessage: 'Cannot operate on a destroyed entity store.',
            },
        );
    });

    it('throws when rendering with a destroyed store', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);
        store.destroy();

        await assert.throws(
            () => {
                return store.renderAllEntities(emptyEntityUpdateParams);
            },
            {
                matchMessage: 'Cannot operate on a destroyed entity store.',
            },
        );
    });

    it('throws when creating a snapshot of a destroyed store', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);
        store.destroy();

        assert.throws(
            () => {
                return store.createSnapshot();
            },
            {
                matchMessage: 'Cannot operate on a destroyed entity store.',
            },
        );
    });

    it('stops rendering after reaching a destroyed entity', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);
        let renderCount = 0;

        class RenderEntity extends suite.defineLogicEntity({
            key: 'RenderEntity',
            paramsShape: undefined,
        }) {
            public override render(): void {
                renderCount += 1;
            }

            public override update(): void {}
        }

        const firstEntity = await store.addEntity(RenderEntity);
        await store.addEntity(RenderEntity);
        makeWritable(firstEntity).isDestroyed = true;

        await store.renderAllEntities(emptyEntityUpdateParams);

        assert.strictEquals(renderCount, 0);
    });

    it('renders logic entities without a render override', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class BaseLogicEntity extends suite.defineLogicEntity({
            key: 'BaseLogicEntity',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        const entity = await store.addEntity(BaseLogicEntity);
        await store.renderAllEntities(emptyEntityUpdateParams);

        assert.isFalse(entity.isDestroyed);
    });

    it('cleans up entities destroyed outside update cycle', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class TestEntity extends suite.defineLogicEntity({
            key: 'OutsideDestroy',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        const instance = await store.addEntity(TestEntity);
        /** Mark as destroyed outside an update cycle. */
        makeWritable(instance).isDestroyed = true;

        await store.updateAllEntities(emptyEntityUpdateParams);
        assert.strictEquals(store.currentEntityInstances.size, 0);
    });

    it('cleans up entities that destroy themselves during update', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class SelfDestroyer extends suite.defineLogicEntity({
            key: 'SelfDestroyer',
            paramsShape: undefined,
        }) {
            public override update(): void {
                this.destroy();
            }
        }

        await store.addEntity(SelfDestroyer);
        await store.updateAllEntities(emptyEntityUpdateParams);
        assert.strictEquals(store.currentEntityInstances.size, 0);
    });

    it('does not trigger collision callbacks without collidesWith', async () => {
        const suite = createTestSuite();
        let collisionCount = 0;
        let hitboxSearchCount = 0;

        class CountingHitboxSystem extends EntityHitboxSystem {
            public override search(...args: Parameters<EntityHitboxSystem['search']>) {
                hitboxSearchCount += 1;
                return super.search(...args);
            }
        }

        const store = createTestStore(suite, {
            customHitboxSystem: new CountingHitboxSystem(),
        });

        class CollidingEntity extends suite.defineEntity({
            key: 'Colliding',
            paramsShape: undefined,
        }) {
            public override update(): void {}

            public override createView(): ViewCreation2d {
                return createCollisionView();
            }

            public override collide(): void {
                collisionCount += 1;
            }
        }

        const firstEntity = await store.addEntity(CollidingEntity);
        await store.addEntity(CollidingEntity);
        hitboxSearchCount = 0;

        assert.isDefined(firstEntity.hitbox);
        assert.isFalse(store.hitboxSystem.checkOne(firstEntity.hitbox));

        await store.updateAllEntities(emptyEntityUpdateParams);
        assert.deepEquals(
            {
                collisionCount,
                hitboxSearchCount,
            },
            {
                collisionCount: 0,
                hitboxSearchCount: 0,
            },
        );
    });

    it('skips collisions when neither entity targets the other', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);
        let collisionCount = 0;

        class IgnoredEntity extends suite.defineEntity({
            key: 'IgnoredCollisionTarget',
            paramsShape: undefined,
        }) {
            public override update(): void {}

            public override createView(): ViewCreation2d {
                return createCollisionView();
            }
        }

        class FirstEntity extends suite.defineEntity({
            collidesWith: {
                collidesWithOtherEntities: [IgnoredEntity],
            },
            key: 'FirstCollisionObserver',
            paramsShape: undefined,
        }) {
            public override update(): void {}

            public override createView(): ViewCreation2d {
                return createCollisionView();
            }

            public override collide(): void {
                collisionCount += 1;
            }
        }

        class SecondEntity extends suite.defineEntity({
            collidesWith: {
                collidesWithOtherEntities: [IgnoredEntity],
            },
            key: 'SecondCollisionObserver',
            paramsShape: undefined,
        }) {
            public override update(): void {}

            public override createView(): ViewCreation2d {
                return createCollisionView();
            }

            public override collide(): void {
                collisionCount += 1;
            }
        }

        await store.addEntity(FirstEntity);
        await store.addEntity(SecondEntity);
        await store.updateAllEntities(emptyEntityUpdateParams);

        assert.strictEquals(collisionCount, 0);
    });

    it('only notifies the entity that lists the other class in collidesWith', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);
        let observerCollisionCount = 0;
        let targetCollisionCount = 0;

        class TargetEntity extends suite.defineEntity({
            key: 'CollisionTarget',
            paramsShape: undefined,
        }) {
            public override update(): void {}

            public override createView(): ViewCreation2d {
                return createCollisionView();
            }

            public override collide(): void {
                targetCollisionCount += 1;
            }
        }

        class ObserverEntity extends suite.defineEntity({
            collidesWith: {
                collidesWithOtherEntities: [TargetEntity],
            },
            key: 'CollisionObserver',
            paramsShape: undefined,
        }) {
            public override update(): void {}

            public override createView(): ViewCreation2d {
                return createCollisionView();
            }

            public override collide(otherEntity: BaseEntity2d): void {
                if (otherEntity instanceof TargetEntity) {
                    observerCollisionCount += 1;
                }
            }
        }

        const targetEntity = await store.addEntity(TargetEntity);
        const observerEntity = await store.addEntity(ObserverEntity);

        assert.isDefined(targetEntity.hitbox);
        assert.isDefined(observerEntity.hitbox);
        assert.isTrue(
            store.hitboxSystem.checkCollision(targetEntity.hitbox, observerEntity.hitbox),
        );

        await store.updateAllEntities(emptyEntityUpdateParams);

        assert.deepEquals(
            {
                observerCollisionCount,
                targetCollisionCount,
            },
            {
                observerCollisionCount: 1,
                targetCollisionCount: 0,
            },
        );
    });

    it('checks each matching collision target once', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);
        let collisionCount = 0;

        class CollisionTargetEntity extends suite.defineEntity({
            key: 'MultiTargetCollisionTarget',
            paramsShape: undefined,
        }) {
            public override update(): void {}

            public override createView(): ViewCreation2d {
                return createCollisionView();
            }
        }

        class ObserverEntity extends suite.defineEntity({
            collidesWith: {
                collidesWithOtherEntities: [CollisionTargetEntity],
            },
            key: 'MultiTargetCollisionObserver',
            paramsShape: undefined,
        }) {
            public override update(): void {}

            public override createView(): ViewCreation2d {
                return createCollisionView();
            }

            public override collide(): void {
                collisionCount += 1;
            }
        }

        await store.addEntity(ObserverEntity);
        await store.addEntity(CollisionTargetEntity);
        await store.addEntity(CollisionTargetEntity);
        await store.updateAllEntities(emptyEntityUpdateParams);

        assert.strictEquals(collisionCount, 2);
    });

    it('checks collisions between instances of the same class when requested', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);
        let collisionCount = 0;

        class SelfCollidingEntity extends suite.defineEntity({
            collidesWith: {
                collidesWithSelf: true,
            },
            key: 'SelfCollidingEntity',
            paramsShape: undefined,
        }) {
            public override update(): void {}

            public override createView(): ViewCreation2d {
                return createCollisionView();
            }

            public override collide(): void {
                collisionCount += 1;
            }
        }

        await store.addEntity(SelfCollidingEntity);
        await store.addEntity(SelfCollidingEntity);
        await store.updateAllEntities(emptyEntityUpdateParams);

        assert.strictEquals(collisionCount, 2);
    });

    it('calls the base collide no-op for entities without override', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class NoOverride extends suite.defineEntity({
            key: 'NoOverride',
            paramsShape: undefined,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation2d {
                return {
                    view: new Graphics().rect(0, 0, 50, 50).fill('red'),
                    hitbox: new Circle(
                        {
                            x: 0,
                            y: 0,
                        },
                        100,
                    ),
                };
            }
        }

        await store.addEntity(NoOverride);
        await store.addEntity(NoOverride);
        await store.updateAllEntities(emptyEntityUpdateParams);
        assert.strictEquals(store.currentEntityInstances.size, 2);
    });

    it('handles collisions with non-entity hitboxes', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class GuardEntity extends suite.defineEntity({
            key: 'GuardEntity',
            paramsShape: undefined,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation2d {
                return {
                    view: new Graphics().rect(0, 0, 50, 50).fill('purple'),
                    hitbox: new Circle(
                        {
                            x: 0,
                            y: 0,
                        },
                        100,
                    ),
                };
            }
        }

        await store.addEntity(GuardEntity);

        /** Insert a raw hitbox not associated with any entity. */
        const rawHitbox = new Circle(
            {
                x: 0,
                y: 0,
            },
            100,
        );
        store.hitboxSystem.insert(rawHitbox);

        await store.updateAllEntities(emptyEntityUpdateParams);
        assert.strictEquals(store.currentEntityInstances.size, 1);
    });

    it('skips collisions involving destroyed entities', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class DestroyerEntity extends suite.defineEntity({
            key: 'Destroyer',
            paramsShape: undefined,
        }) {
            public override update(): void {}

            public override createView(): ViewCreation2d {
                return {
                    view: new Graphics().rect(0, 0, 50, 50).fill('pink'),
                    hitbox: new Circle(
                        {
                            x: 0,
                            y: 0,
                        },
                        100,
                    ),
                };
            }

            public override collide(otherEntity: BaseEntity2d): void {
                otherEntity.destroy();
            }
        }

        class VictimEntity extends suite.defineEntity({
            key: 'Victim',
            paramsShape: undefined,
        }) {
            public override update(): void {}

            public override createView(): ViewCreation2d {
                return {
                    view: new Graphics().rect(0, 0, 50, 50).fill('green'),
                    hitbox: new Circle(
                        {
                            x: 0,
                            y: 0,
                        },
                        100,
                    ),
                };
            }
        }

        await store.addEntity(DestroyerEntity);
        await store.addEntity(VictimEntity);
        await store.addEntity(VictimEntity);

        /** Completes without error despite entities being destroyed mid-collision. */
        await store.updateAllEntities(emptyEntityUpdateParams);
        assert.strictEquals(store.currentEntityInstances.size, 3);
    });

    it('returns entities from getEntities', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class EntityA extends suite.defineLogicEntity({
            key: 'EntityA',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        class EntityB extends suite.defineLogicEntity({
            key: 'EntityB',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        const instanceA = await store.addEntity(EntityA);
        await store.addEntity(EntityB);

        const aEntities = store.getEntities(EntityA);
        assert.strictEquals(aEntities.size, 1);
        assert.isTrue(aEntities.has(instanceA));
    });

    it('removes a view entity', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class RemovableView extends suite.defineEntity({
            key: 'RemovableView',
            paramsShape: undefined,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation2d {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('green'),
                    hitbox: new Circle(
                        {
                            x: 0,
                            y: 0,
                        },
                        10,
                    ),
                };
            }
        }

        const instance = await store.addEntity(RemovableView);
        assert.strictEquals(store.currentEntityInstances.size, 1 as number);
        store.removeEntity(instance);
        assert.strictEquals(store.currentEntityInstances.size, 0);
    });

    it('removes a logic entity', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class RemovableLogic extends suite.defineLogicEntity({
            key: 'RemovableLogic',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        const instance = await store.addEntity(RemovableLogic);
        store.removeEntity(instance);
        assert.strictEquals(store.currentEntityInstances.size, 0);
    });

    it('throws when removing from a destroyed store', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class ToRemove extends suite.defineLogicEntity({
            key: 'ToRemove',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        const instance = await store.addEntity(ToRemove);
        store.destroy();
        assert.throws(() => store.removeEntity(instance), {
            matchMessage: 'Cannot operate on a destroyed entity store.',
        });
    });

    it('deserializes an entity with params', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class Serializable extends suite.defineLogicEntity({
            key: 'Serializable',
            paramsShape: entityPositionParamsShape,
        }) {
            public override update(): void {}
        }

        store.registerEntities({
            entities: [Serializable],
        });

        const deserialized = await store.deserializeEntity(
            'Serializable',
            JSON.stringify({
                x: 10,
                y: 20,
            }),
        );
        assert.instanceOf(deserialized, Serializable);
        assert.deepEquals(deserialized.params, {
            x: 10,
            y: 20,
        });
    });

    it('restores a snapshot into another store in order', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class SnapshotEntity extends suite.defineLogicEntity({
            key: 'SnapshotEntity',
            paramsShape: entityPositionParamsShape,
        }) {
            public override update(): void {}
        }

        class NoParamsSnapshotEntity extends suite.defineLogicEntity({
            key: 'NoParamsSnapshotEntity',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        await store.addEntity(SnapshotEntity, {
            x: 1,
            y: 2,
        });
        await store.addEntity(NoParamsSnapshotEntity);
        (
            await store.addEntity(SnapshotEntity, {
                x: 3,
                y: 4,
            })
        ).destroy();
        await store.addEntity(SnapshotEntity, {
            x: 5,
            y: 6,
        });

        const targetStore = new EntityStore2d({
            assetLoader: new AssetLoader(),
            pixi: createMockPixi(),
            preregisteredEntities: [
                SnapshotEntity,
                NoParamsSnapshotEntity,
            ],
            state: {},
        });
        const staleEntity = await targetStore.addEntity(SnapshotEntity, {
            x: 7,
            y: 8,
        });

        const restored = await targetStore.loadSnapshot(store.createSnapshot());

        assert.isTrue(staleEntity.isDestroyed);
        assert.deepEquals([...targetStore.currentEntityInstances], restored);
        assert.deepEquals(
            restored.map((entity) => {
                return {
                    entityKey: entity.entityDefinition.entityKey,
                    params: entity.params,
                };
            }),
            [
                {
                    entityKey: 'SnapshotEntity',
                    params: {
                        x: 1,
                        y: 2,
                    },
                },
                {
                    entityKey: 'NoParamsSnapshotEntity',
                    params: undefined,
                },
                {
                    entityKey: 'SnapshotEntity',
                    params: {
                        x: 5,
                        y: 6,
                    },
                },
            ],
        );
    });

    it('rejects a malformed snapshot without destroying current entities', async () => {
        const suite = createTestSuite();

        class SnapshotEntity extends suite.defineLogicEntity({
            key: 'SnapshotEntity',
            paramsShape: entityPositionParamsShape,
        }) {
            public override update(): void {}
        }

        const store = createTestStore(suite);
        const existingEntity = await store.addEntity(SnapshotEntity, {
            x: 1,
            y: 2,
        });

        await assert.throws(
            () => {
                return store.loadSnapshot([
                    {
                        entityKey: SnapshotEntity.entityKey,
                        serializedParams: JSON.stringify({
                            x: 3,
                            y: 4,
                        }),
                    },
                    {
                        entityKey: 5,
                    },
                ] as unknown[] as SerializedEntity2d[]);
            },
            {
                matchMessage: 'Invalid entity snapshot entry at index 1: Shape mismatch',
            },
        );
        assert.isFalse(existingEntity.isDestroyed);
        assert.deepEquals(
            [
                ...store.currentEntityInstances,
            ],
            [
                existingEntity,
            ],
        );
    });

    it('hashes serialized entities by key, params, and order', async () => {
        const suite = createTestSuite();

        class HashedEntity extends suite.defineLogicEntity({
            key: 'HashedEntity',
            paramsShape: entityPositionParamsShape,
        }) {
            public override update(): void {}
        }

        class OnlyXSerializedEntity extends suite.defineLogicEntity({
            key: 'OnlyXSerializedEntity',
            paramsShape: entityPositionParamsShape,
        }) {
            public override update(): void {}

            public override serialize() {
                return JSON.stringify(this.params.x);
            }
        }

        async function createHashedStore(
            entities: ReadonlyArray<
                Readonly<{
                    entityClass: typeof HashedEntity | typeof OnlyXSerializedEntity;
                    y: number;
                }>
            >,
        ) {
            const store = createTestStore(suite);

            await awaitedForEach(entities, async (entity) => {
                await store.addEntity(entity.entityClass, {
                    x: 1,
                    y: entity.y,
                });
            });

            return store;
        }

        const hash = (
            await createHashedStore([
                {
                    entityClass: HashedEntity,
                    y: 2,
                },
                {
                    entityClass: OnlyXSerializedEntity,
                    y: 3,
                },
            ])
        ).hashEntities();

        assert.strictEquals(
            (
                await createHashedStore([
                    {
                        entityClass: HashedEntity,
                        y: 2,
                    },
                    {
                        entityClass: OnlyXSerializedEntity,
                        y: 30,
                    },
                ])
            ).hashEntities(),
            hash,
        );
        assert.notStrictEquals(
            (
                await createHashedStore([
                    {
                        entityClass: HashedEntity,
                        y: 20,
                    },
                    {
                        entityClass: OnlyXSerializedEntity,
                        y: 3,
                    },
                ])
            ).hashEntities(),
            hash,
        );
        assert.notStrictEquals(
            (
                await createHashedStore([
                    {
                        entityClass: OnlyXSerializedEntity,
                        y: 3,
                    },
                    {
                        entityClass: HashedEntity,
                        y: 2,
                    },
                ])
            ).hashEntities(),
            hash,
        );
    });

    it('deserializes preregistered entities', async () => {
        const suite = createTestSuite();

        class PreregisteredEntity extends suite.defineLogicEntity({
            key: 'PreregisteredEntity',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        const store = new EntityStore2d({
            assetLoader: new AssetLoader(),
            pixi: createMockPixi(),
            preregisteredEntities: [PreregisteredEntity],
            state: {},
        });

        const deserialized = await store.deserializeEntity('PreregisteredEntity', undefined);

        assert.instanceOf(deserialized, PreregisteredEntity);
    });

    it('replaces previous entity registrations when requested', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class FirstEntity extends suite.defineLogicEntity({
            key: 'FirstRegisteredEntity',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        class SecondEntity extends suite.defineLogicEntity({
            key: 'SecondRegisteredEntity',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        store.registerEntities({
            entities: [FirstEntity],
        });
        store.registerEntities({
            clearPreviousRegistrations: true,
            entities: [SecondEntity],
        });

        await assert.throws(() => store.deserializeEntity('FirstRegisteredEntity', undefined), {
            matchMessage: "No entity registered for key 'FirstRegisteredEntity'",
        });
        assert.instanceOf(
            await store.deserializeEntity('SecondRegisteredEntity', undefined),
            SecondEntity,
        );
    });

    it('deserializes a entity with params', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class NoParams extends suite.defineLogicEntity({
            key: 'NoParams',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        store.registerEntities({
            entities: [NoParams],
        });

        const deserialized = await store.deserializeEntity('NoParams', undefined);
        assert.instanceOf(deserialized, NoParams);
    });

    it('throws when deserializing with unknown key', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        await assert.throws(() => store.deserializeEntity('unknown', undefined), {
            matchMessage: "No entity registered for key 'unknown'",
        });
    });

    it('throws when deserializing on a destroyed store', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);
        store.destroy();
        await assert.throws(() => store.deserializeEntity('any', undefined), {
            matchMessage: 'Cannot operate on a destroyed entity store.',
        });
    });

    it('throws when adding to a destroyed store', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class CannotAdd extends suite.defineLogicEntity({
            key: 'CannotAdd',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        store.destroy();
        await assert.throws(() => store.addEntity(CannotAdd), {
            matchMessage: 'Cannot operate on a destroyed entity store.',
        });
    });

    it('adds an entity without params when paramsShape is undefined', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class NoParamsEntity extends suite.defineLogicEntity({
            key: 'NoParamsAdd',
        }) {
            public override update(): void {}
        }

        await store.addEntity(NoParamsEntity);
        // @ts-expect-error: this entity does not accept params
        await store.addEntity(NoParamsEntity, {
            x: 10,
            y: 20,
        });
    });

    it('requires correct params when paramsShape is defined', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class ParamsEntity extends suite.defineLogicEntity({
            key: 'ParamsAdd',
            paramsShape: entityPositionParamsShape,
        }) {
            public override update(): void {}
        }

        // @ts-expect-error: missing params input
        await store.addEntity(ParamsEntity);

        await store.addEntity(ParamsEntity, {
            x: 10,
            y: 20,
        });
    });

    it('throws on double destroy', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);
        store.destroy();
        assert.throws(() => store.destroy(), {
            matchMessage: 'Entity store is already destroyed.',
        });
    });

    it('awaits async collision callbacks', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);
        let asyncCollisionResolved = false;
        const collisionStarted = new DeferredPromise<void>();
        const finishCollision = new DeferredPromise<void>();

        class CollisionTargetEntity extends suite.defineEntity({
            key: 'AsyncCollisionTarget',
            paramsShape: undefined,
        }) {
            public override update(): void {}

            public override createView(): ViewCreation2d {
                return createCollisionView();
            }
        }

        class AsyncCollideEntity extends suite.defineEntity({
            collidesWith: {
                collidesWithOtherEntities: [CollisionTargetEntity],
            },
            key: 'AsyncCollide',
            paramsShape: undefined,
        }) {
            public override update(): void {}

            public override createView(): ViewCreation2d {
                return createCollisionView();
            }

            public override async collide() {
                collisionStarted.resolve();
                await finishCollision.promise;
                asyncCollisionResolved = true;
            }
        }

        makeWritable(CollisionTargetEntity).collidesWith = {
            collidesWithOtherEntities: [AsyncCollideEntity],
        };
        makeWritable(CollisionTargetEntity).collidesWithSet = new Set([AsyncCollideEntity]);

        await store.addEntity(CollisionTargetEntity);
        await store.addEntity(AsyncCollideEntity);

        const updatePromise = store.updateAllEntities(emptyEntityUpdateParams);

        await collisionStarted.promise;
        assert.isFalse(asyncCollisionResolved);
        finishCollision.resolve();
        await updatePromise;
        assert.isTrue(asyncCollisionResolved);
    });
});
