import {PredefinedGamepadModel} from './gamepad-model.js';

/**
 * Consolidated (as much as possible across each brand ) known inputs.
 *
 * @category Util
 */
export enum KnownInput {
    /** A on Xbox and Nintendo, X on Playstation. */
    FaceAccept = 'face-accept',
    /** B on Xbox and Nintendo, Circle on Playstation. */
    FaceCancel = 'face-cancel',
    /** X on Xbox and Nintendo, Square on Playstation. */
    FaceAlt1 = 'face-alt-1',
    /** Y on Xbox and Nintendo, Triangle on Playstation. */
    FaceAlt2 = 'face-alt-2',

    /** The top left trigger area button. */
    L1 = 'L1',
    /** The bottom left trigger area button. */
    L2 = 'L2',
    /** Left stick click. */
    L3 = 'L3',

    /** The top right trigger area button. */
    R1 = 'R1',
    /** The bottom right trigger area button. */
    R2 = 'R2',
    /** Right stick click. */
    R3 = 'R3',

    LeftStickX = 'left-stick-x',
    LeftStickY = 'left-stick-y',
    RightStickX = 'right-stick-x',
    RightStickY = 'right-stick-y',

    DPad = 'd-pad',
    DPadDown = 'd-pad-down',
    DPadLeft = 'd-pad-left',
    DPadRight = 'd-pad-right',
    DPadUp = 'd-pad-up',

    /** The primary center button to the left of the controller logo. */
    Select = 'select',
    /** The button which is also the controller brand's logo. */
    Logo = 'logo',
    /** The primary center button to the right of the controller logo. */
    Start = 'start',

    /** Only exists on Nintendo controllers. */
    Capture = 'capture',
    /** Only exists on Nintendo controllers. */
    Home = 'home',
    /** Only exists on Playstation controllers. */
    Mute = 'mute',
    /**
     * Exists on Xbox controllers. Note that on Dualshock 4 controllers, which has a "Share" button,
     * their share button is mapped to Select instead of Share.
     */
    Share = 'share',
    /** Only exists on Playstation controllers. */
    TouchPad = 'touch-pad',
}

/**
 * Name overrides for each brand for consolidated input names from {@link KnownInput}.
 *
 * @category Util
 */
export const modelInputNameOverrides = {
    [PredefinedGamepadModel.SwitchPro]: {
        [KnownInput.L1]: 'L',
        [KnownInput.R1]: 'R',
        [KnownInput.L2]: 'ZL',
        [KnownInput.R2]: 'ZR',
        [KnownInput.FaceAccept]: 'A',
        [KnownInput.FaceCancel]: 'B',
        [KnownInput.FaceAlt1]: 'X',
        [KnownInput.FaceAlt2]: 'Y',
        [KnownInput.Select]: 'minus',
        [KnownInput.Start]: 'plus',
    },
    [PredefinedGamepadModel.PlaystationDualShock]: {
        [KnownInput.FaceAccept]: 'X',
        [KnownInput.FaceCancel]: 'O',
        [KnownInput.FaceAlt1]: 'square',
        [KnownInput.FaceAlt2]: 'triangle',
    },
    [PredefinedGamepadModel.PlaystationDualShock4]: {
        [KnownInput.FaceAccept]: 'X',
        [KnownInput.FaceCancel]: 'O',
        [KnownInput.FaceAlt1]: 'square',
        [KnownInput.FaceAlt2]: 'triangle',
        [KnownInput.Select]: 'share',
    },
    [PredefinedGamepadModel.PlaystationDualSense]: {
        [KnownInput.FaceAccept]: 'X',
        [KnownInput.FaceCancel]: 'O',
        [KnownInput.FaceAlt1]: 'square',
        [KnownInput.FaceAlt2]: 'triangle',
        [KnownInput.Select]: 'create',
        [KnownInput.Start]: 'options',
    },
    [PredefinedGamepadModel.SteamDeck]: {
        [KnownInput.FaceAccept]: 'A',
        [KnownInput.FaceCancel]: 'B',
        [KnownInput.FaceAlt1]: 'X',
        [KnownInput.FaceAlt2]: 'Y',
        [KnownInput.Select]: 'view',
        [KnownInput.Start]: 'menu',
    },
    [PredefinedGamepadModel.Xbox360]: {
        [KnownInput.L1]: 'LB',
        [KnownInput.R1]: 'RB',
        [KnownInput.L2]: 'LT',
        [KnownInput.R2]: 'RT',
        [KnownInput.FaceAccept]: 'A',
        [KnownInput.FaceCancel]: 'B',
        [KnownInput.FaceAlt1]: 'X',
        [KnownInput.FaceAlt2]: 'Y',
        [KnownInput.Select]: 'back',
    },
    [PredefinedGamepadModel.XboxWireless]: {
        [KnownInput.L1]: 'LB',
        [KnownInput.R1]: 'RB',
        [KnownInput.L2]: 'LT',
        [KnownInput.R2]: 'RT',
        [KnownInput.FaceAccept]: 'A',
        [KnownInput.FaceCancel]: 'B',
        [KnownInput.FaceAlt1]: 'X',
        [KnownInput.FaceAlt2]: 'Y',
        [KnownInput.Select]: 'view',
        [KnownInput.Start]: 'menu',
    },
} as const satisfies Record<PredefinedGamepadModel, Partial<Record<KnownInput, string>>>;
