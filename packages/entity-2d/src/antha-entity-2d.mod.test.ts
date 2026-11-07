import {AssetLoader, createAnthaAssetMod, type Asset} from '@antha/asset';
import {AnthaEngine, type ModExecuteParams} from '@antha/engine';
import {AnthaMockPixiMod, createMockPixi} from '@antha/graphics-2d';
import {assert, assertWrap} from '@augment-vir/assert';
import {awaitedForEach, createArray} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {
    createAnthaEntity2dSuite,
    type AnthaEntity2dModOptions,
    type AnthaEntity2dModState,
} from './antha-entity-2d.mod.js';
import {emptyEntityUpdateParams} from './entity-store-2d.mock.js';
import {BodyType, ShapeType, type EntityPhysicsDefinition} from './physics.js';

const ballPhysics = {
    type: BodyType.Dynamic,
    shapes: [
        {
            type: ShapeType.Circle,
            radius: 1,
        },
    ],
} as const satisfies EntityPhysicsDefinition;

/** Runs `updateEntitiesMod` directly so each run's elapsed time is exact. */
function createModHarness(options: Readonly<AnthaEntity2dModOptions> = {}) {
    const suite = createAnthaEntity2dSuite(options);
    const state: Partial<AnthaEntity2dModState> = {
        ...suite.updateEntitiesMod.initState,
        pixi: {
            pixiApplication: createMockPixi(),
        },
        assetLoader: new AssetLoader(),
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
        } satisfies ModExecuteParams<any> as ModExecuteParams<AnthaEntity2dModState>);
        return assertWrap.isDefined(state.entityStore);
    }

    return {
        suite,
        state,
        counts,
        Counter,
        runMod,
    };
}

