# @antha/fps

This package provides a pre-built [Antha game engine](https://www.npmjs.com/package/@antha/engine) mod that displays the engine's current frames per second in the top-left corner of the page.

## Install

```sh
npm i @antha/fps
```

## Usage

<!-- example-link: src/readme-examples/measuring-fps.example.ts -->

```TypeScript
import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {createAnthaFpsMod, type ShowCountersState} from '@antha/fps';

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
```
