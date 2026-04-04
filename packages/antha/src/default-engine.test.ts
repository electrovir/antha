import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {createDefaultAnthaEngine} from './default-engine.js';

describe(createDefaultAnthaEngine.name, () => {
    it('creates an engine with default mods', () => {
        const {engine, defineEntity, defineLogicEntity, entityKeys} = createDefaultAnthaEngine();

        assert.isDefined(engine);
        assert.isDefined(defineEntity);
        assert.isDefined(defineLogicEntity);
        assert.isDefined(entityKeys);
        assert.isAbove(engine.currentMods.length, 0);
    });

    it('passes extra mods through', () => {
        const {engine} = createDefaultAnthaEngine({
            mods: [
                {
                    modName: 'extra',
                    execute() {},
                },
            ],
        });

        const extraMod = engine.currentMods.find((mod) => mod.modName === 'extra');
        assert.isDefined(extraMod);
    });
});
