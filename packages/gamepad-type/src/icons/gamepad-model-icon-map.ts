import {check} from '@augment-vir/assert';
import {type ViraIconSvg} from 'vira';
import {PredefinedGamepadBrand, PredefinedGamepadModel} from '../gamepad-model.js';
import {type InputDirection} from '../input-direction.js';
import {KnownInput} from '../known-input.js';
import {ButtonBackIcon, ButtonStartIcon} from './common-icons.js';
import {
    GamepadIconSet,
    gamepadIconSetInputIcons,
    gamepadIconSetStickIcons,
    type GamepadStickInput,
} from './gamepad-icon-map.js';
import {
    Playstation3ButtonSelectIcon,
    Playstation3ButtonStartIcon,
    Playstation4ButtonOptionsIcon,
    Playstation4ButtonShareIcon,
    Playstation5ButtonCreateIcon,
    Playstation5ButtonOptionsIcon,
} from './playstation-icons.js';
import {XboxButtonMenuIcon, XboxButtonViewIcon} from './xbox-icons.js';

/**
 * The newest {@link PredefinedGamepadModel} of each {@link PredefinedGamepadBrand}, whose icons are
 * used when only the brand is known.
 *
 * @category Icons
 */
export const gamepadBrandLatestModels: Readonly<
    Record<PredefinedGamepadBrand, PredefinedGamepadModel>
> = {
    [PredefinedGamepadBrand.Microsoft]: PredefinedGamepadModel.XboxWireless,
    [PredefinedGamepadBrand.Nintendo]: PredefinedGamepadModel.SwitchPro,
    [PredefinedGamepadBrand.Sony]: PredefinedGamepadModel.PlaystationDualSense,
    [PredefinedGamepadBrand.Valve]: PredefinedGamepadModel.SteamDeck,
};

/**
 * The {@link GamepadIconSet} used for each {@link PredefinedGamepadModel}, plus the icons for inputs
 * whose look differs between models of the same brand (like the PlayStation Select button being
 * Select, Share, or Create). Inputs not overridden use the icon set's icons.
 *
 * @category Icons
 */
export const gamepadModelIcons: Readonly<
    Record<
        PredefinedGamepadModel,
        Readonly<{
            iconSet: GamepadIconSet;
            inputIcons?:
                | Readonly<Partial<Record<KnownInput, ReadonlyArray<ViraIconSvg>>>>
                | undefined;
        }>
    >
> = {
    [PredefinedGamepadModel.SwitchPro]: {
        iconSet: GamepadIconSet.NintendoSwitch,
    },
    [PredefinedGamepadModel.PlaystationDualShock]: {
        iconSet: GamepadIconSet.PlayStation,
        inputIcons: {
            [KnownInput.Select]: [
                Playstation3ButtonSelectIcon,
            ],
            [KnownInput.Start]: [
                Playstation3ButtonStartIcon,
            ],
        },
    },
    [PredefinedGamepadModel.PlaystationDualShock4]: {
        iconSet: GamepadIconSet.PlayStation,
        inputIcons: {
            [KnownInput.Select]: [
                Playstation4ButtonShareIcon,
            ],
            [KnownInput.Start]: [
                Playstation4ButtonOptionsIcon,
            ],
        },
    },
    [PredefinedGamepadModel.PlaystationDualSense]: {
        iconSet: GamepadIconSet.PlayStation,
        inputIcons: {
            [KnownInput.Select]: [
                Playstation5ButtonCreateIcon,
            ],
            [KnownInput.Start]: [
                Playstation5ButtonOptionsIcon,
            ],
        },
    },
    [PredefinedGamepadModel.SteamDeck]: {
        iconSet: GamepadIconSet.SteamDeck,
    },
    [PredefinedGamepadModel.Xbox360]: {
        iconSet: GamepadIconSet.Xbox,
        inputIcons: {
            [KnownInput.Select]: [
                ButtonBackIcon,
            ],
            [KnownInput.Start]: [
                ButtonStartIcon,
            ],
        },
    },
    [PredefinedGamepadModel.XboxWireless]: {
        iconSet: GamepadIconSet.Xbox,
        inputIcons: {
            [KnownInput.Select]: [
                XboxButtonViewIcon,
            ],
            [KnownInput.Start]: [
                XboxButtonMenuIcon,
            ],
        },
    },
};

function getIconModel({
    gamepadModel,
    gamepadBrand,
}: Readonly<{
    gamepadModel: string | undefined;
    gamepadBrand: string | undefined;
}>) {
    return check.isEnumValue(gamepadModel, PredefinedGamepadModel)
        ? gamepadModel
        : check.isEnumValue(gamepadBrand, PredefinedGamepadBrand)
          ? gamepadBrandLatestModels[gamepadBrand]
          : PredefinedGamepadModel.XboxWireless;
}

/**
 * Finds the icons for an input on the given gamepad, using the same model and brand that
 * `findMatchingGamepadModel` returns. An unknown model uses its brand's newest model from
 * {@link gamepadBrandLatestModels}. An unknown brand uses the newest Xbox, since the standard
 * gamepad layout is the Xbox layout. Returns an empty array when that gamepad lacks the input.
 *
 * @category Icons
 */
export function getGamepadInputIcons({
    gamepadModel,
    gamepadBrand,
    input,
}: Readonly<{
    gamepadModel: string | undefined;
    gamepadBrand: string | undefined;
    input: KnownInput;
}>) {
    const model = getIconModel({
        gamepadModel,
        gamepadBrand,
    });

    return (
        gamepadModelIcons[model].inputIcons?.[input] ||
        gamepadIconSetInputIcons[gamepadModelIcons[model].iconSet][input] ||
        []
    );
}

/**
 * Same as {@link getGamepadInputIcons} but finds the single icon for one direction of a stick axis.
 * {@link InputDirection.Flat} gives the whole axis. Returns `undefined` when that gamepad lacks the
 * stick.
 *
 * @category Icons
 */
export function getGamepadStickIcon({
    gamepadModel,
    gamepadBrand,
    input,
    direction,
}: Readonly<{
    gamepadModel: string | undefined;
    gamepadBrand: string | undefined;
    input: GamepadStickInput;
    direction: InputDirection;
}>) {
    return gamepadIconSetStickIcons[
        gamepadModelIcons[
            getIconModel({
                gamepadModel,
                gamepadBrand,
            })
        ].iconSet
    ][input]?.[direction];
}
