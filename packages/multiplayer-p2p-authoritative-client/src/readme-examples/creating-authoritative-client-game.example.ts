import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {
    type AnthaMultiplayerP2pAuthoritativeClientState,
    createAnthaMultiplayerP2pAuthoritativeClientMod,
} from '../index.js';

type PlayerState = {
    x: number;
    y: number;
};

type GameState = AnthaMultiplayerP2pAuthoritativeClientState<PlayerState> & {
    localPlayer: PlayerState;
};

const engine = new AnthaEngine<Partial<GameState>>({
    mods: [
        createAnthaMultiplayerP2pAuthoritativeClientMod<PlayerState, GameState>({
            gameId: 'my-game',
            createLocalState({state}) {
                return state.localPlayer;
            },
        }),
        defineAnthaMod<GameState>({
            modName: 'game-logic',
            execute({state}) {
                const controller = state.multiplayerP2pAuthoritativeClient?.multiplayerController;

                if (!controller) {
                    return;
                }

                return `Remote players: ${Object.keys(controller.remoteClientStates).length}`;
            },
        }),
    ],
});

engine.startLoop();
