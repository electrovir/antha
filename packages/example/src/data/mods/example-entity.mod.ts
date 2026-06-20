import {createAnthaEntityMod2d} from '@antha/entity-2d';

export type ExampleEntityState = {};

export const {
    defineEntity,
    defineLogicEntity,
    entityKeys,
    mod: exampleGameEntityMod,
} = createAnthaEntityMod2d();
