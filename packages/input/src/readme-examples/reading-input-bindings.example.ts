import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {LocalPlayerPosition} from '@antha/util';
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
            [LocalPlayerPosition.One]: {
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
                const jump = state.activeBindings?.[LocalPlayerPosition.One]?.[GameAction.Jump];

                return jump?.value ? `Jump strength: ${jump.value}` : undefined;
            },
        }),
    ],
});

engine.startLoop();
