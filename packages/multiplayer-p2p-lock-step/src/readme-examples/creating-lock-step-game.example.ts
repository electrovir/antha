import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {
    type AnthaMultiplayerP2pLockStepState,
    createAnthaMultiplayerP2pLockStepMod,
} from '../index.js';

type GameState = AnthaMultiplayerP2pLockStepState<string>;

const engine = new AnthaEngine<GameState>({
    mods: [
        createAnthaMultiplayerP2pLockStepMod<string>({
            gameId: 'my-game',
        }),
        defineAnthaMod<GameState>({
            modName: 'game-logic',
            execute({state}) {
                const controller = state.multiplayerP2pLockStep?.multiplayerController;

                if (!controller) {
                    return;
                }
                if (!controller.isConnected()) {
                    controller.startSingleplayer();
                    controller.act('move-left');
                }

                return `Network FPS: ${controller.getFps()}`;
            },
        }),
    ],
});

engine.startLoop();
