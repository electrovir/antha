import {createAnthaEntityMod2d} from '@antha/entity-2d';
import {type EmptyObject} from 'type-fest';

export const {
    defineEntity,
    defineLogicEntity,
    entityKeys,
    mod: exampleGameEntityMod,
} = createAnthaEntityMod2d<EmptyObject>();
