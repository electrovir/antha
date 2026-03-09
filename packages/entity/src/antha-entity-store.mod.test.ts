import {AnthaMockPixiMod} from '@antha/pixi-canvas';
import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {AnthaEngine} from 'antha';
import {Graphics} from 'pixi.js';
import {
    createAnthaEntityStoreMod,
    type AnthaEntityStoreModState,
} from './antha-entity-store.mod.js';
import {type ViewCreation} from './entity.js';

describe(createAnthaEntityStoreMod.name, () => {
    it('skips execution when pixi is not available', async () => {
        const {mod} = createAnthaEntityStoreMod({});

        const engine = new AnthaEngine({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();

        const state = engine.state as Partial<AnthaEntityStoreModState<Record<string, never>>>;

        assert.isUndefined(state.entityStore);
    });

    it('creates an entity store when pixi is available', async () => {
        const {mod} = createAnthaEntityStoreMod({});

        const engine = new AnthaEngine({
            mods: [
                AnthaMockPixiMod,
                mod,
            ],
        });

        await engine.runSingleTick();

        const state = engine.state as Partial<AnthaEntityStoreModState<Record<string, never>>>;

        assert.isDefined(state.entityStore);
    });

    it('defines entities that can be added to the store', async () => {
        const {mod, defineEntity} = createAnthaEntityStoreMod<{score: number}>({});

        class TestEntity extends defineEntity({
            key: 'TestEntity',
            paramsShape: undefined,
        }) {
            public override update(): void {
                /** No-op. */
            }

            public override createView(): ViewCreation {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('red'),
                };
            }
        }

        const engine = new AnthaEngine({
            mods: [
                AnthaMockPixiMod,
                mod,
            ],
        });

        await engine.runSingleTick();

        const state = engine.state as Partial<AnthaEntityStoreModState<{score: number}>>;

        assert.isDefined(state.entityStore);
        const instance = state.entityStore.addEntity(TestEntity);
        assert.instanceOf(instance, TestEntity);
    });

    it('cleans up entity store on cleanup', async () => {
        const {mod} = createAnthaEntityStoreMod({});

        const engine = new AnthaEngine({
            mods: [
                AnthaMockPixiMod,
                mod,
            ],
        });

        await engine.runSingleTick();

        const state = engine.state as Partial<AnthaEntityStoreModState<Record<string, never>>>;

        assert.isDefined(state.entityStore);

        await engine.reset();
    });

    it('initializes debugHitboxes from options', async () => {
        const {mod} = createAnthaEntityStoreMod({
            debug: true,
        });

        const engine = new AnthaEngine({
            mods: [
                AnthaMockPixiMod,
                mod,
            ],
        });

        await engine.runSingleTick();

        const state = engine.state as Partial<AnthaEntityStoreModState<Record<string, never>>>;

        assert.isTrue(state.debugHitboxes);
    });

    it('updates entities on subsequent ticks', async () => {
        const {mod, defineEntity} = createAnthaEntityStoreMod({});
        let updateCount = 0;

        class TickEntity extends defineEntity({
            key: 'TickEntity',
            paramsShape: undefined,
        }) {
            public override update(): void {
                updateCount++;
            }

            public override createView(): ViewCreation {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('green'),
                };
            }
        }

        const engine = new AnthaEngine({
            mods: [
                AnthaMockPixiMod,
                mod,
            ],
        });

        /** First tick creates the entity store. */
        await engine.runSingleTick();

        const state = engine.state as Partial<AnthaEntityStoreModState<Record<string, never>>>;

        assert.isDefined(state.entityStore);
        state.entityStore.addEntity(TickEntity);

        /** Second tick calls updateAllEntities. */
        await engine.runSingleTick();

        assert.strictEquals(updateCount, 1);
    });
});
