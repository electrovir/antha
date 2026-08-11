/**
 * Mapping from Gamepad ids or names to model strings.
 *
 * @category Types
 */
export type GamepadModelMap = Readonly<{
    [GamepadId in string]: string | PredefinedGamepadModel;
}>;
/**
 * Mapping from Gamepad ids or names to brand strings.
 *
 * @category Types
 */
export type GamepadBrandMap = Readonly<{
    [GamepadId in string]: string | PredefinedGamepadBrand;
}>;

/**
 * All gamepad models known and defined by the
 * [gamepad-type](https://www.npmjs.com/package/gamepad-type) package. It contains a new entry for
 * each gamepad generation that features different button layouts.
 *
 * Note that any consumer of the [gamepad-type](https://www.npmjs.com/package/gamepad-type) package
 * is able to freely define their own models as well, this is merely the _pre_ defined set of
 * models.
 *
 * See {@link predefinedGamepadModelDescriptions} for comments on what each model is.
 *
 * @category Defaults
 */
export enum PredefinedGamepadModel {
    SwitchPro = 'switch-pro',

    PlaystationDualShock = 'playstation-dual-shock',
    PlaystationDualShock4 = 'playstation-dual-shock-4',
    PlaystationDualSense = 'playstation-dual-sense',

    SteamDeck = 'steam-deck',

    Xbox360 = 'xbox-360',
    XboxWireless = 'xbox-wireless',
}

/**
 * A map of {@link PredefinedGamepadModel} to pretty user facing names.
 *
 * @category Defaults
 */
export const fancyGamepadModelName: Record<PredefinedGamepadModel, string> = {
    [PredefinedGamepadModel.SwitchPro]: 'Switch Pro Controller',

    [PredefinedGamepadModel.PlaystationDualShock]: 'PlayStation DualShock',
    [PredefinedGamepadModel.PlaystationDualShock4]: 'PlayStation DualShock 4',
    [PredefinedGamepadModel.PlaystationDualSense]: 'PlayStation DualSense',

    [PredefinedGamepadModel.SteamDeck]: 'Steam Deck',

    [PredefinedGamepadModel.Xbox360]: 'Xbox 360',
    [PredefinedGamepadModel.XboxWireless]: 'Xbox Wireless',
};

/**
 * Gamepad brands known and defined by the
 * [gamepad-type](https://www.npmjs.com/package/gamepad-type) package.
 *
 * Note that any consumer of the [gamepad-type](https://www.npmjs.com/package/gamepad-type) package
 * is able to freely define their own brands as well, this is merely the _pre_ defined set of
 * brands.
 *
 * @category Defaults
 */
export enum PredefinedGamepadBrand {
    Microsoft = 'microsoft',
    Nintendo = 'nintendo',
    Sony = 'sony',
    Valve = 'valve',
}

/**
 * Description of each gamepad model predefined by the
 * [gamepad-type](https://www.npmjs.com/package/gamepad-type) package.
 *
 * @category Defaults
 */
export const predefinedGamepadModelDescriptions: Readonly<Record<string, string>> = {
    [PredefinedGamepadModel.SwitchPro]:
        'Nintendo Switch Pro gamepad for the Nintendo Switch console.',
    [PredefinedGamepadModel.PlaystationDualSense]:
        'Sony PlayStation DualSense gamepad for the Sony PlayStation 5 console.',
    [PredefinedGamepadModel.PlaystationDualShock]:
        'Sony PlayStation DualShock gamepad for the Sony PlayStation 1 through Sony PlayStation 3 consoles.',
    [PredefinedGamepadModel.PlaystationDualShock4]:
        'Sony PlayStation DualShock 4 gamepad for the Sony PlayStation 4 console.',
    [PredefinedGamepadModel.SteamDeck]: 'Gamepad for the Valve Steam Deck handheld console.',
    [PredefinedGamepadModel.Xbox360]:
        'Microsoft Xbox 360 gamepad for the Microsoft Xbox 360 console. Can be wired or wireless.',
    [PredefinedGamepadModel.XboxWireless]:
        'Microsoft Xbox Wireless gamepad for Microsoft Xbox One through Xbox Series X/S consoles.',
} satisfies Readonly<Record<PredefinedGamepadModel, string>>;
