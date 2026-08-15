import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {createAnthaFpsMod, type ShowCountersState} from '../index.js';

type GameState = ShowCountersState & {
    hasFpsStutter: boolean;
};

const engine = new AnthaEngine<GameState>({
    initState: {
        hasFpsStutter: false,
    },
    mods: [
        createAnthaFpsMod({
            debugFps: true,
        }),
        defineAnthaMod<GameState>({
            modName: 'game-logic',
            execute({state}) {
                state.hasFpsStutter = !!state.fpsStutters?.length;

                return state.hasFpsStutter ? 'Frame rate is low.' : undefined;
            },
        }),
    ],
});

engine.startLoop();
