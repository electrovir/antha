import {AnthaEngine} from '@antha/engine';
import {createAnthaFpsMod} from '@antha/fps';
import {
    type AnthaInputBindingsModState,
    AnyGamepad,
    createAnthaInputBindingsMod,
    createAnthaReadRawInputMod,
    InputDirection,
    KnownInput,
    type PlayersBindingAssignments,
} from '@antha/input';
import {createUtcFullDate} from 'date-vir';
import {type AnthaDemo} from '../demo.js';

export const inputBindingsDemo: AnthaDemo = {
    demoName: 'Input bindings',
    demoPathId: 'input-bindings',
    demoSortDate: createUtcFullDate('2026-04-03T11:00:00'),
    engine() {
        return new AnthaEngine<AnthaInputBindingsModState>({
            initState: {
                bindingAssignments: defaultBindings,
            },
            mods: [
                createAnthaFpsMod({
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
                inputName: KnownInput.FaceAccept,
            },
        ],
        left: [
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
        right: [
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
    },
};
