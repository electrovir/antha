import {describe, itCases} from '@augment-vir/test';
import {PredefinedGamepadBrand, PredefinedGamepadModel} from '../gamepad-model.js';
import {InputDirection} from '../input-direction.js';
import {KnownInput} from '../known-input.js';
import {StickLUpIcon, StickLVerticalIcon} from './common-icons.js';
import {getGamepadInputIcons, getGamepadStickIcon} from './gamepad-model-icon-map.js';
import {
    Playstation4ButtonShareIcon,
    Playstation5ButtonCreateIcon,
    PlaystationButtonCrossIcon,
} from './playstation-icons.js';
import {XboxButtonViewIcon} from './xbox-icons.js';

describe(getGamepadInputIcons.name, () => {
    itCases(getGamepadInputIcons, [
        {
            it: 'uses a model override',
            input: {
                gamepadModel: PredefinedGamepadModel.PlaystationDualShock4,
                gamepadBrand: PredefinedGamepadBrand.Sony,
                input: KnownInput.Select,
            },
            expect: [
                Playstation4ButtonShareIcon,
            ],
        },
        {
            it: "uses the model's icon set for inputs it does not override",
            input: {
                gamepadModel: PredefinedGamepadModel.PlaystationDualSense,
                gamepadBrand: undefined,
                input: KnownInput.FaceAccept,
            },
            expect: [
                PlaystationButtonCrossIcon,
            ],
        },
        {
            it: "uses the brand's newest model for an unknown model",
            input: {
                gamepadModel: 'not a real model',
                gamepadBrand: PredefinedGamepadBrand.Sony,
                input: KnownInput.Select,
            },
            expect: [
                Playstation5ButtonCreateIcon,
            ],
        },
        {
            it: 'uses the newest Xbox for an unknown brand',
            input: {
                gamepadModel: undefined,
                gamepadBrand: 'not a real brand',
                input: KnownInput.Select,
            },
            expect: [
                XboxButtonViewIcon,
            ],
        },
    ]);
    itCases(
        (input: Parameters<typeof getGamepadInputIcons>[0]) => getGamepadInputIcons(input).length,
        [
            {
                it: 'finds nothing for an input the gamepad lacks',
                input: {
                    gamepadModel: PredefinedGamepadModel.XboxWireless,
                    gamepadBrand: PredefinedGamepadBrand.Microsoft,
                    input: KnownInput.TouchPad,
                },
                expect: 0,
            },
        ],
    );
});

describe(getGamepadStickIcon.name, () => {
    itCases(getGamepadStickIcon, [
        {
            it: 'finds one direction',
            input: {
                gamepadModel: PredefinedGamepadModel.XboxWireless,
                gamepadBrand: PredefinedGamepadBrand.Microsoft,
                input: KnownInput.LeftStickY,
                direction: InputDirection.Negative,
            },
            expect: StickLUpIcon,
        },
        {
            it: 'finds the whole axis for a flat direction',
            input: {
                gamepadModel: PredefinedGamepadModel.XboxWireless,
                gamepadBrand: PredefinedGamepadBrand.Microsoft,
                input: KnownInput.LeftStickY,
                direction: InputDirection.Flat,
            },
            expect: StickLVerticalIcon,
        },
    ]);
});
