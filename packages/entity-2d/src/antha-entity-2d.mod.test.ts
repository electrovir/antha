import {createAnthaAssetMod} from '@antha/asset';
import {AnthaEngine, type ModExecuteParams} from '@antha/engine';
import {AnthaMockPixiMod} from '@antha/graphics-2d';
import {assert, assertWrap} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {Graphics} from 'pixi.js';
import {defineTypedCustomEvent} from 'typed-event-target';
import {createAnthaEntity2dSuite, type AnthaEntity2dModState} from './antha-entity-2d.mod.js';
import {type ViewCreation2d} from './entity.js';

function createTickEntity({
    defineEntity,
    key,
    onRender,
    onUpdate,
}: Readonly<{
    defineEntity: ReturnType<typeof createAnthaEntity2dSuite>['defineEntity'];
    key: string;
    onRender?: (() => void) | undefined;
    onUpdate: () => void;
}>) {
    return class TickEntity extends defineEntity({
        key,
        paramsShape: undefined,
    }) {
        public override update(): void {
            onUpdate();
        }

        public override render(): void {
            onRender?.();
        }

        public override createView(): ViewCreation2d {
            return {
                view: new Graphics().rect(0, 0, 10, 10).fill('green'),
            };
        }
    };
}

class TestSimulationEvent extends defineTypedCustomEvent<number>()('test-simulation') {}

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

    it('rejects duplicate entity keys', () => {
        const {defineLogicEntity} = createAnthaEntity2dSuite({});

        defineLogicEntity({
            key: 'DuplicateEntity',
            paramsShape: undefined,
        });

        assert.throws(
            () => {
                defineLogicEntity({
                    key: 'DuplicateEntity',
                    paramsShape: undefined,
                });
            },
            {
                matchMessage:
                    "Entity key 'DuplicateEntity' has already been attached to an entity class.",
            },
        );
    });

    it('creates an entity store when pixi is available', async () => {
        const {updateEntitiesMod} = createAnthaEntity2dSuite({});

        const engine = new AnthaEngine<AnthaEntity2dModState<Record<string, never>>>({
            mods: [
                createAnthaAssetMod(),
                AnthaMockPixiMod,
                updateEntitiesMod,
            ],
        });

        await engine.runSingleTick();

        assert.isDefined(engine.state.entityStore);
    });

    it('defines entities that can be added to the store', async () => {
        const {defineEntity, updateEntitiesMod} = createAnthaEntity2dSuite<{score: number}>({});

        class TestEntity extends defineEntity({
            key: 'TestEntity',
            paramsShape: undefined,
        }) {
            public override update(): void {
                /** No-op. */
            }

            public override createView(): ViewCreation2d {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('red'),
                };
            }
        }

        const engine = new AnthaEngine<AnthaEntity2dModState<{score: number}>>({
            mods: [
                createAnthaAssetMod(),
                AnthaMockPixiMod,
                updateEntitiesMod,
            ],
        });

        await engine.runSingleTick();

        assert.isDefined(engine.state.entityStore);
        const instance = await engine.state.entityStore.addEntity(TestEntity);
        assert.instanceOf(instance, TestEntity);
    });

    it('cleans up entity store on cleanup', async () => {
        const {updateEntitiesMod} = createAnthaEntity2dSuite({});

        const engine = new AnthaEngine<AnthaEntity2dModState<Record<string, never>>>({
            mods: [
                createAnthaAssetMod(),
                AnthaMockPixiMod,
                updateEntitiesMod,
            ],
        });

        await engine.runSingleTick();

        assert.isDefined(engine.state.entityStore);

        await engine.reset();
    });

    it('initializes showHitboxDebug from options', async () => {
        const {updateEntitiesMod} = createAnthaEntity2dSuite({
            debug: true,
        });

        const engine = new AnthaEngine<AnthaEntity2dModState<Record<string, never>>>({
            mods: [
                createAnthaAssetMod(),
                AnthaMockPixiMod,
                updateEntitiesMod,
            ],
        });

        await engine.runSingleTick();

        assert.isTrue(engine.state.showHitboxDebug);
    });

    it('updates entity data and rendering on subsequent ticks', async () => {
        const {defineEntity, updateEntitiesMod} = createAnthaEntity2dSuite({});
        let renderCount = 0;
        let updateCount = 0;
        const TickEntity = createTickEntity({
            defineEntity,
            key: 'TickEntity',
            onRender() {
                renderCount++;
            },
            onUpdate() {
                updateCount++;
            },
        });

        const engine = new AnthaEngine<AnthaEntity2dModState<Record<string, never>>>({
            mods: [
                createAnthaAssetMod(),
                AnthaMockPixiMod,
                updateEntitiesMod,
            ],
        });

        /** First tick creates the entity store. */
        await engine.runSingleTick();

        assert.isDefined(engine.state.entityStore);
        await engine.state.entityStore.addEntity(TickEntity);

        /** Second tick calls updateAllEntities. */
        await engine.runSingleTick();

        assert.deepEquals(
            {
                renderCount,
                updateCount,
            },
            {
                renderCount: 1,
                updateCount: 1,
            },
        );
    });

    it('updates entity data and rendering from the same trigger', async () => {
        const {defineEntity, updateEntitiesMod} = createAnthaEntity2dSuite({
            updateTrigger: {
                event: TestSimulationEvent,
                executeImmediately: true,
            },
        });
        let renderCount = 0;
        let updateCount = 0;

        const SeparateEntity = createTickEntity({
            defineEntity,
            key: 'SeparateEntity',
            onRender() {
                renderCount++;
            },
            onUpdate() {
                updateCount++;
            },
        });

        const engine = new AnthaEngine<AnthaEntity2dModState<Record<string, never>>>({
            mods: [
                createAnthaAssetMod(),
                AnthaMockPixiMod,
                updateEntitiesMod,
            ],
        });

        await engine.runSingleTick();
        await assertWrap.isDefined(engine.state.entityStore).addEntity(SeparateEntity);

        engine.dispatch(
            new TestSimulationEvent({
                detail: 1,
            }),
        );
        await engine.runSingleTick();

        assert.deepEquals(
            {
                renderCount,
                updateCount,
            },
            {
                renderCount: 1,
                updateCount: 1,
            },
        );
    });

    it('does not update entities when all updates are disabled', async () => {
        const {defineEntity, updateEntitiesMod} = createAnthaEntity2dSuite({
            disableEntityUpdate: true,
            disableEntityRender: true,
        });
        let renderCount = 0;
        let updateCount = 0;
        const IdleEntity = createTickEntity({
            defineEntity,
            key: 'IdleEntity',
            onRender() {
                renderCount++;
            },
            onUpdate() {
                updateCount++;
            },
        });

        const engine = new AnthaEngine<AnthaEntity2dModState<Record<string, never>>>({
            mods: [
                createAnthaAssetMod(),
                AnthaMockPixiMod,
                updateEntitiesMod,
            ],
        });

        await engine.runSingleTick();
        await assertWrap.isDefined(engine.state.entityStore).addEntity(IdleEntity);
        await engine.runSingleTick();

        assert.deepEquals(
            {
                renderCount,
                updateCount,
            },
            {
                renderCount: 0,
                updateCount: 0,
            },
        );
    });

    it('only renders entities when data updates are disabled', async () => {
        const {defineEntity, updateEntitiesMod} = createAnthaEntity2dSuite({
            disableEntityUpdate: true,
        });
        let renderCount = 0;
        let updateCount = 0;
        const RenderEntity = createTickEntity({
            defineEntity,
            key: 'RenderEntity',
            onRender() {
                renderCount++;
            },
            onUpdate() {
                updateCount++;
            },
        });

        const engine = new AnthaEngine<AnthaEntity2dModState<Record<string, never>>>({
            mods: [
                createAnthaAssetMod(),
                AnthaMockPixiMod,
                updateEntitiesMod,
            ],
        });

        await engine.runSingleTick();
        await assertWrap.isDefined(engine.state.entityStore).addEntity(RenderEntity);
        await engine.runSingleTick();

        assert.deepEquals(
            {
                renderCount,
                updateCount,
            },
            {
                renderCount: 1,
                updateCount: 0,
            },
        );
    });

    it('only updates entity data when rendering is disabled', async () => {
        const {defineEntity, updateEntitiesMod} = createAnthaEntity2dSuite({
            disableEntityRender: true,
        });
        let renderCount = 0;
        let updateCount = 0;
        const DataEntity = createTickEntity({
            defineEntity,
            key: 'DataEntity',
            onRender() {
                renderCount++;
            },
            onUpdate() {
                updateCount++;
            },
        });

        const engine = new AnthaEngine<AnthaEntity2dModState<Record<string, never>>>({
            mods: [
                createAnthaAssetMod(),
                AnthaMockPixiMod,
                updateEntitiesMod,
            ],
        });

        await engine.runSingleTick();
        await assertWrap.isDefined(engine.state.entityStore).addEntity(DataEntity);
        await engine.runSingleTick();

        assert.deepEquals(
            {
                renderCount,
                updateCount,
            },
            {
                renderCount: 0,
                updateCount: 1,
            },
        );
    });

    it('passes the engine and state to entity updates', async () => {
        const {defineLogicEntity, updateEntitiesMod} = createAnthaEntity2dSuite<{score: number}>(
            {},
        );
        let receivedEngine: undefined | AnthaEngine<AnthaEntity2dModState<{score: number}>>;
        let receivedState: undefined | Partial<AnthaEntity2dModState<{score: number}>>;

        class ContextEntity extends defineLogicEntity({
            key: 'ContextEntity',
            paramsShape: undefined,
        }) {
            public override update({
                engine,
                state,
            }: Readonly<ModExecuteParams<AnthaEntity2dModState<{score: number}>>>) {
                receivedEngine = engine;
                receivedState = state;
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

        await assertWrap.isDefined(engine.state.entityStore).addEntity(ContextEntity);

        await engine.runSingleTick();

        assert.strictEquals(receivedEngine, engine);
        assert.strictEquals(receivedState, engine.state);
        assert.strictEquals(receivedState.score, 42);
    });

    it('independently disables entity updates and rendering', async () => {
        const {defineEntity, updateEntitiesMod} = createAnthaEntity2dSuite({});
        let renderCount = 0;
        let updateCount = 0;
        const TickEntity = createTickEntity({
            defineEntity,
            key: 'DisabledTickEntity',
            onRender() {
                renderCount++;
            },
            onUpdate() {
                updateCount++;
            },
        });

        const engine = new AnthaEngine<AnthaEntity2dModState<Record<string, never>>>({
            mods: [
                createAnthaAssetMod(),
                AnthaMockPixiMod,
                updateEntitiesMod,
            ],
        });

        await engine.runSingleTick();

        assert.isDefined(engine.state.entityStore);
        const entityStore = engine.state.entityStore;
        await entityStore.addEntity(TickEntity);
        engine.state.disableEntityUpdate = true;

        await engine.runSingleTick();

        assert.strictEquals(engine.state.entityStore, entityStore);

        assert.deepEquals(
            {
                renderCount,
                updateCount,
            },
            {
                renderCount: 1,
                updateCount: 0,
            },
        );

        engine.state.disableEntityUpdate = false;
        engine.state.disableEntityRender = true;

        await engine.runSingleTick();

        assert.deepEquals(
            {
                renderCount,
                updateCount,
            },
            {
                renderCount: 1,
                updateCount: 1,
            },
        );
    });
});
