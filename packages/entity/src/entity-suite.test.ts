import {AssetLoader} from '@antha/asset';
import {createMockPixi} from '@antha/pixi-canvas';
import {assert} from '@augment-vir/assert';
import {SeededRandom, type AnyObject} from '@augment-vir/common';
import {describe, it, itCases} from '@augment-vir/test';
import {Graphics} from 'pixi.js';
import {type Constructor} from 'type-fest';
import {defineEntitySuite, reverseParamsMap, type DefineViewEntity} from './entity-suite.js';
import {
    BaseEntity,
    EntityDestroyEvent,
    EntityEvent,
    entityPositionParamsShape,
    ViewEntity,
    type EntityPositionParams,
    type EntityStore,
    type ViewCreation,
} from './entity.js';

describe(defineEntitySuite.name, () => {
    it('infers defined state type', () => {
        const initState = {
            digits: 4,
            random: SeededRandom.fromSeed('test seed'),
        };

        const {defineEntity, EntityStore} = defineEntitySuite<typeof initState>();

        assert.tsType(defineEntity).equals<DefineViewEntity<typeof initState>>();

        class MyEntity extends defineEntity({
            key: 'MyEntity',
            paramsShape: entityPositionParamsShape,
        }) {
            public update(): void {
                assert.strictEquals(this.state, initState);
                assert.tsType(MyEntity.entityKey).equals<string>();
                assert.tsType(this.state).equals<typeof initState>();
            }

            public createView() {
                assert.tsType(this.state).equals<typeof initState>();
                assert.strictEquals(this.state, initState);
                assert.tsType(this.params).equals<EntityPositionParams>();
                const rect = new Graphics().rect(0, 0, 20, 20).fill('magenta');
                rect.x = this.params.x;
                rect.y = this.params.y;
                return {
                    view: rect,
                };
            }
        }

        assert.tsType(MyEntity.entityKey).equals<string>();
        assert.strictEquals(MyEntity.entityKey, 'MyEntity');

        const entityStore = new EntityStore({
            pixi: createMockPixi(),
            state: initState,
            assetLoader: new AssetLoader(),
        });
        assert.tsType(entityStore).equals<EntityStore<typeof initState>>();
    });
    it('defaults to undefined context', () => {
        const {defineEntity, EntityStore} = defineEntitySuite();

        assert.tsType(defineEntity).equals<DefineViewEntity<AnyObject>>();

        class MyEntity extends defineEntity({
            key: 'MyEntity',
            paramsShape: entityPositionParamsShape,
        }) {
            public update(): void {
                assert.tsType(MyEntity.entityKey).equals<string>();
                assert.tsType(this.state).equals<AnyObject>();
            }

            public createView() {
                assert.tsType(this.state).equals<AnyObject>();
                assert.isUndefined(this.state);
                assert.tsType(this.params).equals<EntityPositionParams>();
                const rect = new Graphics().rect(0, 0, 20, 20).fill('magenta');
                rect.x = this.params.x;
                rect.y = this.params.y;
                return {
                    view: rect,
                };
            }
        }

        assert.tsType(MyEntity.entityKey).equals<string>();
        assert.strictEquals(MyEntity.entityKey, 'MyEntity');

        const entityStore = new EntityStore({
            pixi: createMockPixi(),
            state: {},
            assetLoader: new AssetLoader(),
        });
        assert.tsType(entityStore).equals<EntityStore<AnyObject>>();
    });
    it('assigns the events type parameter', async () => {
        const {defineEntity, EntityStore} = defineEntitySuite();

        class MyEvent extends EntityEvent<{value: number}> {}
        class MyEvent2 extends EntityEvent<{value: number}> {}
        assert.tsType(MyEvent).matches<Constructor<Event>>();
        assert.tsType(MyEvent2).matches<Constructor<Event>>();
        assert
            .tsType([
                MyEvent,
                MyEvent2,
            ])
            .matches<ReadonlyArray<Constructor<Event>>>();

        class MyEntity extends defineEntity({
            key: 'MyEntity',
            paramsShape: undefined,
        }) {
            public override update(): void {
                // do nothing
            }
            public override createView() {
                this.dispatch(
                    new MyEvent({
                        entityInstance: this,
                        data: {
                            value: 5,
                        },
                    }),
                );
                return {
                    view: new Graphics().rect(0, 0, 20, 20).fill('magenta'),
                };
            }
        }
        class MyEntity2 extends defineEntity({
            key: 'MyEntity2',
            paramsShape: undefined,
        }) {
            public override update(): void {
                // do nothing
            }
            public override createView() {
                this.dispatch(
                    new MyEvent({
                        entityInstance: this,
                        data: {
                            value: 5,
                        },
                    }),
                );
                return {
                    view: new Graphics().rect(0, 0, 20, 20).fill('red'),
                };
            }
        }
        const entityStore = new EntityStore({
            pixi: createMockPixi(),
            state: {},
            preregisteredEntities: [
                MyEntity,
                MyEntity2,
            ],
            assetLoader: new AssetLoader(),
        });

        const instance = await entityStore.addEntity(MyEntity);
        assert.instanceOf(instance, MyEntity);
        assert.instanceOf(instance, BaseEntity);
        assert.instanceOf(instance, ViewEntity);

        entityStore.listenTarget.listen(EntityDestroyEvent, () => {});
        entityStore.listenTarget.listen(MyEvent, (event) => {
            assert.tsType(event).matches<EntityEvent>();
        });
        // @ts-expect-error: invalid event to listen to
        entityStore.listenTarget.listen(Error, () => {});

        entityStore.listenTarget.listen(EntityDestroyEvent, () => {});
        entityStore.listenTarget.listen(MyEvent, (event) => {
            assert.tsType(event).matches<EntityEvent>();
        });
    });
    it('prevents identical keys', () => {
        const {defineEntity} = defineEntitySuite();

        class One extends defineEntity({
            key: 'key',
            paramsShape: undefined,
        }) {
            public override createView(): ViewCreation {
                return {
                    view: new Graphics(),
                };
            }
            public override update(): void {}
        }
        assert.throws(() => {
            class Two extends defineEntity({
                key: 'key',
                paramsShape: undefined,
            }) {
                public override createView(): ViewCreation {
                    return {
                        view: new Graphics({}),
                    };
                }
                public override update(): void {}
            }
        });
    });
    it('allows logic entity definition', async () => {
        const {defineLogicEntity, EntityStore} = defineEntitySuite();

        class MyLogicEntity extends defineLogicEntity({
            key: 'MyLogicEntity',
            paramsShape: undefined,
        }) {
            public override update(): void {
                // do nothing
            }
        }

        const entityStore = new EntityStore({
            pixi: createMockPixi(),
            state: {},
            preregisteredEntities: [MyLogicEntity],
            assetLoader: new AssetLoader(),
        });

        assert.tsType(MyLogicEntity.entityKey).equals<string>();
        assert.strictEquals(MyLogicEntity.entityKey, 'MyLogicEntity');
        const instance = await entityStore.addEntity(MyLogicEntity);

        assert.instanceOf(instance, MyLogicEntity);
        assert.instanceOf(instance, BaseEntity);
    });
    it('allows a view child to be destroyed', async () => {
        const {EntityStore, defineEntity} = defineEntitySuite();
        let updateCount = 0;

        class MyEntity extends defineEntity({
            key: 'MyEntity',
            paramsShape: undefined,
        }) {
            public override update(): void {
                updateCount++;
            }
            public override createView() {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('red'),
                };
            }
        }
        const entityStore = new EntityStore({
            pixi: createMockPixi(),
            state: {},
            assetLoader: new AssetLoader(),
        });

        MyEntity.paramsMap;

        const instance = await entityStore.addEntity(MyEntity);

        await entityStore.updateAllEntities();
        await entityStore.updateAllEntities();
        assert.strictEquals(updateCount, 2);

        instance.destroy();
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
