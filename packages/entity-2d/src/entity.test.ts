import {AssetLoader} from '@antha/asset';
import {BodyType, EntityDestroyEvent, EntityEvent} from '@antha/entity-core';
import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {defineShape} from 'object-shape-tester';
import {Graphics, ParticleContainer} from 'pixi.js';
import {createAnthaEntity2dSuite} from './antha-entity-2d.mod.js';
import {createTestStore, emptyEntityUpdateParams} from './entity-store-2d.mock.js';
import {type ViewCreation2d} from './entity.js';
import {ShapeType} from './physics.js';

const coordsParamsShape = defineShape({
    x: 0,
    y: 0,
});

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

describe('BaseEntity', () => {
    it('deserializes with paramsShape', () => {
        const suite = createAnthaEntity2dSuite();

        class WithShape extends suite.defineLogicEntity({
            key: 'WithShape',
            paramsShape: coordsParamsShape,
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
        const suite = createAnthaEntity2dSuite();

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
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);

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
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);

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
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);
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
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);

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

    it('throws when immediately destroying all entities from a destroyed store', async () => {
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);
        store.destroy();

        assert.throws(() => store.destroyAllEntities(), {
            matchMessage: 'Cannot operate on a destroyed entity store.',
        });
    });

    it('serializes params to JSON', async () => {
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);

        class WithParams extends suite.defineLogicEntity({
            key: 'WithParams',
            paramsShape: coordsParamsShape,
        }) {
            public override update(): void {}
        }

        const instance = await store.addEntity(WithParams, {
            params: {
                x: 42,
                y: 99,
            },
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
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);

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
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);

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
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);

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
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);

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
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);

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
    it('builds physics from params', async () => {
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);

        class Sized extends suite.defineEntity({
            key: 'Sized',
            paramsShape: defineShape({
                radius: 1,
            }),
            physics(params) {
                return {
                    type: BodyType.Dynamic,
                    shapes: [
                        {
                            type: ShapeType.Circle,
                            radius: params.radius,
                        },
                    ],
                };
            },
        }) {}

        const small = await store.addEntity(Sized, {
            params: {
                radius: 1,
            },
        });
        const big = await store.addEntity(Sized, {
            params: {
                radius: 2,
            },
        });

        assert.strictEquals(Math.round(big.physics.getMass() / small.physics.getMass()), 4);
        store.destroy();
    });

    it('creates a hidden ParticleContainer when createView returns no view', async () => {
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);

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

    it('preserves asset keys', () => {
        const suite = createAnthaEntity2dSuite();

        class AssetEntity extends suite.defineEntity({
            key: 'AssetEntity',
            paramsShape: coordsParamsShape,
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
                };
            }
        }
    });

    it('accesses assets via getAsset accessor', async () => {
        const suite = createAnthaEntity2dSuite();
        const assetLoader = new AssetLoader();
        const store = await createTestStore(suite, {
            assetLoader,
        });

        class AssetAccessEntity extends suite.defineEntity({
            key: 'AssetAccessEntity',
            paramsShape: coordsParamsShape,
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
            params: {
                x: 0,
                y: 0,
            },
        });
        const spriteData = await instance.getAsset.sprite();
        assert.strictEquals(spriteData, 'sprite-data');
    });

    it('returns true for isInBounds when entity is within screen', async () => {
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);

        class InBoundsEntity extends suite.defineEntity({
            key: 'InBoundsEntity',
            paramsShape: coordsParamsShape,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation2d {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('green'),
                };
            }
        }

        const instance = await store.addEntity(InBoundsEntity, {
            params: {
                x: 0,
                y: 0,
            },
            position: {
                x: 500,
                y: 500,
            },
        });
        await store.renderAllEntities(emptyEntityUpdateParams);

        assert.isTrue(instance.isInBounds());
        assert.isTrue(
            instance.isInBounds({
                entirely: true,
            }),
        );
    });

    it('returns false for isInBounds when entity is outside screen', async () => {
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);

        class OutBoundsEntity extends suite.defineEntity({
            key: 'OutBoundsEntity',
            paramsShape: coordsParamsShape,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation2d {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('lime'),
                };
            }
        }

        const instance = await store.addEntity(OutBoundsEntity, {
            params: {
                x: 0,
                y: 0,
            },
            position: {
                x: -9999,
                y: -9999,
            },
        });
        await store.renderAllEntities(emptyEntityUpdateParams);

        assert.isFalse(instance.isInBounds());
    });

    it('throws when calling isInBounds on a destroyed entity', async () => {
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);

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

    it('removes a view entity via removeEntity', async () => {
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);

        class PlainView extends suite.defineEntity({
            key: 'PlainView',
            paramsShape: undefined,
        }) {
            public override update(): void {}
            public override createView(): ViewCreation2d {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('indigo'),
                };
            }
        }

        const instance = await store.addEntity(PlainView);
        store.removeEntity(instance);
        assert.strictEquals(store.currentEntityInstances.size, 0);
    });
});
