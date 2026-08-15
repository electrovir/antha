# @antha/audio

This package provides a pre-built [Antha game engine](https://www.npmjs.com/package/@antha/engine) mod for loading and playing audio in the browser.

## Install

```sh
npm i @antha/audio
```

## Usage

<!-- example-link: src/readme-examples/playing-audio.example.ts -->

```TypeScript
import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {type AnthaAudioState, createAnthaAudioMod} from '@antha/audio';

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
```
