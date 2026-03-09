import {createMockPixi} from '@antha/pixi-canvas';
import {assert} from '@augment-vir/assert';
import {makeWritable} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {Circle} from 'detect-collisions';
import {Graphics, ParticleContainer} from 'pixi.js';
import {defineEntitySuite} from './entity-suite.js';
import {
    EntityDestroyEvent,
    entityPositionParamsShape,
    standardParamsMap,
    type EntityStore,
    type ViewCreation,
} from './entity.js';

function createTestSuite() {
    const {defineEntity, defineLogicEntity, EntityStore} = defineEntitySuite();
    return {
        defineEntity,
        defineLogicEntity,
        EntityStore,
    };
}

function createTestStore(suite: {EntityStore: new (...args: any[]) => EntityStore}) {
    return new suite.EntityStore({
        pixi: createMockPixi(),
        state: {},
    });
}

describe('EntityStore', () => {
    it('throws when calling updateAllEntities on a destroyed store', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);
        store.destroy();
        assert.throws(() => store.updateAllEntities(), {
            matchMessage: 'Cannot operate on a destroyed entity store.',
        });
    });

    it('cleans up entities destroyed outside update cycle', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class TestEntity extends suite.defineLogicEntity({
            key: 'OutsideDestroy',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        const instance = store.addEntity(TestEntity);
        /** Mark as destroyed outside an update cycle. */
        makeWritable(instance).isDestroyed = true;

        store.updateAllEntities();
        assert.strictEquals(store.currentEntityInstances.size, 0);
    });

    it('cleans up entities that destroy themselves during update', () => {
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

        store.addEntity(SelfDestroyer);
        store.updateAllEntities();
        assert.strictEquals(store.currentEntityInstances.size, 0);
    });

    it('triggers collision callback between overlapping hitboxes', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);
        let collisionDetected = false;

        class CollidingEntity extends suite.defineEntity({
            key: 'Colliding',
            paramsShape: undefined,
        }) {
            public override update(): void {}

            public override createView(): ViewCreation {
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

            public override collide(): void {
                collisionDetected = true;
            }
        }

        store.addEntity(CollidingEntity);
        store.addEntity(CollidingEntity);

        store.updateAllEntities();
        assert.isTrue(collisionDetected);
    });

    it('calls the base collide no-op for entities without override', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class NoOverride extends suite.defineEntity({
            key: 'NoOverride',
            paramsShape: undefined,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation {
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

        store.addEntity(NoOverride);
        store.addEntity(NoOverride);
        store.updateAllEntities();
    });

    it('handles collisions with non-entity hitboxes', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class GuardEntity extends suite.defineEntity({
            key: 'GuardEntity',
            paramsShape: undefined,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation {
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

        store.addEntity(GuardEntity);

        /** Insert a raw hitbox not associated with any entity. */
        const rawHitbox = new Circle(
            {
                x: 0,
                y: 0,
            },
            100,
        );
        store.hitboxSystem.insert(rawHitbox);

        store.updateAllEntities();
    });

    it('returns entities from getEntities', () => {
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

        const instanceA = store.addEntity(EntityA);
        store.addEntity(EntityB);

        const aEntities = store.getEntities(EntityA);
        assert.strictEquals(aEntities.size, 1);
        assert.isTrue(aEntities.has(instanceA));
    });

    it('removes a view entity', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class RemovableView extends suite.defineEntity({
            key: 'RemovableView',
            paramsShape: undefined,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation {
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

        const instance = store.addEntity(RemovableView);
        assert.strictEquals(store.currentEntityInstances.size, 1 as number);
        store.removeEntity(instance);
        assert.strictEquals(store.currentEntityInstances.size, 0);
    });

    it('removes a logic entity', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class RemovableLogic extends suite.defineLogicEntity({
            key: 'RemovableLogic',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        const instance = store.addEntity(RemovableLogic);
        store.removeEntity(instance);
        assert.strictEquals(store.currentEntityInstances.size, 0);
    });

    it('throws when removing from a destroyed store', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class ToRemove extends suite.defineLogicEntity({
            key: 'ToRemove',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        const instance = store.addEntity(ToRemove);
        store.destroy();
        assert.throws(() => store.removeEntity(instance), {
            matchMessage: 'Cannot operate on a destroyed entity store.',
        });
    });

    it('deserializes an entity with params', () => {
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

        const deserialized = store.deserializeEntity(
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

    it('deserializes a entity with params', () => {
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

        const deserialized = store.deserializeEntity('NoParams', undefined);
        assert.instanceOf(deserialized, NoParams);
    });

    it('throws when deserializing with unknown key', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        assert.throws(() => store.deserializeEntity('unknown', undefined), {
            matchMessage: "No entity registered for key 'unknown'",
        });
    });

    it('throws when deserializing on a destroyed store', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);
        store.destroy();
        assert.throws(() => store.deserializeEntity('any', undefined), {
            matchMessage: 'Cannot operate on a destroyed entity store.',
        });
    });

    it('throws when adding to a destroyed store', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class CannotAdd extends suite.defineLogicEntity({
            key: 'CannotAdd',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        store.destroy();
        assert.throws(() => store.addEntity(CannotAdd), {
            matchMessage: 'Cannot operate on a destroyed entity store.',
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

    it('adds a child entity from within an entity', () => {
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
            public override update(): void {
                this.addEntity(ChildEntity);
            }
        }

        const parent = store.addEntity(ParentEntity);
        parent.update();
        assert.strictEquals(store.currentEntityInstances.size, 2);
    });

    it('throws when adding through a destroyed entity', () => {
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

        const parent = store.addEntity(Parent2);
        parent.destroy();
        assert.throws(() => parent.addEntity(Child2), {
            matchMessage: 'Cannot add entity through destroyed entity.',
        });
    });

    it('immediately destroys a logic entity', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);
        let destroyEventReceived = false;

        class DestroyMe extends suite.defineLogicEntity({
            key: 'DestroyMe',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        const instance = store.addEntity(DestroyMe);
        store.listenTarget.listen(EntityDestroyEvent, () => {
            destroyEventReceived = true;
        });
        instance.immediatelyDestroy();
        assert.isTrue(instance.isDestroyed);
        assert.strictEquals(store.currentEntityInstances.size, 0);
        assert.isTrue(destroyEventReceived);
    });

    it('serializes params to JSON', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class WithParams extends suite.defineLogicEntity({
            key: 'WithParams',
            paramsShape: entityPositionParamsShape,
        }) {
            public override update(): void {}
        }

        const instance = store.addEntity(WithParams, {
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

    it('returns undefined from serialize when no params', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class NoParamsSerialize extends suite.defineLogicEntity({
            key: 'NoParamsSerialize',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        const instance = store.addEntity(NoParamsSerialize);
        assert.isUndefined(instance.serialize());
    });
});

describe('ViewEntity', () => {
    it('creates a hidden ParticleContainer when createView returns no view', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class NoView extends suite.defineEntity({
            key: 'NoView',
            paramsShape: undefined,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation {
                return {};
            }
        }

        const instance = store.addEntity(NoView);
        assert.instanceOf(instance.view, ParticleContainer);
        assert.isFalse(instance.view.visible);
    });

    it('inserts a hitbox into the hitbox system', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class WithHitbox extends suite.defineEntity({
            key: 'WithHitbox',
            paramsShape: undefined,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation {
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

        const instance = store.addEntity(WithHitbox);
        assert.isDefined(instance.hitbox);
        assert.strictEquals(instance.hitbox.userData, instance);
    });

    it('propagates params to view and hitbox via proxy', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class MappedEntity extends suite.defineEntity({
            key: 'MappedEntity',
            paramsShape: entityPositionParamsShape,
            paramsMap: standardParamsMap,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation {
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

        const instance = store.addEntity(MappedEntity, {
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

    it('returns true for isInBounds when entity is within screen', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class InBoundsEntity extends suite.defineEntity({
            key: 'InBoundsEntity',
            paramsShape: entityPositionParamsShape,
            paramsMap: standardParamsMap,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('green'),
                };
            }
        }

        const instance = store.addEntity(InBoundsEntity, {
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

    it('returns false for isInBounds when entity is outside screen', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class OutBoundsEntity extends suite.defineEntity({
            key: 'OutBoundsEntity',
            paramsShape: entityPositionParamsShape,
            paramsMap: standardParamsMap,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('red'),
                };
            }
        }

        const instance = store.addEntity(OutBoundsEntity, {
            x: -9999,
            y: -9999,
        });

        assert.isFalse(instance.isInBounds());
    });

    it('throws when calling isInBounds on a destroyed entity', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class DestroyedBounds extends suite.defineEntity({
            key: 'DestroyedBounds',
            paramsShape: undefined,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('pink'),
                };
            }
        }

        const instance = store.addEntity(DestroyedBounds);
        instance.immediatelyDestroy();
        assert.throws(() => instance.isInBounds(), {
            matchMessage: 'Cannot check bounds on destroyed entity.',
        });
    });

    it('immediately destroys a view entity with hitbox', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class DestroyableView extends suite.defineEntity({
            key: 'DestroyableView',
            paramsShape: undefined,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation {
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

        const instance = store.addEntity(DestroyableView);
        assert.isDefined(instance.hitbox);
        instance.immediatelyDestroy();
        assert.isTrue(instance.isDestroyed);
        assert.strictEquals(store.currentEntityInstances.size, 0);
    });

    it('removes view entity without hitbox via removeEntity', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class NoHitboxView extends suite.defineEntity({
            key: 'NoHitboxView',
            paramsShape: undefined,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('blue'),
                };
            }
        }

        const instance = store.addEntity(NoHitboxView);
        store.removeEntity(instance);
        assert.strictEquals(store.currentEntityInstances.size, 0);
    });
});
