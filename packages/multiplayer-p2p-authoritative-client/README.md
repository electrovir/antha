# @antha/multiplayer-p2p-authoritative-client

This package provides a pre-built [Antha game engine](https://www.npmjs.com/package/@antha/engine) mod for peer-to-peer multiplayer where each client is the authority over its own state. Each client sends its latest state at a fixed rate over an unreliable WebRTC channel. The room host relays every client's state to every other client. The state is whatever your game defines: this package does not apply it, buffer it, or smooth it. Each received state includes `smoothedReceivedAt`, a receive time without network jitter, to interpolate on, for example with `SnapshotInterpolator` from [`@antha/graphics-2d`](https://www.npmjs.com/package/@antha/graphics-2d). When the host's page stays hidden, it leaves the room so a member takes over as host, then joins again as a member once its page is shown.

## Install

```sh
npm i @antha/multiplayer-p2p-authoritative-client
```

## Usage

<!-- example-link: src/readme-examples/creating-authoritative-client-game.example.ts -->

```TypeScript
import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {
    type AnthaMultiplayerP2pAuthoritativeClientState,
    createAnthaMultiplayerP2pAuthoritativeClientMod,
} from '@antha/multiplayer-p2p-authoritative-client';

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
```
