import {AssetLoader} from '@antha/asset';
import {createMockPixi} from '@antha/graphics-2d';
import {assert} from '@augment-vir/assert';
import {DeferredPromise, makeWritable} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {Circle} from 'detect-collisions';
import {Graphics, ParticleContainer} from 'pixi.js';
import {defineEntitySuite2d} from './entity-suite.js';
import {
    EntityDestroyEvent,
    EntityEvent,
    EntityHitboxSystem,
    entityPositionParamsShape,
    loadEntityAssets,
    position2dParamsMap,
    type BaseEntity2d,
    type EntityStore2d,
    type ViewCreation2d,
} from './entity.js';

function createTestSuite() {
    const {defineEntity, defineLogicEntity, EntityStore} = defineEntitySuite2d();
    return {
        defineEntity,
        defineLogicEntity,
        EntityStore,
    };
}

function createTestStore(
    suite: {EntityStore: new (...args: any[]) => EntityStore2d},
    options?: {
        assetLoader?: AssetLoader;
        customHitboxSystem?: EntityHitboxSystem;
    },
) {
    return new suite.EntityStore({
        pixi: createMockPixi(),
        state: {},
        assetLoader: options?.assetLoader,
        customHitboxSystem: options?.customHitboxSystem,
    });
}

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

describe(EntityEvent.name, () => {
    it('maintains the data type', () => {
        class ScoreEvent extends EntityEvent<{score: number}> {}

        const eventInstance = new ScoreEvent({
            data: {
                score: 1,
            },
            entityInstance: {} as any,
        });

        assert.tsType(eventInstance.detail.data).equals<{
            score: number;
        }>();
    });
});

