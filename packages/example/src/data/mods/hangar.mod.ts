import {defineAnthaMod, SkipExecution} from '@antha/engine';
import {HangarEntity} from '../entities/hangar.entity.js';
import {type FullExampleGameState} from '../game-state.js';
import {GameLocation} from '../save-state.js';

export const exampleHangarMod = defineAnthaMod<FullExampleGameState>({
    modName: 'example-hangar',
    initState: {},
    async execute({state}) {
        if (!state.entityStore) {
            return SkipExecution;
        }

        if (state.saveState?.location === GameLocation.Hangar) {
            if (!state.hangarEntity) {
                state.hangarEntity = await state.entityStore.addEntity(HangarEntity);
            }
        } else {
            state.hangarEntity = undefined;
        }

        return undefined;
    },
});
