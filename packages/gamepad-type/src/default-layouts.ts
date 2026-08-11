/* eslint-disable sonarjs/no-hardcoded-ip */

import {type GamepadLayout} from './gamepad-layout.js';
import {PredefinedGamepadModel} from './gamepad-model.js';
import {KnownInput} from './known-input.js';

/**
 * Gamepad layouts defined by the [gamepad-type](https://www.npmjs.com/package/gamepad-type) package
 * that have already been determined for most major OEM gamepads.
 *
 * @category Defaults
 */
export const defaultGamepadLayouts: ReadonlyArray<Readonly<GamepadLayout>> = [
    {
        gamepadModels: [PredefinedGamepadModel.SwitchPro],
        inputMappings: {
            'axe-0': KnownInput.LeftStickX,
            'axe-1': KnownInput.LeftStickY,
            'axe-2': KnownInput.RightStickX,
            'axe-3': KnownInput.RightStickY,
            'button-0': KnownInput.FaceAccept,
            'button-1': KnownInput.FaceCancel,
            'button-2': KnownInput.FaceAlt1,
            'button-3': KnownInput.FaceAlt2,
            'button-4': KnownInput.L1,
            'button-5': KnownInput.R1,
            'button-6': KnownInput.L2,
            'button-7': KnownInput.R2,
            'button-8': KnownInput.Select,
            'button-9': KnownInput.Start,
            'button-10': KnownInput.L3,
            'button-11': KnownInput.R3,
            'button-12': KnownInput.DPadUp,
            'button-13': KnownInput.DPadDown,
            'button-14': KnownInput.DPadLeft,
            'button-15': KnownInput.DPadRight,
            'button-16': KnownInput.Home,
        },
        systemVersions: [
            {
                browserVersion: '17.2.1',
                browserName: 'Safari',
                osName: 'macOS',
                osVersion: '10.15.7',
            },
        ],
        notes: {
            info: 'The capture / screenshot button is not detected by this browser.',
        },
    },
    {
        gamepadModels: [PredefinedGamepadModel.XboxWireless],
        inputMappings: {
            'axe-0': KnownInput.LeftStickX,
            'axe-1': KnownInput.LeftStickY,
            'axe-2': KnownInput.RightStickX,
            'axe-3': KnownInput.RightStickY,
            'button-0': KnownInput.FaceAccept,
            'button-1': KnownInput.FaceCancel,
            'button-2': KnownInput.FaceAlt1,
            'button-3': KnownInput.FaceAlt2,
            'button-4': KnownInput.L1,
            'button-5': KnownInput.R1,
            'button-6': KnownInput.L2,
            'button-7': KnownInput.R2,
            'button-8': KnownInput.Select,
            'button-9': KnownInput.Start,
            'button-10': KnownInput.L3,
            'button-11': KnownInput.R3,
            'button-12': KnownInput.DPadUp,
            'button-13': KnownInput.DPadDown,
            'button-14': KnownInput.DPadLeft,
            'button-15': KnownInput.DPadRight,
            'button-16': KnownInput.Logo,
        },
        systemVersions: [
            {
                browserVersion: '17.2.1',
                browserName: 'Safari',
                osName: 'macOS',
                osVersion: '10.15.7',
            },
        ],
        notes: {
            info: 'The share button is not detected by this browser.',
        },
    },
    {
        gamepadModels: [PredefinedGamepadModel.SwitchPro],
        inputMappings: {
            'axe-0': KnownInput.LeftStickX,
            'axe-1': KnownInput.LeftStickY,
            'axe-2': KnownInput.RightStickX,
            'axe-3': KnownInput.RightStickY,
            'button-0': KnownInput.FaceCancel,
            'button-1': KnownInput.FaceAccept,
            'button-2': KnownInput.FaceAlt2,
            'button-3': KnownInput.FaceAlt1,
            'button-4': KnownInput.L1,
            'button-5': KnownInput.R1,
            'button-6': KnownInput.L2,
            'button-7': KnownInput.R2,
            'button-8': KnownInput.Select,
            'button-9': KnownInput.Start,
            'button-10': KnownInput.L3,
            'button-11': KnownInput.R3,
            'button-12': KnownInput.DPadUp,
            'button-13': KnownInput.DPadDown,
            'button-14': KnownInput.DPadLeft,
            'button-15': KnownInput.DPadRight,
            'button-16': KnownInput.Home,
            'button-17': KnownInput.Capture,
        },
        systemVersions: [
            {
                browserVersion: '117.0.0.0',
                browserName: 'Chrome',
                osName: 'macOS',
                osVersion: '10.15.7',
            },
        ],
        notes: undefined,
    },
    {
        inputMappings: {
            'axe-0': KnownInput.LeftStickX,
            'axe-1': KnownInput.LeftStickY,
            'axe-2': KnownInput.RightStickX,
            'axe-3': KnownInput.RightStickY,
            'button-0': KnownInput.FaceAccept,
            'button-1': KnownInput.FaceCancel,
            'button-2': KnownInput.FaceAlt1,
            'button-3': KnownInput.FaceAlt2,
            'button-4': KnownInput.L1,
            'button-5': KnownInput.R1,
            'button-6': KnownInput.L2,
            'button-7': KnownInput.R2,
            'button-8': KnownInput.Select,
            'button-9': KnownInput.Start,
            'button-10': KnownInput.L3,
            'button-11': KnownInput.R3,
            'button-12': KnownInput.DPadUp,
            'button-13': KnownInput.DPadDown,
            'button-14': KnownInput.DPadLeft,
            'button-15': KnownInput.DPadRight,
            'button-16': KnownInput.Logo,
            'button-17': KnownInput.TouchPad,
        },
        gamepadModels: [PredefinedGamepadModel.PlaystationDualSense],
        systemVersions: [
            {
                browserVersion: '117.0.0.0',
                browserName: 'Chrome',
                osName: 'macOS',
                osVersion: '10.15.7',
            },
        ],
        notes: {
            info: 'Touch pad navigation and the mute button are not detected by this browser.',
        },
    },
    {
        inputMappings: {
            'axe-0': KnownInput.LeftStickX,
            'axe-1': KnownInput.LeftStickY,
            'axe-2': KnownInput.RightStickX,
            'axe-3': KnownInput.RightStickY,
            'button-0': KnownInput.FaceAccept,
            'button-1': KnownInput.FaceCancel,
            'button-2': KnownInput.FaceAlt1,
            'button-3': KnownInput.FaceAlt2,
            'button-4': KnownInput.L1,
            'button-5': KnownInput.R1,
            'button-6': KnownInput.L2,
            'button-7': KnownInput.R2,
            'button-8': KnownInput.Select,
            'button-9': KnownInput.Start,
            'button-10': KnownInput.L3,
            'button-11': KnownInput.R3,
            'button-12': KnownInput.DPadUp,
            'button-13': KnownInput.DPadDown,
            'button-14': KnownInput.DPadLeft,
            'button-15': KnownInput.DPadRight,
            'button-16': KnownInput.Logo,
        },
        gamepadModels: [PredefinedGamepadModel.PlaystationDualSense],
        systemVersions: [
            {
                browserVersion: '17.2.1',
                browserName: 'Safari',
                osName: 'macOS',
                osVersion: '10.15.7',
            },
        ],
        notes: {
            info: 'Touch pad navigation, the touch pad button, and the mute button are not detected by this browser.',
        },
    },
    {
        /**
         * Firefox has the following messed up mappings:
         *
         * - R2 and L2 are buttons (6,7) but also axes (4,5) (the buttons don't use gradual values,
         *   just 0 or 1 and then the value is mapped to the axes)
         * - The d-pad is mapped to a single axe with the following values
         *
         *   - 0 before the d-pad has been used
         *   - 1.3 at rest after the d-pad has been used
         *   - -1.0 for up
         *   - 0.1 for down
         *   - 0.7 for left
         *   - -0.4 for right
         */
        inputMappings: {
            'axe-0': KnownInput.LeftStickX,
            'axe-1': KnownInput.LeftStickY,
            'axe-2': KnownInput.RightStickX,
            'axe-3': KnownInput.RightStickY,
            'axe-4': KnownInput.L2,
            'axe-5': KnownInput.R2,
            'axe-6': KnownInput.DPad,
            'button-0': KnownInput.FaceAlt1,
            'button-1': KnownInput.FaceAccept,
            'button-2': KnownInput.FaceCancel,
            'button-3': KnownInput.FaceAlt2,
            'button-4': KnownInput.L1,
            'button-5': KnownInput.R1,
            'button-6': KnownInput.L2,
            'button-7': KnownInput.R2,
            'button-8': KnownInput.Select,
            'button-9': KnownInput.Start,
            'button-10': KnownInput.L3,
            'button-11': KnownInput.R3,
            'button-12': KnownInput.Logo,
            'button-13': KnownInput.TouchPad,
            'button-14': KnownInput.Mute,
            'button-15': KnownInput.DPadRight,
            'button-16': KnownInput.Logo,
            'button-17': KnownInput.TouchPad,
        },
        gamepadModels: [PredefinedGamepadModel.PlaystationDualSense],
        systemVersions: [
            {
                browserVersion: '109.0',
                browserName: 'Firefox',
                osName: 'macOS',
                osVersion: '10.15',
            },
        ],
        notes: {
            warning: 'This browser has major issues reading this gamepad.',
        },
    },
    {
        /**
         * Firefox has the following messed up mappings:
         *
         * - A bunch of buttons aren't mapped to anything on my controller
         * - The triggers have no intermediate values at all
         * - The d-pad is mapped to a single axe with the following values
         *
         *   - 0 before the d-pad has been used
         *   - -1.3 at rest after the d-pad has been used
         *   - -1.0 for up
         *   - 0.1 for down
         *   - 0.7 for left
         *   - -0.4 for right
         */
        gamepadModels: [PredefinedGamepadModel.XboxWireless],
        inputMappings: {
            'axe-0': KnownInput.LeftStickX,
            'axe-1': KnownInput.LeftStickY,
            'axe-2': KnownInput.RightStickX,
            'axe-3': KnownInput.RightStickY,
            'axe-4': KnownInput.DPad,
            'button-0': KnownInput.FaceAccept,
            'button-1': KnownInput.FaceCancel,
            'button-2': 'unknown',
            'button-3': KnownInput.FaceAlt1,
            'button-4': KnownInput.FaceAlt2,
            'button-5': 'unknown',
            'button-6': KnownInput.L1,
            'button-7': KnownInput.R1,
            'button-8': 'unknown',
            'button-9': 'unknown',
            'button-10': KnownInput.Select,
            'button-11': KnownInput.Start,
            'button-12': KnownInput.Logo,
            'button-13': KnownInput.L3,
            'button-14': KnownInput.R3,
            'button-15': KnownInput.L2,
            'button-16': KnownInput.R2,
        },
        systemVersions: [
            {
                browserVersion: '109.0',
                browserName: 'Firefox',
                osName: 'macOS',
                osVersion: '10.15',
            },
        ],
        notes: {
            warning: 'This browser has major issues reading this gamepad.',
        },
    },
    {
        gamepadModels: [PredefinedGamepadModel.XboxWireless],
        inputMappings: {
            'axe-0': KnownInput.LeftStickX,
            'axe-1': KnownInput.LeftStickY,
            'axe-2': KnownInput.RightStickX,
            'axe-3': KnownInput.RightStickY,
            'button-0': KnownInput.FaceAccept,
            'button-1': KnownInput.FaceCancel,
            'button-10': KnownInput.L3,
            'button-11': KnownInput.R3,
            'button-12': KnownInput.DPadUp,
            'button-13': KnownInput.DPadDown,
            'button-14': KnownInput.DPadLeft,
            'button-15': KnownInput.DPadRight,
            'button-16': KnownInput.Logo,
            'button-2': KnownInput.FaceAlt1,
            'button-3': KnownInput.FaceAlt2,
            'button-4': KnownInput.L1,
            'button-5': KnownInput.R1,
            'button-6': KnownInput.L2,
            'button-7': KnownInput.R2,
            'button-8': KnownInput.Select,
            'button-9': KnownInput.Start,
            'button-17': KnownInput.Share,
        },
        systemVersions: [
            {
                browserVersion: '117.0.0.0',
                browserName: 'Chrome',
                osName: 'macOS',
                osVersion: '10.15.7',
            },
        ],
        notes: undefined,
    },
];
