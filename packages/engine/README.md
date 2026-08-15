# @antha/engine

The Antha game engine (for the web), where everything is a mod! This engine core package only includes a lightweight framework for flexibly defining, inserting, and running the engine mods.

-   Demo: https://electrovir.github.io/antha/demo

## Install

```sh
npm i @antha/engine
```

## Usage

<!-- example-link: src/readme-examples/creating-engine.example.ts -->

```TypeScript
import {AnthaEngine, defineAnthaMod} from '@antha/engine';

const engine = new AnthaEngine<{
    count: number;
}>({
    mods: [
        defineAnthaMod<{
            count: number;
        }>({
            modName: 'counter',
            execute({state}) {
                state.count = (state.count ?? 0) + 1;

                return `Count: ${state.count}`;
            },
        }),
    ],
});

engine.startLoop();
```
