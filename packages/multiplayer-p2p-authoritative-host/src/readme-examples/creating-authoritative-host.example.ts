import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {
    type AnthaMultiplayerP2pAuthoritativeHostState,
    createAnthaMultiplayerP2pAuthoritativeHostMod,
} from '../index.js';

type GameState = AnthaMultiplayerP2pAuthoritativeHostState<number, number>;

const engine = new AnthaEngine<GameState>({
    mods: [
        createAnthaMultiplayerP2pAuthoritativeHostMod<number, number>({
            gameId: 'counter-game',
            createInitialState() {
                return 0;
            },
            applyInput({input, state}) {
                return state + input;
            },
        }),
        defineAnthaMod<GameState>({
            modName: 'game-logic',
            execute({state}) {
                const controller = state.multiplayerP2pAuthoritativeHost?.multiplayerController;

                if (!controller) {
                    return;
                }
                if (!controller.isConnected()) {
                    controller.startSingleplayer();
                    controller.act(1);
                }

                return `Score: ${controller.getState()}`;
            },
        }),
    ],
});

engine.startLoop();
