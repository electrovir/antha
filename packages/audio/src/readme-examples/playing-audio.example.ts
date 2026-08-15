import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {type AnthaAudioState, createAnthaAudioMod} from '../index.js';

type GameState = AnthaAudioState & {
    shouldPlayJumpSound: boolean;
};

const engine = new AnthaEngine<GameState>({
    initState: {
        shouldPlayJumpSound: true,
    },
    mods: [
        createAnthaAudioMod(),
        defineAnthaMod<GameState>({
            modName: 'game-logic',
            execute({state}) {
                if (state.audioPlayer && state.shouldPlayJumpSound) {
                    state.shouldPlayJumpSound = false;
                    void state.audioPlayer.play({
                        sources: [
                            '/audio/jump.ogg',
                            '/audio/jump.mp3',
                        ],
                    });
                }
            },
        }),
    ],
});

engine.startLoop();