describe(createAnthaEntity2dSuite.name, () => {
    it('skips execution when pixi is not available', async () => {
        const {updateEntitiesMod} = createAnthaEntity2dSuite({});

        const engine = new AnthaEngine<AnthaEntity2dModState<Record<string, never>>>({
            mods: [
                createAnthaAssetMod(),
                updateEntitiesMod,
            ],
        });

        await engine.runSingleTick();

        assert.isUndefined(engine.state.entityStore);
    });

    it('creates an entity store and destroys it on cleanup', async () => {
        const {updateEntitiesMod} = createAnthaEntity2dSuite({});

        const engine = new AnthaEngine<AnthaEntity2dModState<Record<string, never>>>({
            mods: [
                createAnthaAssetMod(),
                AnthaMockPixiMod,
                updateEntitiesMod,
            ],
        });

        await engine.runSingleTick();
        const entityStore = assertWrap.isDefined(engine.state.entityStore);
        await engine.reset();

        assert.isTrue(entityStore.isDestroyed);
    });

    it('rejects duplicate entity keys', () => {
        const {defineLogicEntity} = createAnthaEntity2dSuite({});

        defineLogicEntity({
            key: 'DuplicateEntity',
        });

        assert.throws(
            () => {
                defineLogicEntity({
                    key: 'DuplicateEntity',
                });
            },
            {
                matchMessage:
                    "Entity key 'DuplicateEntity' has already been attached to an entity class.",
            },
        );
    });

    it('names assets after their entity', () => {
        const {defineEntity} = createAnthaEntity2dSuite({});

        const image = {
            maxProgress: 1,
            load() {
                return {
                    value: 'image',
                };
            },
        };
        defineEntity({
            key: 'Sprite',
            assets: {
                image,
            },
        });

        assert.strictEquals((image as typeof image & Partial<Asset>).assetName, 'Sprite:image');
    });

    it('steps once per stepDuration of elapsed time, carrying leftover time', async () => {
        const {counts, Counter, runMod} = createModHarness({
            physics: {
                stepDuration: {
                    milliseconds: 10,
                },
            },
        });

        const entityStore = await runMod(0);
        await entityStore.addEntity(Counter);
        await runMod(25);
        const afterFirstRun = counts.update;
        await runMod(5);
        const afterSecondRun = counts.update;
        await runMod(10_000);

        assert.deepEquals(
            {
                afterFirstRun,
                afterSecondRun,
                afterLongGap: counts.update,
                renders: counts.render,
            },
            {
                afterFirstRun: 2,
                afterSecondRun: 3,
                /** Long gaps are capped instead of simulated in full. */
                afterLongGap: 28,
                renders: 3,
            },
        );
    });

    it('marks the last step time so renders blend from it', async () => {
        const {runMod, Counter} = createModHarness({
            physics: {
                stepDuration: {
                    milliseconds: 10,
                },
            },
        });

        const entityStore = await runMod(0);
        await entityStore.addEntity(Counter);
        const lastStepTimeBeforeSteps = entityStore.lastStepTime;
        await runMod(14);

        assert.isUndefined(lastStepTimeBeforeSteps);
        assert.isAbove(performance.now() - assertWrap.isDefined(entityStore.lastStepTime), 3);
    });

    it('honors disabled updates and renders, including changes to state', async () => {
        const {counts, Counter, runMod, state, suite} = createModHarness({
            disableEntityUpdate: true,
            disableEntityRender: true,
        });

        const entityStore = await runMod(0);
        await entityStore.addEntity(Counter);
        const stepMs = entityStore.stepMs;
        await runMod(stepMs);
        const bothDisabled = {
            ...counts,
        };

        state.disableEntityUpdate = false;
        await runMod(stepMs);
        const renderDisabled = {
            ...counts,
        };

        state.disableEntityRender = false;
        state.disableEntityUpdate = true;
        await runMod(stepMs);

        assert.deepEquals(
            {
                bothDisabled,
                renderDisabled,
                updateDisabled: counts,
                initState: suite.updateEntitiesMod.initState,
            },
            {
                bothDisabled: {
                    update: 0,
                    render: 0,
                },
                renderDisabled: {
                    update: 1,
                    render: 0,
                },
                updateDisabled: {
                    update: 1,
                    render: 1,
                },
                initState: {
                    disableEntityRender: true,
                    disableEntityUpdate: true,
                },
            },
        );
    });

    it('passes the engine and state to entity updates', async () => {
        const {defineLogicEntity, updateEntitiesMod} = createAnthaEntity2dSuite<{score: number}>(
            {},
        );
        const received: Partial<ModExecuteParams<AnthaEntity2dModState<{score: number}>>> = {};

        class ContextEntity extends defineLogicEntity({
            key: 'ContextEntity',
        }) {
            public override update({
                engine,
                state,
            }: Readonly<ModExecuteParams<AnthaEntity2dModState<{score: number}>>>) {
                received.engine = engine;
                received.state = state;
            }
        }

        const engine = new AnthaEngine<AnthaEntity2dModState<{score: number}>>({
            initState: {
                score: 42,
            },
            mods: [
                createAnthaAssetMod(),
                AnthaMockPixiMod,
                updateEntitiesMod,
            ],
        });

        await engine.runSingleTick();
        const entity = await assertWrap
            .isDefined(engine.state.entityStore)
            .addEntity(ContextEntity);
        await engine.state.entityStore?.updateAllEntities({
            ...emptyEntityUpdateParams,
            engine,
            state: engine.state,
        } satisfies ModExecuteParams<any> as ModExecuteParams<
            AnthaEntity2dModState<{score: number}>
        >);

        assert.deepEquals(
            {
                isSameEngine: received.engine === engine,
                score: received.state?.score,
                mass: entity.physics.getMass(),
            },
            {
                isSameEngine: true,
                score: 42,
                mass: 0,
            },
        );
        await engine.reset();
    });

    it('creates stores with the suite physics options', async () => {
        const suite = createAnthaEntity2dSuite({
            physics: {
                stepDuration: {
                    milliseconds: 20,
                },
            },
        });
        const store = await suite.createEntityStore({
            pixi: createMockPixi(),
            assetLoader: new AssetLoader(),
            state: {},
        });

        assert.strictEquals(store.stepMs, 20);
        store.destroy();
    });

    it('only collides classes that list each other', async () => {
        const {suite, runMod} = createModHarness();

        class Wall extends suite.defineEntity({
            key: 'Wall',
            physics: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Box,
                        width: 1,
                        height: 10,
                    },
                ],
            },
        }) {}

        class Ghost extends suite.defineEntity({
            key: 'Ghost',
            physics: ballPhysics,
        }) {}

        class Solid extends suite.defineEntity({
            key: 'Solid',
            physics: ballPhysics,
            touches: [
                Wall,
            ],
        }) {}

        const entityStore = await runMod(0);
        await entityStore.addEntity(Wall, {
            position: {
                x: 3,
                y: 0,
            },
        });
        const movingBodies = {
            ghost: await entityStore.addEntity(Ghost, {
                velocity: {
                    x: 10,
                    y: 0,
                },
            }),
            solid: await entityStore.addEntity(Solid, {
                velocity: {
                    x: 10,
                    y: 0,
                },
            }),
        };
        await awaitedForEach(
            createArray(60, () => undefined),
            async () => {
                await entityStore.updateAllEntities(emptyEntityUpdateParams);
            },
        );

        assert.deepEquals(
            {
                ghostPassed: movingBodies.ghost.physics.getPosition().x > 4,
                solidStopped: movingBodies.solid.physics.getPosition().x < 3,
            },
            {
                ghostPassed: true,
                solidStopped: true,
            },
        );
    });

    it('rejects more touching classes than Box2D has categories', () => {
        const {defineEntity} = createAnthaEntity2dSuite({});

        createArray(64, (index) => {
            return defineEntity({
                key: `Toucher${index}`,
                touchesSelf: true,
            });
        });

        assert.throws(
            () => {
                return defineEntity({
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
