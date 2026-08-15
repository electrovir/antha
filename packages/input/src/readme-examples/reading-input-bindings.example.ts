import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {
    type AnthaInputBindingsModState,
    createAnthaInputBindingsMod,
    createAnthaReadRawInputMod,
    InputDirection,
} from '../index.js';

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
