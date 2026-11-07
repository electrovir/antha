import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {defineShape} from 'object-shape-tester';
import {createTestStore, createTestSuite, type TestEntity} from './entity-store.mock.js';
import {BaseEntity, EntityEvent} from './entity.js';

describe(EntityEvent.name, () => {
    it('maintains the data type', () => {
        class ScoreEvent extends EntityEvent<{score: number}> {}

        const eventInstance = new ScoreEvent({
            data: {
                score: 1,
            },
            entityInstance: {} as BaseEntity,
        });

        assert.tsType(eventInstance.detail.data).equals<{
            score: number;
        }>();
    });
});

describe(BaseEntity.name, () => {
    it('creates bodies from static or param-based definitions and collision filters', async () => {
        const {defineEntity} = createTestSuite();
        const Fixed = defineEntity({
            key: 'Fixed',
            physics: {
                size: 1,
            },
            touchesSelf: true,
        });
        const Sized = defineEntity({
            key: 'Sized',
            paramsShape: defineShape({
                size: 0,
            }),
            physics(params) {
                return {
                    size: params.size,
                };
            },
            touches: [
                Fixed,
            ],
        });
        const store = createTestStore();

        const fixed = await store.addEntity(Fixed);
        const sized = await store.addEntity(Sized, {
            params: {
                size: 3,
            },
        });

        assert.deepEquals(
            {
                fixed: fixed.physics.creation,
                sized: sized.physics.creation,
            },
            {
                fixed: {
                    definition: {
                        size: 1,
                    },
                    filter: {
                        category: 1n,
                        mask: 3n,
                    },
                    entityId: 1,
                },
                sized: {
                    definition: {
                        size: 3,
                    },
                    filter: {
                        category: 2n,
                        mask: 1n,
                    },
                    entityId: 2,
                },
            },
        );
    });

    it('deserializes params against the params shape', () => {
        const {defineEntity} = createTestSuite();
        const WithParams = defineEntity({
            key: 'WithParams',
            paramsShape: defineShape({
                name: '',
            }),
        });
        const WithoutParams = defineEntity({
            key: 'WithoutParams',
        });

        assert.deepEquals(WithParams.deserialize('{"name":"a"}'), {
            name: 'a',
        });
        assert.isUndefined(WithoutParams.deserialize(undefined));
        assert.throws(() => WithParams.deserialize('{"name":1}'));
        assert.throws(() => WithoutParams.deserialize('{}'));
    });

    it('loads its assets', async () => {
        const {defineEntity} = createTestSuite();
        const WithAssets = defineEntity({
            key: 'WithAssets',
            assets: {
                image: {
                    maxProgress: 1,
                    load({incrementProgressCallback}) {
                        incrementProgressCallback();
                        return {
                            value: 'image value',
                        };
                    },
                },
            },
        });
        const WithoutAssets = defineEntity({
            key: 'WithoutAssets',
        });
        const store = createTestStore();

        const withAssets = await store.addEntity(WithAssets);
        const withoutAssets = await store.addEntity(WithoutAssets);

        assert.strictEquals(await withAssets.getAsset.image(), 'image value');
        assert.deepEquals(withoutAssets.getAsset, {});
    });

    it('adds entities through other entities', async () => {
        const {defineEntity} = createTestSuite();
        const Child = defineEntity({
            key: 'Child',
        });
        const Parent = defineEntity({
            key: 'Parent',
        });
        const store = createTestStore();
        const parent = await store.addEntity(Parent);

        const child = await parent.addEntity(Child);
        parent.destroy();

        assert.isTrue(store.currentEntityInstances.has(child));
        assert.isTrue(parent.abortSignal.aborted);
        await assert.throws(parent.addEntity(Child), {
            matchMessage: 'Cannot add entity through destroyed entity.',
        });
    });

    it('can be immediately destroyed more than once', async () => {
        const {defineEntity} = createTestSuite();
        const Plain = defineEntity({
            key: 'Plain',
        });
        const store = createTestStore();
        const entity: TestEntity = await store.addEntity(Plain);

        entity.immediatelyDestroy();
        entity.immediatelyDestroy();

        assert.deepEquals(
            {
                viewDestroyCount: entity.viewDestroyCount,
                hasStore: 'entityStore' in entity,
                serialized: entity.serialize(),
            },
            {
                viewDestroyCount: 2,
                hasStore: false,
                serialized: undefined,
            },
        );
    });

    it('does nothing by default in its hooks', async () => {
        class Bare extends BaseEntity {}
        const store = createTestStore();

        const entity = await store.addEntity(Bare as any);

        assert.isUndefined(await entity.update({} as any));
        assert.isUndefined(await entity.render({} as any));
        assert.isUndefined(await entity.contactStart(entity));
        assert.isUndefined(await entity.contactEnd(entity));
        entity.immediatelyDestroy();
    });
});
