import {AnthaEngine, type ModExecuteParams} from '@antha/engine';
import {assert, assertWrap} from '@augment-vir/assert';
import {createArray} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {createTestSuite, emptyEntityUpdateParams, type TestModState} from './entity-store.mock.js';
import {createEntitySuite, type EntitySuiteOptions} from './entity-suite.js';

function createModHarness(options: Readonly<EntitySuiteOptions> = {}) {
    const suite = createTestSuite(options);
    const state: Partial<TestModState> = {
        ...suite.updateEntitiesMod.initState,
        canCreateStore: true,
    };
    const counts = {
        update: 0,
        render: 0,
    };

    class Counter extends suite.defineEntity({
        key: 'Counter',
    }) {
        public override update() {
            counts.update++;
        }

        public override render() {
            counts.render++;
        }
    }

    async function runMod(msSinceLastExecute: number) {
        await assertWrap.isDefined(suite.updateEntitiesMod.execute)({
            ...emptyEntityUpdateParams,
            state,
            msSinceLastExecute,
        } satisfies ModExecuteParams<any> as ModExecuteParams<TestModState>);
        return assertWrap.isDefined(state.entityStore);
    }

    return {
        state,
        counts,
        Counter,
        runMod,
    };
}

describe(createEntitySuite.name, () => {
    it('skips until a store can be created, then destroys it on cleanup', async () => {
        const {updateEntitiesMod} = createTestSuite();
        const engine = new AnthaEngine<TestModState>({
            mods: [
                updateEntitiesMod,
            ],
        });

        await engine.runSingleTick();
        const storeBeforeCreation = engine.state.entityStore;

        engine.state.canCreateStore = true;
        await engine.runSingleTick();
        const entityStore = assertWrap.isDefined(engine.state.entityStore);
        await engine.reset();

        assert.isUndefined(storeBeforeCreation);
        assert.isTrue(entityStore.isDestroyed);
    });

    it('cleans up without a store', async () => {
        const {updateEntitiesMod} = createTestSuite();
        const engine = new AnthaEngine<TestModState>({
            mods: [
                updateEntitiesMod,
            ],
        });

        await engine.runSingleTick();
        await engine.reset();

        assert.isUndefined(engine.state.entityStore);
    });

    it('rejects duplicate entity keys', () => {
        const {defineEntity} = createTestSuite();

        defineEntity({
            key: 'Duplicate',
        });

        assert.throws(
            () => {
                defineEntity({
                    key: 'Duplicate',
                });
            },
            {
                matchMessage:
                    "Entity key 'Duplicate' has already been attached to an entity class.",
            },
        );
    });

    it('names assets after their entity', () => {
        const {defineEntity, entityKeys} = createTestSuite();

        const Sprite = defineEntity({
            key: 'Sprite',
            assets: {
                image: {
                    maxProgress: 1,
                    load() {
                        return {
                            value: 'image',
                        };
                    },
                },
            },
        });

        assert.strictEquals(Sprite.assets.image.assetName, 'Sprite:image');
        assert.deepEquals(
            [...entityKeys],
            [
                'Sprite',
            ],
        );
    });

    it('steps once per step duration of elapsed time, carrying leftover time', async () => {
        const {runMod, counts, state, Counter} = createModHarness();
        const store = await runMod(0);
        await store.addEntity(Counter);

        await runMod(store.stepDuration.milliseconds * 1.5);
        const afterFirstRun = counts.update;
        await runMod(store.stepDuration.milliseconds * 0.6);
        const afterSecondRun = counts.update;
        await runMod(10_000);

        assert.deepEquals(
            {
                afterFirstRun,
                afterSecondRun,
                afterCatchUp: counts.update,
                renders: counts.render,
                hasStepTime: state.entityStore?.lastStepTime != undefined,
            },
            {
                afterFirstRun: 1,
                afterSecondRun: 2,
                afterCatchUp: 32,
                renders: 3,
                hasStepTime: true,
            },
        );
    });

    it('does not mark a step time when no step ran', async () => {
        const {runMod} = createModHarness();

        const store = await runMod(0);

        assert.isUndefined(store.lastStepTime);
    });

    it('honors disabled updates and renders', async () => {
        const {runMod, counts, Counter} = createModHarness({
            disableEntityRender: true,
            disableEntityUpdate: true,
        });
        const store = await runMod(0);
        await store.addEntity(Counter);

        await runMod(store.stepDuration.milliseconds * 3);

        assert.deepEquals(counts, {
            update: 0,
            render: 0,
        });
    });

    it('only collides classes that list each other', () => {
        const {defineEntity} = createTestSuite();
        const Loner = defineEntity({
            key: 'Loner',
        });
        const Wall = defineEntity({
            key: 'Wall',
        });
        const Ball = defineEntity({
            key: 'Ball',
            touchesSelf: true,
            touches: [
                Wall,
            ],
        });

        assert.deepEquals(
            {
                loner: Loner.collision.category,
                wall: Wall.collision.category,
                ball: Ball.collision.category,
                ballTouching: [...Ball.collision.touching],
                wallTouching: [...Wall.collision.touching],
            },
            {
                loner: 0n,
                wall: 2n,
                ball: 1n,
                ballTouching: [
                    Ball,
                    Wall,
                ],
                wallTouching: [
                    Ball,
                ],
            },
        );
    });

    it('rejects more touching classes than there are collision categories', () => {
        const {defineEntity} = createTestSuite();
        createArray(64, (index) => {
            return defineEntity({
                key: `Entity${index}`,
                touchesSelf: true,
            });
        });

        assert.throws(
            () => {
                defineEntity({
                    key: 'OneTooMany',
                    touchesSelf: true,
                });
            },
            {
                matchMessage:
                    "Entity class 'OneTooMany' cannot touch anything: an entity suite supports at most 64 classes that touch other classes.",
            },
        );
    });
});
