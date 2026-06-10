import {defineAnthaMod} from '@antha/engine';
import {type AnthaEntity2dModState} from '@antha/entity-2d';
import {
    type AnthaInputBindingsModState,
    AnyGamepad,
    defaultMenuNavBindings,
    InputDirection,
    type PlayersBindingAssignments,
    PredefinedGamepadBrand,
} from '@antha/input';
import {type ClientId} from '@antha/multiplayer-core';
import {type GameInputAction, PlayerAction} from '../game-action.js';
import {type ExamplePauseMenuModState} from './pause-menu.mod.js';
import {type SaveStateModState} from './save-state.mod.js';

type ExampleGameState = AnthaEntity2dModState<
    {
        playerScores: Record<ClientId, number>;
    } & ExamplePauseMenuModState &
        AnthaInputBindingsModState<GameInputAction> &
        SaveStateModState
>;

const defaultBindings: Readonly<PlayersBindingAssignments<GameInputAction>> = {
    '1': {
        [PlayerAction.PlayerLeft]: [
            {
                deviceKey: AnyGamepad,
                direction: InputDirection.Positive,
                inputName: 'd-pad-left',
            },
            {
                deviceKey: 'keyboard',
                direction: InputDirection.Positive,
                inputName: 'button-KeyA',
            },
            {
                deviceKey: 'keyboard',
                direction: InputDirection.Positive,
                inputName: 'button-KeyJ',
            },
            {
                deviceKey: 'keyboard',
                direction: InputDirection.Positive,
                inputName: 'button-ArrowLeft',
            },
        ],
        [PlayerAction.PlayerRight]: [
            {
                deviceKey: AnyGamepad,
                direction: InputDirection.Positive,
                inputName: 'd-pad-right',
            },
            {
                deviceKey: 'keyboard',
                direction: InputDirection.Positive,
                inputName: 'button-KeyD',
            },
            {
                deviceKey: 'keyboard',
                direction: InputDirection.Positive,
                inputName: 'button-KeyL',
            },
            {
                deviceKey: 'keyboard',
                direction: InputDirection.Positive,
                inputName: 'button-ArrowRight',
            },
        ],
        [PlayerAction.PlayerUp]: [
            {
                deviceKey: AnyGamepad,
                direction: InputDirection.Positive,
                inputName: 'd-pad-up',
            },
            {
                deviceKey: 'keyboard',
                direction: InputDirection.Positive,
                inputName: 'button-KeyW',
            },
            {
                deviceKey: 'keyboard',
                direction: InputDirection.Positive,
                inputName: 'button-KeyI',
            },
            {
                deviceKey: 'keyboard',
                direction: InputDirection.Positive,
                inputName: 'button-ArrowUp',
            },
        ],
        [PlayerAction.PlayerDown]: [
            {
                deviceKey: AnyGamepad,
                direction: InputDirection.Positive,
                inputName: 'd-pad-down',
            },
            {
                deviceKey: 'keyboard',
                direction: InputDirection.Positive,
                inputName: 'button-KeyS',
            },
            {
                deviceKey: 'keyboard',
                direction: InputDirection.Positive,
                inputName: 'button-KeyK',
            },
            {
                deviceKey: 'keyboard',
                direction: InputDirection.Positive,
                inputName: 'button-ArrowDown',
            },
        ],
        [PlayerAction.PlayerShoot]: [
            {
                deviceKey: 'keyboard',
                direction: InputDirection.Positive,
                inputName: 'button-Space',
            },
            {
                deviceKey: AnyGamepad,
                direction: InputDirection.Positive,
                gamepadBrand: PredefinedGamepadBrand.Sony,
                inputName: 'X',
            },
            {
                deviceKey: AnyGamepad,
                direction: InputDirection.Positive,
                inputName: 'A',
            },
        ],

        ...defaultMenuNavBindings,
    },
};

export const exampleGameMod = defineAnthaMod<ExampleGameState>({
    modName: 'example-game',
    initState: {
        bindingAssignments: defaultBindings,
    },
    execute({state}) {
        if (!state.saveState) {
            return undefined;
        }
    },
});
