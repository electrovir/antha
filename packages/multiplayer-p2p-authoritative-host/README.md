# @antha/multiplayer-p2p-authoritative-host

This package provides a pre-built [Antha game engine](https://www.npmjs.com/package/@antha/engine) mod for peer-to-peer multiplayer where the room host owns the canonical game state. Clients submit inputs to the host, and the host publishes updated state snapshots to the room.

## Install

```sh
npm i @antha/multiplayer-p2p-authoritative-host
```

## Usage

<!-- example-link: src/readme-examples/creating-authoritative-host.example.ts -->

```TypeScript
import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {
    type AnthaMultiplayerP2pAuthoritativeHostState,
    createAnthaMultiplayerP2pAuthoritativeHostMod,
} from '@antha/multiplayer-p2p-authoritative-host';

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
```
