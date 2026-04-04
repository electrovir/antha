import {AnthaEngine} from '@antha/engine';
import {
    type AnthaInputBindingsState,
    AnyGamepad,
    createAnthaInputBindingsMod,
    createAnthaReadRawInputMod,
    InputDirection,
    type PlayersBindingAssignments,
    PredefinedGamepadBrand,
} from '@antha/input';
import {createAnthaPixiFpsMod} from '@antha/pixi-canvas';
import {createUtcFullDate} from 'date-vir';
import {type AnthaDemo} from '../demo.js';

export const inputBindingsDemo: AnthaDemo = {
    demoName: 'Input bindings',
    demoPathId: 'input-bindings',
    demoSortDate: createUtcFullDate('2026-04-03T11:00:00'),
    engine() {
        return new AnthaEngine({
            initState: {
                bindingAssignments: defaultBindings,
            } satisfies Partial<AnthaInputBindingsState>,
            mods: [
                createAnthaPixiFpsMod({
                    hideFps: true,
                }),
                createAnthaReadRawInputMod(),
                createAnthaInputBindingsMod({
                    debugActiveBindings: true,
                    debugBindingAssignments: true,
                }),
            ],
        });
    },
};

const defaultBindings: Readonly<PlayersBindingAssignments> = {
    '1': {
        jump: [
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
        left: [
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
        right: [
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
    },
};
