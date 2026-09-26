import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {
    type AnthaInputBindingsModState,
    createAnthaInputBindingsMod,
    createAnthaReadRawInputMod,
    InputDirection,
    PlayerPosition,
} from '../index.js';

enum GameAction {
    Jump = 'jump',
}

type GameState = AnthaInputBindingsModState<GameAction>;

const engine = new AnthaEngine<GameState>({
    initState: {
        bindingAssignments: {
            [PlayerPosition.One]: {
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
                const jump = state.activeBindings?.[PlayerPosition.One]?.[GameAction.Jump];

                return jump?.value ? `Jump strength: ${jump.value}` : undefined;
            },
        }),
    ],
});

engine.startLoop();
