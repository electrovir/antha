import {createAnthaAssetMod} from '@antha/asset';
import {AnthaEngine} from '@antha/engine';
import {createAnthaGraphics2dMod} from '@antha/graphics-2d';
import {
    type AnthaInputBindingsModState,
    AnyGamepad,
    createAnthaInputBindingsMod,
    createAnthaMenuNavMod,
    createAnthaReadRawInputMod,
    defaultMenuNavBindings,
    InputDirection,
    KnownInput,
    type PlayersBindingAssignments,
} from '@antha/input';
import {type GameInputAction, PlayerAction} from './game-action.js';
import {exampleGameEntityMod} from './mods/example-entity.mod.js';
import {exampleGameMod} from './mods/example-game.mod.js';
import {exampleHangarMod} from './mods/hangar.mod.js';
import {examplePauseMenuMod} from './mods/pause-menu.mod.js';
import {playerMod} from './mods/player.mod.js';
import {saveStateMod} from './mods/save-state.mod.js';

const defaultBindings: Readonly<PlayersBindingAssignments<GameInputAction>> = {
    '1': {
        [PlayerAction.PlayerLeft]: [
            {
                deviceKey: AnyGamepad,
                direction: InputDirection.Positive,
                inputName: KnownInput.DPadLeft,
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
                inputName: KnownInput.DPadRight,
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
                inputName: KnownInput.DPadUp,
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
                inputName: KnownInput.DPadDown,
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
                inputName: KnownInput.FaceAccept,
            },
        ],

        ...defaultMenuNavBindings,
    },
};

export function createExampleGame() {
    return new AnthaEngine<AnthaInputBindingsModState<GameInputAction>>({
        initState: {
            bindingAssignments: defaultBindings,
        },
        mods: [
            createAnthaAssetMod(),
            saveStateMod,
            exampleGameMod,
            examplePauseMenuMod,
            createAnthaGraphics2dMod({
                pixiOptions: {
                    background: 'black',
                },
            }),
            exampleGameEntityMod,
            exampleHangarMod,
            // createAnthaFpsMod(),
            createAnthaReadRawInputMod({
                // debugRawInputs: true,
            }),
            createAnthaInputBindingsMod({
                // debugActiveBindings: true,
            }),
            playerMod,
            createAnthaMenuNavMod({
                alwaysRequireFocused: true,
                allowWrapping: false,
            }),
        ],
    });
}
