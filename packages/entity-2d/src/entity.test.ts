import {AssetLoader} from '@antha/asset';
import {assert} from '@augment-vir/assert';
import {describe, it, itCases} from '@augment-vir/test';
import {Circle} from 'detect-collisions';
import {Graphics, ParticleContainer} from 'pixi.js';
import {createTestStore, createTestSuite} from './entity-store-2d.mock.js';
import {
    EntityDestroyEvent,
    EntityEvent,
    entityPositionParamsShape,
    position2dParamsMap,
    reverseParamsMap,
    type ViewCreation2d,
} from './entity.js';

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

describe(reverseParamsMap.name, () => {
    itCases(reverseParamsMap, [
        {
            it: 'converts a full params map',
            input: {
                hitbox: {
                    angle: true,
                    width: 'w',
                },
                view: {
                    alpha: true,
                    width: 'w',
                },
            },
            expect: {
                angle: {
                    hitbox: ['angle'],
                },
                w: {
                    hitbox: ['width'],
                    view: ['width'],
                },
                alpha: {
                    view: ['alpha'],
                },
            },
        },
        {
            it: 'converts a partial params map',
            input: {
                hitbox: {
                    angle: true,
                    width: 'w',
                },
            },
            expect: {
                angle: {
                    hitbox: ['angle'],
                },
                w: {
                    hitbox: ['width'],
                },
            },
        },
        {
            it: 'skips falsy mapping values',
            input: {
                hitbox: {
                    // @ts-expect-error: can't assign false to a params map
                    angle: false,
                    width: 'w',
                },
            },
            expect: {
                w: {
                    hitbox: ['width'],
                },
            },
        },
    ]);
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

    it('immediately destroys all current entities', async () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);

        class DestroyMe extends suite.defineLogicEntity({
            key: 'DestroyAllMe',
            paramsShape: undefined,
        }) {
            public override update(): void {}
        }

        const firstInstance = await store.addEntity(DestroyMe);
        const secondInstance = await store.addEntity(DestroyMe);

        store.destroyAllEntities();

        assert.deepEquals(
            {
                entityCount: store.currentEntityInstances.size,
                firstInstanceIsDestroyed: firstInstance.isDestroyed,
                secondInstanceIsDestroyed: secondInstance.isDestroyed,
            },
            {
                entityCount: 0,
                firstInstanceIsDestroyed: true,
                secondInstanceIsDestroyed: true,
            },
        );
    });

    it('throws when immediately destroying all entities from a destroyed store', () => {
        const suite = createTestSuite();
        const store = createTestStore(suite);
        store.destroy();

        assert.throws(() => store.destroyAllEntities(), {
            matchMessage: 'Cannot operate on a destroyed entity store.',
        });
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
