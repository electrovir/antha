import {
    type GamepadBrandMap,
    type GamepadModelMap,
    PredefinedGamepadBrand,
    PredefinedGamepadModel,
} from './gamepad-model.js';

/**
 * Gamepad mappings of gamepad ids / names to GamepadModel defined by the
 * [gamepad-type](https://www.npmjs.com/package/gamepad-type) package.
 *
 * @category Defaults
 */
export const defaultGamepadModelMap: Readonly<GamepadModelMap> = {
    /** Safari detected OEM Switch Pro gamepad name. */
    'Pro Controller Extended Gamepad': PredefinedGamepadModel.SwitchPro,
    /** Safari detected OEM Xbox Wireless gamepad name. */
    'Xbox Wireless Controller Extended Gamepad': PredefinedGamepadModel.XboxWireless,
    /** Safari detected OEM DualSense gamepad name. */
    'DualSense Wireless Controller Extended Gamepad': PredefinedGamepadModel.PlaystationDualSense,
    /** Safari detected OEM DualSense gamepad name. (Yes, another one.) */
    'Wireless Controller Extended Gamepad': PredefinedGamepadModel.PlaystationDualSense,

    /** Firefox detected OEM DualSense gamepad name. */
    '54c-ce6-Wireless Controller': PredefinedGamepadModel.PlaystationDualSense,
    /** Firefox detected OEM Xbox Wireless gamepad name. */
    '45e-b13-Xbox Wireless Controller': PredefinedGamepadModel.XboxWireless,

    /** Chrome detected OEM Switch Pro gamepad name. */
    'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)':
        PredefinedGamepadModel.SwitchPro,
    /** Chrome detected OEM DualSense gamepad name. */
    'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)':
        PredefinedGamepadModel.PlaystationDualSense,
    /** Chrome detected OEM Xbox Wireless gamepad name. */
    'Xbox Series X Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b12)':
        PredefinedGamepadModel.XboxWireless,

    /** Inputs from external users. */

    'DUALSHOCK 4 Wireless Controller Extended Gamepad':
        PredefinedGamepadModel.PlaystationDualShock4, // e9ed532bca264299849b10d076040798
    'DUALSHOCK 4 Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)':
        PredefinedGamepadModel.PlaystationDualShock4, // 9e8343773463416683ac7501d766e682
    '54c-9cc-DUALSHOCK 4 Wireless Controller': PredefinedGamepadModel.PlaystationDualShock4, // 25024a8747044b43b71608ffa13c18c7
    'HID-compliant game controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)':
        PredefinedGamepadModel.XboxWireless, // issues #6578763126
};

/**
 * PredefinedGamepadBrand for each PredefinedGamepadModel.
 *
 * @category Defaults
 */
export const defaultGamepadBrandMap: GamepadBrandMap = {
    [PredefinedGamepadModel.SwitchPro]: PredefinedGamepadBrand.Nintendo,
    [PredefinedGamepadModel.Xbox360]: PredefinedGamepadBrand.Microsoft,
    [PredefinedGamepadModel.XboxWireless]: PredefinedGamepadBrand.Microsoft,
    [PredefinedGamepadModel.PlaystationDualSense]: PredefinedGamepadBrand.Sony,
    [PredefinedGamepadModel.PlaystationDualShock]: PredefinedGamepadBrand.Sony,
    [PredefinedGamepadModel.PlaystationDualShock4]: PredefinedGamepadBrand.Sony,
    [PredefinedGamepadModel.SteamDeck]: PredefinedGamepadBrand.Valve,
};