describe('EntityStore', () => {
    it('throws when calling updateAllEntities on a destroyed store', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);
        store.destroy();
        await assert.throws(
            () => {
                return store.updateAllEntities({
                    msSinceLastUpdate: 0,
                });
            },
            {
                matchMessage: 'Cannot operate on a destroyed entity store.',
            },
        );
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

        await store.updateAllEntities({
            msSinceLastUpdate: 0,
        });
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
        await store.updateAllEntities({
            msSinceLastUpdate: 0,
        });
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

        await store.updateAllEntities({
            msSinceLastUpdate: 0,
        });
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
        await store.updateAllEntities({
            msSinceLastUpdate: 0,
        });

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

        await store.updateAllEntities({
            msSinceLastUpdate: 0,
        });

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
        await store.updateAllEntities({
            msSinceLastUpdate: 0,
        });

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
        await store.updateAllEntities({
            msSinceLastUpdate: 0,
        });

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
        await store.updateAllEntities({
            msSinceLastUpdate: 0,
        });
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

        await store.updateAllEntities({
            msSinceLastUpdate: 0,
        });
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
        await store.updateAllEntities({
            msSinceLastUpdate: 0,
        });
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

    it('loads entity assets via loadEntityAssets', async () => {
        const suite = createTestSuite();
        const assetLoader = new AssetLoader();
        let loadCalled = false;

        class AssetEntity extends suite.defineEntity({
            key: 'AssetEntityLoad',
            paramsShape: undefined,
            assets: {
                graphic: {
                    maxProgress: 1,
                    load({incrementProgressCallback}) {
                        loadCalled = true;
                        incrementProgressCallback();
                        return {
                            value: new Graphics().rect(0, 0, 10, 10).fill('red'),
                        };
                    },
                },
            },
        }) {
            public override update(): void {}
            public override createView(): ViewCreation2d {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('red'),
                };
            }
        }

        await loadEntityAssets({
            assetLoader,
            entities: [AssetEntity],
        });
        assert.isTrue(loadCalled);
    });

    it('loads other assets via loadEntityAssets', async () => {
        const suite = createTestSuite();
        const assetLoader = new AssetLoader();
        let otherAssetLoadCalled = false;

        class NoAssetsEntity extends suite.defineLogicEntity({
            key: 'NoAssetsEntityLoad',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        await loadEntityAssets({
            assetLoader,
            entities: [NoAssetsEntity],
            otherAssets: [
                {
                    assetName: 'Other asset',
                    maxProgress: 1,
                    load({incrementProgressCallback}) {
                        otherAssetLoadCalled = true;
                        incrementProgressCallback();
                        return {
                            value: 'other-value',
                        };
                    },
                },
            ],
        });

        assert.isTrue(otherAssetLoadCalled);
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

        const updatePromise = store.updateAllEntities({
            msSinceLastUpdate: 0,
        });

        await collisionStarted.promise;
        assert.isFalse(asyncCollisionResolved);
        finishCollision.resolve();
        await updatePromise;
        assert.isTrue(asyncCollisionResolved);
    });
});

describe('BaseEntity', () => {
    it('deserializes with paramsShape', () => {
        const suite = createTestSuite();

        class WithShape extends suite.defineLogicEntity({
            key: 'WithShape',
            paramsShape: entityPositionParamsShape,
        }) {
            public override update(): void {}
        }

        const result = WithShape.deserialize(
            JSON.stringify({
                x: 5,
                y: 10,
            }),
        );
        assert.deepEquals(result, {
            x: 5,
            y: 10,
        });
    });

    it('deserializes without paramsShape', () => {
        const suite = createTestSuite();

        class WithoutShape extends suite.defineLogicEntity({
            key: 'WithoutShape',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        const result = WithoutShape.deserialize(undefined);
        assert.isUndefined(result);
    });

    it('adds a child entity from within an entity', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class ChildEntity extends suite.defineLogicEntity({
            key: 'Child',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        class ParentEntity extends suite.defineLogicEntity({
            key: 'Parent',
            paramsShape: undefined,
        }) {
            public override async update(): Promise<void> {
                await this.addEntity(ChildEntity);
            }
        }

        const parent = await store.addEntity(ParentEntity);
        await parent.update();
        assert.strictEquals(store.currentEntityInstances.size, 2);
    });

    it('throws when adding through a destroyed entity', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class Child2 extends suite.defineLogicEntity({
            key: 'Child2',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        class Parent2 extends suite.defineLogicEntity({
            key: 'Parent2',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        const parent = await store.addEntity(Parent2);
        parent.destroy();
        await assert.throws(() => parent.addEntity(Child2), {
            matchMessage: 'Cannot add entity through destroyed entity.',
        });
    });

    it('immediately destroys a logic entity', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);
        let destroyEventReceived = false;

        class DestroyMe extends suite.defineLogicEntity({
            key: 'DestroyMe',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        const instance = await store.addEntity(DestroyMe);
        store.listenTarget.listen(EntityDestroyEvent, () => {
            destroyEventReceived = true;
        });
        instance.immediatelyDestroy();
        assert.isTrue(instance.isDestroyed);
        assert.strictEquals(store.currentEntityInstances.size, 0);
        assert.isTrue(destroyEventReceived);
    });

    it('serializes params to JSON', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class WithParams extends suite.defineLogicEntity({
            key: 'WithParams',
            paramsShape: entityPositionParamsShape,
        }) {
            public override update(): void {}
        }

        const instance = await store.addEntity(WithParams, {
            x: 42,
            y: 99,
        });
        assert.strictEquals(
            instance.serialize(),
            JSON.stringify({
                x: 42,
                y: 99,
            }),
        );
    });

    it('returns undefined from serialize when no params', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class NoParamsSerialize extends suite.defineLogicEntity({
            key: 'NoParamsSerialize',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        const instance = await store.addEntity(NoParamsSerialize);
        assert.isUndefined(instance.serialize());
    });

    it('exposes an not aborted abortSignal before destruction', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class Abortable extends suite.defineLogicEntity({
            key: 'AbortableNotAborted',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        const instance = await store.addEntity(Abortable);
        assert.isFalse(instance.abortSignal.aborted);
    });

    it('aborts the signal when destroy is called', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class Abortable extends suite.defineLogicEntity({
            key: 'AbortableDestroy',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        const instance = await store.addEntity(Abortable);
        instance.destroy();
        assert.isTrue(instance.abortSignal.aborted);
    });

    it('aborts the signal when immediatelyDestroy is called', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class Abortable extends suite.defineLogicEntity({
            key: 'AbortableImmediate',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        const instance = await store.addEntity(Abortable);
        instance.immediatelyDestroy();
        assert.isTrue(instance.abortSignal.aborted);
    });

    it('aborts the signal when the entity store is destroyed', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class Abortable extends suite.defineLogicEntity({
            key: 'AbortableStoreDestroy',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        const instance = await store.addEntity(Abortable);
        store.destroy();
        assert.isTrue(instance.abortSignal.aborted);
    });
});

describe('ViewEntity', () => {
    it('creates a hidden ParticleContainer when createView returns no view', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class NoView extends suite.defineEntity({
            key: 'NoView',
            paramsShape: undefined,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation2d {
                return {};
            }
        }

        const instance = await store.addEntity(NoView);
        assert.instanceOf(instance.view, ParticleContainer);
        assert.isFalse(instance.view.visible);
    });

    it('inserts a hitbox into the hitbox system', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class WithHitbox extends suite.defineEntity({
            key: 'WithHitbox',
            paramsShape: undefined,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation2d {
                return {
                    view: new Graphics().rect(0, 0, 20, 20).fill('red'),
                    hitbox: new Circle(
                        {
                            x: 0,
                            y: 0,
                        },
                        15,
                    ),
                };
            }
        }

        const instance = await store.addEntity(WithHitbox);
        assert.isDefined(instance.hitbox);
        assert.strictEquals(instance.hitbox.userData, instance);
    });

    it('propagates params to view and hitbox via proxy', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class MappedEntity extends suite.defineEntity({
            key: 'MappedEntity',
            paramsShape: entityPositionParamsShape,
            paramsMap: position2dParamsMap,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation2d {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('blue'),
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

        const instance = await store.addEntity(MappedEntity, {
            x: 100,
            y: 200,
        });

        assert.strictEquals(instance.view.x, 100 as number);
        assert.strictEquals(instance.view.y, 200);
        assert.strictEquals(instance.hitbox?.x, 100 as number);
        assert.strictEquals(instance.hitbox.y, 200);

        /** Mutate params and verify propagation. */
        instance.params.x = 300;
        assert.strictEquals(instance.view.x, 300);
        assert.strictEquals(instance.hitbox.x, 300);
    });

    it('preserves asset keys', () => {
        const suite = createTestSuite();

        class AssetEntity extends suite.defineEntity({
            key: 'AssetEntity',
            paramsShape: entityPositionParamsShape,
            paramsMap: position2dParamsMap,
            assets: {
                graphic: {
                    maxProgress: 1,
                    load({incrementProgressCallback}) {
                        const graphic = new Graphics().rect(0, 0, 10, 10).fill('blue');
                        incrementProgressCallback();
                        return {
                            value: graphic,
                        };
                    },
                },
            },
        }) {
            public override update(): void {}
            public override async createView() {
                const graphic = await this.getAsset.graphic();
                assert.tsType(graphic).equals<Graphics>();

                return {
                    view: graphic,
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
    });

    it('accesses assets via getAsset accessor', async () => {
        const suite = createTestSuite();
        const assetLoader = new AssetLoader();
        const store = createTestStore(suite, {
            assetLoader,
        });

        class AssetAccessEntity extends suite.defineEntity({
            key: 'AssetAccessEntity',
            paramsShape: entityPositionParamsShape,
            paramsMap: position2dParamsMap,
            assets: {
                sprite: {
                    maxProgress: 1,
                    load({incrementProgressCallback}) {
                        incrementProgressCallback();
                        return {
                            value: 'sprite-data',
                        };
                    },
                },
            },
        }) {
            public override update(): void {}
            public override createView(): ViewCreation2d {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('blue'),
                };
            }
        }

        const instance = await store.addEntity(AssetAccessEntity, {
            x: 0,
            y: 0,
        });
        const spriteData = await instance.getAsset.sprite();
        assert.strictEquals(spriteData, 'sprite-data');
    });

    it('returns true for isInBounds when entity is within screen', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class InBoundsEntity extends suite.defineEntity({
            key: 'InBoundsEntity',
            paramsShape: entityPositionParamsShape,
            paramsMap: position2dParamsMap,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation2d {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('green'),
                };
            }
        }

        const instance = await store.addEntity(InBoundsEntity, {
            x: 500,
            y: 500,
        });

        assert.isTrue(instance.isInBounds());
        assert.isTrue(
            instance.isInBounds({
                entirely: true,
            }),
        );
    });

    it('returns false for isInBounds when entity is outside screen', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class OutBoundsEntity extends suite.defineEntity({
            key: 'OutBoundsEntity',
            paramsShape: entityPositionParamsShape,
            paramsMap: position2dParamsMap,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation2d {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('lime'),
                };
            }
        }

        const instance = await store.addEntity(OutBoundsEntity, {
            x: -9999,
            y: -9999,
        });

        assert.isFalse(instance.isInBounds());
    });

    it('throws when calling isInBounds on a destroyed entity', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class DestroyedBounds extends suite.defineEntity({
            key: 'DestroyedBounds',
            paramsShape: undefined,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation2d {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('pink'),
                };
            }
        }

        const instance = await store.addEntity(DestroyedBounds);
        instance.immediatelyDestroy();
        assert.throws(() => instance.isInBounds(), {
            matchMessage: 'Cannot check bounds on destroyed entity.',
        });
    });

    it('immediately destroys a view entity with hitbox', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class DestroyableView extends suite.defineEntity({
            key: 'DestroyableView',
            paramsShape: undefined,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation2d {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('red'),
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

        const instance = await store.addEntity(DestroyableView);
        assert.isDefined(instance.hitbox);
        instance.immediatelyDestroy();
        assert.isTrue(instance.isDestroyed);
        assert.strictEquals(store.currentEntityInstances.size, 0);
    });

    it('removes view entity without hitbox via removeEntity', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class NoHitboxView extends suite.defineEntity({
            key: 'NoHitboxView',
            paramsShape: undefined,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation2d {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('indigo'),
                };
            }
        }

        const instance = await store.addEntity(NoHitboxView);
        store.removeEntity(instance);
        assert.strictEquals(store.currentEntityInstances.size, 0);
    });
});
