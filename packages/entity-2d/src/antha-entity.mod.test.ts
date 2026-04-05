import {AnthaEngine} from '@antha/engine';
import {AnthaMockPixiMod} from '@antha/graphics-2d';
import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {Graphics} from 'pixi.js';
import {createAnthaEntityMod2d, type AnthaEntity2dModState} from './antha-entity.mod.js';
import {type ViewCreation2d} from './entity.js';

describe(createAnthaEntityMod2d.name, () => {
    it('skips execution when pixi is not available', async () => {
        const {mod} = createAnthaEntityMod2d({});

        const engine = new AnthaEngine<AnthaEntity2dModState<Record<string, never>>>({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();

        assert.isUndefined(engine.state.entityStore);
    });

    it('creates an entity store when pixi is available', async () => {
        const {mod} = createAnthaEntityMod2d({});

        const engine = new AnthaEngine<AnthaEntity2dModState<Record<string, never>>>({
            mods: [
                AnthaMockPixiMod,
                mod,
            ],
        });

        await engine.runSingleTick();

        assert.isDefined(engine.state.entityStore);
    });

    it('defines entities that can be added to the store', async () => {
        const {mod, defineEntity} = createAnthaEntityMod2d<{score: number}>({});

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
                AnthaMockPixiMod,
                mod,
            ],
        });

        await engine.runSingleTick();

        assert.isDefined(engine.state.entityStore);
        const instance = await engine.state.entityStore.addEntity(TestEntity);
        assert.instanceOf(instance, TestEntity);
    });

    it('cleans up entity store on cleanup', async () => {
        const {mod} = createAnthaEntityMod2d({});

        const engine = new AnthaEngine<AnthaEntity2dModState<Record<string, never>>>({
            mods: [
                AnthaMockPixiMod,
                mod,
            ],
        });

        await engine.runSingleTick();

        assert.isDefined(engine.state.entityStore);

        await engine.reset();
    });

    it('initializes debugHitboxes from options', async () => {
        const {mod} = createAnthaEntityMod2d({
            debug: true,
        });

        const engine = new AnthaEngine<AnthaEntity2dModState<Record<string, never>>>({
            mods: [
                AnthaMockPixiMod,
                mod,
            ],
        });

        await engine.runSingleTick();

        assert.isTrue(engine.state.debugHitboxes);
    });

    it('updates entities on subsequent ticks', async () => {
        const {mod, defineEntity} = createAnthaEntityMod2d({});
        let updateCount = 0;

        class TickEntity extends defineEntity({
            key: 'TickEntity',
            paramsShape: undefined,
        }) {
            public override update(): void {
                updateCount++;
            }

            public override createView(): ViewCreation2d {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('green'),
                };
            }
        }

        const engine = new AnthaEngine<AnthaEntity2dModState<Record<string, never>>>({
            mods: [
                AnthaMockPixiMod,
                mod,
            ],
        });

        /** First tick creates the entity store. */
        await engine.runSingleTick();

        assert.isDefined(engine.state.entityStore);
        await engine.state.entityStore.addEntity(TickEntity);

        /** Second tick calls updateAllEntities. */
        await engine.runSingleTick();

        assert.strictEquals(updateCount, 1);
    });
});
