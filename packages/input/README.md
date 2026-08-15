# @antha/input

This package provides pre-built [Antha game engine](https://www.npmjs.com/package/@antha/engine) mods that read keyboard and gamepad input, then translate it into named player actions.

## Install

```sh
npm i @antha/input
```

## Usage

<!-- example-link: src/readme-examples/reading-input-bindings.example.ts -->

```TypeScript
import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {
    type AnthaInputBindingsModState,
    createAnthaInputBindingsMod,
    createAnthaReadRawInputMod,
    InputDirection,
} from '@antha/input';

enum GameAction {
    Jump = 'jump',
}

type GameState = AnthaInputBindingsModState<GameAction>;

const engine = new AnthaEngine<GameState>({
    initState: {
        bindingAssignments: {
            '1': {
                [GameAction.Jump]: [
                    {
                        deviceKey: 'keyboard',
                        direction: InputDirection.Positive,
                        inputName: 'button-Space',
                    },
                ],
            },
        },
    },
    mods: [
        createAnthaReadRawInputMod(),
        createAnthaInputBindingsMod<GameAction>(),
        defineAnthaMod<GameState>({
            modName: 'game-logic',
            execute({state}) {
                const jump = state.activeBindings?.['1']?.[GameAction.Jump];

                return jump?.value ? `Jump strength: ${jump.value}` : undefined;
            },
        }),
    ],
});

engine.startLoop();
```
