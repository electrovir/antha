import {defineAnthaMod} from '@antha/engine';
import {throttleLog} from '@antha/util';
import {type FullExampleGameState} from '../game-state.js';

export const exampleGameMod = defineAnthaMod<FullExampleGameState>({
    modName: 'example-game',
    initState: {},
    execute({state}) {
        if (!state.saveState || !state.navController) {
            throttleLog.info('1', {
                saveState: !!state.saveState,
                NavController: !!state.navController,
            });
            return undefined;
        }

        return undefined;
    },
});
