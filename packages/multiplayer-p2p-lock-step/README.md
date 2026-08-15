# @antha/multiplayer-p2p-lock-step

This package provides a pre-built [Antha game engine](https://www.npmjs.com/package/@antha/engine) mod for peer-to-peer lock-step multiplayer state synchronization. Players submit actions, and the host distributes them as ordered frames so every client advances game state in the same order.

## Install

```sh
npm i @antha/multiplayer-p2p-lock-step
```

## Usage

<!-- example-link: src/readme-examples/creating-lock-step-game.example.ts -->

```TypeScript
import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {
    type AnthaMultiplayerP2pLockStepState,
    createAnthaMultiplayerP2pLockStepMod,
} from '@antha/multiplayer-p2p-lock-step';

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
```
