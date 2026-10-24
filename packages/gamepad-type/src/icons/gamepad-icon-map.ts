import {type ViraIconSvg} from 'vira';
import {InputDirection} from '../input-direction.js';
import {KnownInput} from '../known-input.js';
import {
    ButtonAIcon,
    ButtonBIcon,
    ButtonBackIcon,
    ButtonHomeIcon,
    ButtonL1Icon,
    ButtonL2Icon,
    ButtonLIcon,
    ButtonMinusIcon,
    ButtonOptionsIcon,
    ButtonPlusIcon,
    ButtonR1Icon,
    ButtonR2Icon,
    ButtonRIcon,
    ButtonStartIcon,
    ButtonViewIcon,
    ButtonXIcon,
    ButtonYIcon,
    ButtonsDownIcon,
    ButtonsLeftIcon,
    ButtonsNoneIcon,
    ButtonsRightIcon,
    ButtonsUpIcon,
    DpadDownIcon,
    DpadLeftIcon,
    DpadNoneIcon,
    DpadRightIcon,
    DpadUpIcon,
    GamecubeDpadDownIcon,
    GamecubeDpadLeftIcon,
    GamecubeDpadNoneIcon,
    GamecubeDpadRightIcon,
    GamecubeDpadUpIcon,
    StickDownIcon,
    StickHorizontalIcon,
    StickLDownIcon,
    StickLHorizontalIcon,
    StickLLeftIcon,
    StickLPressIcon,
    StickLRightIcon,
    StickLUpIcon,
    StickLVerticalIcon,
    StickLeftIcon,
    StickRDownIcon,
    StickRHorizontalIcon,
    StickRLeftIcon,
    StickRPressIcon,
    StickRRightIcon,
    StickRUpIcon,
    StickRVerticalIcon,
    StickRightIcon,
    StickUpIcon,
    StickVerticalIcon,
    XboxButtonAIcon,
    XboxButtonBIcon,
    XboxButtonXIcon,
    XboxButtonYIcon,
} from './common-icons.js';
import {
    QuestButtonMenuIcon,
    QuestButtonMetaIcon,
    QuestButtonOculusIcon,
    QuestGripLeftIcon,
    QuestGripRightIcon,
    QuestTriggerLeftIcon,
    QuestTriggerRightIcon,
} from './meta-quest-icons.js';
import {
    GamecubeButtonStartIcon,
    GamecubeButtonXIcon,
    GamecubeButtonYIcon,
    GamecubeButtonZIcon,
    GamecubeStickCDownIcon,
    GamecubeStickCHorizontalIcon,
    GamecubeStickCLeftIcon,
    GamecubeStickCRightIcon,
    GamecubeStickCUpIcon,
    GamecubeStickCVerticalIcon,
    GamecubeTriggerLIcon,
    GamecubeTriggerRIcon,
} from './nintendo-gamecube-icons.js';
import {
    NintendoSwitch2ButtonZlIcon,
    NintendoSwitch2ButtonZrIcon,
} from './nintendo-switch-2-icons.js';
import {SwitchButtonZlIcon, SwitchButtonZrIcon} from './nintendo-switch-icons.js';
import {
    WiiButtonBIcon,
    WiiButtonLIcon,
    WiiButtonRIcon,
    WiiButtonZlIcon,
    WiiButtonZrIcon,
} from './nintendo-wii-icons.js';
import {
    WiiuButtonLIcon,
    WiiuButtonRIcon,
    WiiuButtonZlIcon,
    WiiuButtonZrIcon,
} from './nintendo-wii-u-icons.js';
import {
    Playstation3ButtonSelectIcon,
    Playstation3ButtonStartIcon,
    Playstation4ButtonOptionsIcon,
    Playstation4ButtonShareIcon,
    Playstation4TouchpadGridIcon,
    Playstation5ButtonCreateIcon,
    Playstation5ButtonMuteIcon,
    Playstation5ButtonOptionsIcon,
    PlaystationButtonCircleIcon,
    PlaystationButtonCrossIcon,
    PlaystationButtonSquareIcon,
    PlaystationButtonTriangleIcon,
    PlaystationDpadDownIcon,
    PlaystationDpadLeftIcon,
    PlaystationDpadNoneIcon,
    PlaystationDpadRightIcon,
    PlaystationDpadUpIcon,
    PlaystationTriggerL1AlternativeIcon,
    PlaystationTriggerL2AlternativeIcon,
    PlaystationTriggerR1AlternativeIcon,
    PlaystationTriggerR2AlternativeIcon,
} from './playstation-icons.js';
import {
    ControllerButtonL2Icon,
    ControllerButtonR2Icon,
    SteamDpadDownIcon,
    SteamDpadLeftIcon,
    SteamDpadNoneIcon,
    SteamDpadRightIcon,
    SteamDpadUpIcon,
    SteamStickLPressIcon,
} from './steam-controller-icons.js';
import {SteamdeckButtonGuideIcon} from './steam-deck-icons.js';
import {IndexLtIcon, IndexRtIcon} from './valve-index-icons.js';
import {
    XboxButtonMenuIcon,
    XboxButtonShareIcon,
    XboxButtonViewIcon,
    XboxGuideIcon,
    XboxLbIcon,
    XboxLtIcon,
    XboxRbIcon,
    XboxRtIcon,
} from './xbox-icons.js';

/**
 * Gamepad families that have their own icons.
 *
 * @category Icons
 */
export enum GamepadIconSet {
    MetaQuest = 'meta-quest',
    NintendoGamecube = 'nintendo-gamecube',
    NintendoSwitch = 'nintendo-switch',
    NintendoSwitch2 = 'nintendo-switch-2',
    NintendoWii = 'nintendo-wii',
    NintendoWiiU = 'nintendo-wii-u',
    PlayStation = 'playstation',
    SteamController = 'steam-controller',
    SteamDeck = 'steam-deck',
    SteamFrame = 'steam-frame',
    ValveIndex = 'valve-index',
    Xbox = 'xbox',
}

/**
 * Icons for each {@link KnownInput}, per {@link GamepadIconSet}. Inputs a gamepad lacks are missing.
 * When an input has multiple icons, the first is the default. For a single stick direction, use
 * {@link gamepadIconSetStickIcons}.
 *
 * @category Icons
 */
export const gamepadIconSetInputIcons: Readonly<
    Record<GamepadIconSet, Readonly<Partial<Record<KnownInput, ReadonlyArray<ViraIconSvg>>>>>
> = {
    [GamepadIconSet.MetaQuest]: {
        [KnownInput.FaceAccept]: [ButtonAIcon],
        [KnownInput.FaceCancel]: [ButtonBIcon],
        [KnownInput.FaceAlt1]: [ButtonXIcon],
        [KnownInput.FaceAlt2]: [ButtonYIcon],
        [KnownInput.L1]: [QuestGripLeftIcon],
        [KnownInput.L2]: [QuestTriggerLeftIcon],
        [KnownInput.L3]: [StickLPressIcon],
        [KnownInput.R1]: [QuestGripRightIcon],
        [KnownInput.R2]: [QuestTriggerRightIcon],
        [KnownInput.R3]: [StickRPressIcon],
        [KnownInput.LeftStickX]: [
            StickLHorizontalIcon,
            StickLLeftIcon,
            StickLRightIcon,
        ],
        [KnownInput.LeftStickY]: [
            StickLVerticalIcon,
            StickLUpIcon,
            StickLDownIcon,
        ],
        [KnownInput.RightStickX]: [
            StickRHorizontalIcon,
            StickRLeftIcon,
            StickRRightIcon,
        ],
        [KnownInput.RightStickY]: [
            StickRVerticalIcon,
            StickRUpIcon,
            StickRDownIcon,
        ],
        [KnownInput.Logo]: [
            QuestButtonMetaIcon,
            QuestButtonOculusIcon,
        ],
        [KnownInput.Start]: [QuestButtonMenuIcon],
    },
    [GamepadIconSet.NintendoGamecube]: {
        [KnownInput.FaceAccept]: [XboxButtonAIcon],
        [KnownInput.FaceCancel]: [XboxButtonBIcon],
        [KnownInput.FaceAlt1]: [GamecubeButtonXIcon],
        [KnownInput.FaceAlt2]: [GamecubeButtonYIcon],
        [KnownInput.L2]: [GamecubeTriggerLIcon],
        [KnownInput.R1]: [GamecubeButtonZIcon],
        [KnownInput.R2]: [GamecubeTriggerRIcon],
        [KnownInput.LeftStickX]: [
            StickHorizontalIcon,
            StickLeftIcon,
            StickRightIcon,
        ],
        [KnownInput.LeftStickY]: [
            StickVerticalIcon,
            StickUpIcon,
            StickDownIcon,
        ],
        [KnownInput.RightStickX]: [
            GamecubeStickCHorizontalIcon,
            GamecubeStickCLeftIcon,
            GamecubeStickCRightIcon,
        ],
        [KnownInput.RightStickY]: [
            GamecubeStickCVerticalIcon,
            GamecubeStickCUpIcon,
            GamecubeStickCDownIcon,
        ],
        [KnownInput.DPad]: [GamecubeDpadNoneIcon],
        [KnownInput.DPadDown]: [GamecubeDpadDownIcon],
        [KnownInput.DPadLeft]: [GamecubeDpadLeftIcon],
        [KnownInput.DPadRight]: [GamecubeDpadRightIcon],
        [KnownInput.DPadUp]: [GamecubeDpadUpIcon],
        [KnownInput.Start]: [GamecubeButtonStartIcon],
    },
    [GamepadIconSet.NintendoSwitch]: {
        [KnownInput.FaceAccept]: [ButtonAIcon],
        [KnownInput.FaceCancel]: [ButtonBIcon],
        [KnownInput.FaceAlt1]: [ButtonXIcon],
        [KnownInput.FaceAlt2]: [ButtonYIcon],
        [KnownInput.L1]: [ButtonLIcon],
        [KnownInput.L2]: [SwitchButtonZlIcon],
        [KnownInput.L3]: [StickLPressIcon],
        [KnownInput.R1]: [ButtonRIcon],
        [KnownInput.R2]: [SwitchButtonZrIcon],
        [KnownInput.R3]: [StickRPressIcon],
        [KnownInput.LeftStickX]: [
            StickLHorizontalIcon,
            StickLLeftIcon,
            StickLRightIcon,
        ],
        [KnownInput.LeftStickY]: [
            StickLVerticalIcon,
            StickLUpIcon,
            StickLDownIcon,
        ],
        [KnownInput.RightStickX]: [
            StickRHorizontalIcon,
            StickRLeftIcon,
            StickRRightIcon,
        ],
        [KnownInput.RightStickY]: [
            StickRVerticalIcon,
            StickRUpIcon,
            StickRDownIcon,
        ],
        [KnownInput.DPad]: [ButtonsNoneIcon],
        [KnownInput.DPadDown]: [ButtonsDownIcon],
        [KnownInput.DPadLeft]: [ButtonsLeftIcon],
        [KnownInput.DPadRight]: [ButtonsRightIcon],
        [KnownInput.DPadUp]: [ButtonsUpIcon],
        [KnownInput.Select]: [ButtonMinusIcon],
        [KnownInput.Start]: [ButtonPlusIcon],
        [KnownInput.Home]: [ButtonHomeIcon],
    },
    [GamepadIconSet.NintendoSwitch2]: {
        [KnownInput.FaceAccept]: [ButtonAIcon],
        [KnownInput.FaceCancel]: [ButtonBIcon],
        [KnownInput.FaceAlt1]: [ButtonXIcon],
        [KnownInput.FaceAlt2]: [ButtonYIcon],
        [KnownInput.L1]: [ButtonLIcon],
        [KnownInput.L2]: [NintendoSwitch2ButtonZlIcon],
        [KnownInput.L3]: [StickLPressIcon],
        [KnownInput.R1]: [ButtonRIcon],
        [KnownInput.R2]: [NintendoSwitch2ButtonZrIcon],
        [KnownInput.R3]: [StickRPressIcon],
        [KnownInput.LeftStickX]: [
            StickLHorizontalIcon,
            StickLLeftIcon,
            StickLRightIcon,
        ],
        [KnownInput.LeftStickY]: [
            StickLVerticalIcon,
            StickLUpIcon,
            StickLDownIcon,
        ],
        [KnownInput.RightStickX]: [
            StickRHorizontalIcon,
            StickRLeftIcon,
            StickRRightIcon,
        ],
        [KnownInput.RightStickY]: [
            StickRVerticalIcon,
            StickRUpIcon,
            StickRDownIcon,
        ],
        [KnownInput.DPad]: [ButtonsNoneIcon],
        [KnownInput.DPadDown]: [ButtonsDownIcon],
        [KnownInput.DPadLeft]: [ButtonsLeftIcon],
        [KnownInput.DPadRight]: [ButtonsRightIcon],
        [KnownInput.DPadUp]: [ButtonsUpIcon],
        [KnownInput.Select]: [ButtonMinusIcon],
        [KnownInput.Start]: [ButtonPlusIcon],
        [KnownInput.Home]: [ButtonHomeIcon],
    },
    [GamepadIconSet.NintendoWii]: {
        [KnownInput.FaceAccept]: [ButtonAIcon],
        [KnownInput.FaceCancel]: [WiiButtonBIcon],
        [KnownInput.FaceAlt1]: [ButtonXIcon],
        [KnownInput.FaceAlt2]: [ButtonYIcon],
        [KnownInput.L1]: [WiiButtonLIcon],
        [KnownInput.L2]: [WiiButtonZlIcon],
        [KnownInput.R1]: [WiiButtonRIcon],
        [KnownInput.R2]: [WiiButtonZrIcon],
        [KnownInput.LeftStickX]: [
            StickLHorizontalIcon,
            StickLLeftIcon,
            StickLRightIcon,
        ],
        [KnownInput.LeftStickY]: [
            StickLVerticalIcon,
            StickLUpIcon,
            StickLDownIcon,
        ],
        [KnownInput.RightStickX]: [
            StickRHorizontalIcon,
            StickRLeftIcon,
            StickRRightIcon,
        ],
        [KnownInput.RightStickY]: [
            StickRVerticalIcon,
            StickRUpIcon,
            StickRDownIcon,
        ],
        [KnownInput.DPad]: [GamecubeDpadNoneIcon],
        [KnownInput.DPadDown]: [GamecubeDpadDownIcon],
        [KnownInput.DPadLeft]: [GamecubeDpadLeftIcon],
        [KnownInput.DPadRight]: [GamecubeDpadRightIcon],
        [KnownInput.DPadUp]: [GamecubeDpadUpIcon],
        [KnownInput.Select]: [ButtonMinusIcon],
        [KnownInput.Start]: [ButtonPlusIcon],
        [KnownInput.Home]: [ButtonHomeIcon],
    },
    [GamepadIconSet.NintendoWiiU]: {
        [KnownInput.FaceAccept]: [ButtonAIcon],
        [KnownInput.FaceCancel]: [ButtonBIcon],
        [KnownInput.FaceAlt1]: [ButtonXIcon],
        [KnownInput.FaceAlt2]: [ButtonYIcon],
        [KnownInput.L1]: [WiiuButtonLIcon],
        [KnownInput.L2]: [WiiuButtonZlIcon],
        [KnownInput.R1]: [WiiuButtonRIcon],
        [KnownInput.R2]: [WiiuButtonZrIcon],
        [KnownInput.LeftStickX]: [
            StickLHorizontalIcon,
            StickLLeftIcon,
            StickLRightIcon,
        ],
        [KnownInput.LeftStickY]: [
            StickLVerticalIcon,
            StickLUpIcon,
            StickLDownIcon,
        ],
        [KnownInput.RightStickX]: [
            StickRHorizontalIcon,
            StickRLeftIcon,
            StickRRightIcon,
        ],
        [KnownInput.RightStickY]: [
            StickRVerticalIcon,
            StickRUpIcon,
            StickRDownIcon,
        ],
        [KnownInput.DPad]: [GamecubeDpadNoneIcon],
        [KnownInput.DPadDown]: [GamecubeDpadDownIcon],
        [KnownInput.DPadLeft]: [GamecubeDpadLeftIcon],
        [KnownInput.DPadRight]: [GamecubeDpadRightIcon],
        [KnownInput.DPadUp]: [GamecubeDpadUpIcon],
        [KnownInput.Select]: [ButtonMinusIcon],
        [KnownInput.Start]: [ButtonPlusIcon],
        [KnownInput.Home]: [ButtonHomeIcon],
    },
    [GamepadIconSet.PlayStation]: {
        [KnownInput.FaceAccept]: [PlaystationButtonCrossIcon],
        [KnownInput.FaceCancel]: [PlaystationButtonCircleIcon],
        [KnownInput.FaceAlt1]: [PlaystationButtonSquareIcon],
        [KnownInput.FaceAlt2]: [PlaystationButtonTriangleIcon],
        [KnownInput.L1]: [PlaystationTriggerL1AlternativeIcon],
        [KnownInput.L2]: [PlaystationTriggerL2AlternativeIcon],
        [KnownInput.L3]: [StickLPressIcon],
        [KnownInput.R1]: [PlaystationTriggerR1AlternativeIcon],
        [KnownInput.R2]: [PlaystationTriggerR2AlternativeIcon],
        [KnownInput.R3]: [StickRPressIcon],
        [KnownInput.LeftStickX]: [
            StickLHorizontalIcon,
            StickLLeftIcon,
            StickLRightIcon,
        ],
        [KnownInput.LeftStickY]: [
            StickLVerticalIcon,
            StickLUpIcon,
            StickLDownIcon,
        ],
        [KnownInput.RightStickX]: [
            StickRHorizontalIcon,
            StickRLeftIcon,
            StickRRightIcon,
        ],
        [KnownInput.RightStickY]: [
            StickRVerticalIcon,
            StickRUpIcon,
            StickRDownIcon,
        ],
        [KnownInput.DPad]: [PlaystationDpadNoneIcon],
        [KnownInput.DPadDown]: [PlaystationDpadDownIcon],
        [KnownInput.DPadLeft]: [PlaystationDpadLeftIcon],
        [KnownInput.DPadRight]: [PlaystationDpadRightIcon],
        [KnownInput.DPadUp]: [PlaystationDpadUpIcon],
        [KnownInput.Select]: [
            Playstation3ButtonSelectIcon,
            Playstation4ButtonShareIcon,
            Playstation5ButtonCreateIcon,
        ],
        [KnownInput.Start]: [
            Playstation3ButtonStartIcon,
            Playstation4ButtonOptionsIcon,
            Playstation5ButtonOptionsIcon,
        ],
        [KnownInput.Mute]: [Playstation5ButtonMuteIcon],
        [KnownInput.TouchPad]: [Playstation4TouchpadGridIcon],
    },
    [GamepadIconSet.SteamController]: {
        [KnownInput.FaceAccept]: [XboxButtonAIcon],
        [KnownInput.FaceCancel]: [XboxButtonBIcon],
        [KnownInput.FaceAlt1]: [XboxButtonXIcon],
        [KnownInput.FaceAlt2]: [XboxButtonYIcon],
        [KnownInput.L1]: [ButtonL1Icon],
        [KnownInput.L2]: [ControllerButtonL2Icon],
        [KnownInput.L3]: [SteamStickLPressIcon],
        [KnownInput.R1]: [ButtonR1Icon],
        [KnownInput.R2]: [ControllerButtonR2Icon],
        [KnownInput.LeftStickX]: [
            StickHorizontalIcon,
            StickLeftIcon,
            StickRightIcon,
        ],
        [KnownInput.LeftStickY]: [
            StickVerticalIcon,
            StickUpIcon,
            StickDownIcon,
        ],
        [KnownInput.DPad]: [SteamDpadNoneIcon],
        [KnownInput.DPadDown]: [SteamDpadDownIcon],
        [KnownInput.DPadLeft]: [SteamDpadLeftIcon],
        [KnownInput.DPadRight]: [SteamDpadRightIcon],
        [KnownInput.DPadUp]: [SteamDpadUpIcon],
        [KnownInput.Select]: [
            ButtonViewIcon,
            ButtonBackIcon,
        ],
        [KnownInput.Start]: [
            ButtonOptionsIcon,
            ButtonStartIcon,
        ],
    },
    [GamepadIconSet.SteamDeck]: {
        [KnownInput.FaceAccept]: [ButtonAIcon],
        [KnownInput.FaceCancel]: [ButtonBIcon],
        [KnownInput.FaceAlt1]: [ButtonXIcon],
        [KnownInput.FaceAlt2]: [ButtonYIcon],
        [KnownInput.L1]: [ButtonL1Icon],
        [KnownInput.L2]: [ButtonL2Icon],
        [KnownInput.L3]: [StickLPressIcon],
        [KnownInput.R1]: [ButtonR1Icon],
        [KnownInput.R2]: [ButtonR2Icon],
        [KnownInput.R3]: [StickRPressIcon],
        [KnownInput.LeftStickX]: [
            StickLHorizontalIcon,
            StickLLeftIcon,
            StickLRightIcon,
        ],
        [KnownInput.LeftStickY]: [
            StickLVerticalIcon,
            StickLUpIcon,
            StickLDownIcon,
        ],
        [KnownInput.RightStickX]: [
            StickRHorizontalIcon,
            StickRLeftIcon,
            StickRRightIcon,
        ],
        [KnownInput.RightStickY]: [
            StickRVerticalIcon,
            StickRUpIcon,
            StickRDownIcon,
        ],
        [KnownInput.DPad]: [DpadNoneIcon],
        [KnownInput.DPadDown]: [DpadDownIcon],
        [KnownInput.DPadLeft]: [DpadLeftIcon],
        [KnownInput.DPadRight]: [DpadRightIcon],
        [KnownInput.DPadUp]: [DpadUpIcon],
        [KnownInput.Select]: [ButtonViewIcon],
        [KnownInput.Logo]: [SteamdeckButtonGuideIcon],
        [KnownInput.Start]: [ButtonOptionsIcon],
    },
    [GamepadIconSet.SteamFrame]: {
        [KnownInput.FaceAccept]: [ButtonAIcon],
        [KnownInput.FaceCancel]: [ButtonBIcon],
        [KnownInput.FaceAlt1]: [ButtonXIcon],
        [KnownInput.FaceAlt2]: [ButtonYIcon],
        [KnownInput.L1]: [ButtonL1Icon],
        [KnownInput.L2]: [ButtonL2Icon],
        [KnownInput.L3]: [StickLPressIcon],
        [KnownInput.R1]: [ButtonR1Icon],
        [KnownInput.R2]: [ButtonR2Icon],
        [KnownInput.R3]: [StickRPressIcon],
        [KnownInput.LeftStickX]: [
            StickLHorizontalIcon,
            StickLLeftIcon,
            StickLRightIcon,
        ],
        [KnownInput.LeftStickY]: [
            StickLVerticalIcon,
            StickLUpIcon,
            StickLDownIcon,
        ],
        [KnownInput.RightStickX]: [
            StickRHorizontalIcon,
            StickRLeftIcon,
            StickRRightIcon,
        ],
        [KnownInput.RightStickY]: [
            StickRVerticalIcon,
            StickRUpIcon,
            StickRDownIcon,
        ],
        [KnownInput.DPad]: [DpadNoneIcon],
        [KnownInput.DPadDown]: [DpadDownIcon],
        [KnownInput.DPadLeft]: [DpadLeftIcon],
        [KnownInput.DPadRight]: [DpadRightIcon],
        [KnownInput.DPadUp]: [DpadUpIcon],
        [KnownInput.Select]: [ButtonViewIcon],
        [KnownInput.Start]: [ButtonOptionsIcon],
    },
    [GamepadIconSet.ValveIndex]: {
        [KnownInput.FaceAccept]: [ButtonAIcon],
        [KnownInput.FaceCancel]: [ButtonBIcon],
        [KnownInput.L2]: [IndexLtIcon],
        [KnownInput.L3]: [StickLPressIcon],
        [KnownInput.R2]: [IndexRtIcon],
        [KnownInput.R3]: [StickRPressIcon],
        [KnownInput.LeftStickX]: [
            StickLHorizontalIcon,
            StickLLeftIcon,
            StickLRightIcon,
        ],
        [KnownInput.LeftStickY]: [
            StickLVerticalIcon,
            StickLUpIcon,
            StickLDownIcon,
        ],
        [KnownInput.RightStickX]: [
            StickRHorizontalIcon,
            StickRLeftIcon,
            StickRRightIcon,
        ],
        [KnownInput.RightStickY]: [
            StickRVerticalIcon,
            StickRUpIcon,
            StickRDownIcon,
        ],
    },
    [GamepadIconSet.Xbox]: {
        [KnownInput.FaceAccept]: [XboxButtonAIcon],
        [KnownInput.FaceCancel]: [XboxButtonBIcon],
        [KnownInput.FaceAlt1]: [XboxButtonXIcon],
        [KnownInput.FaceAlt2]: [XboxButtonYIcon],
        [KnownInput.L1]: [XboxLbIcon],
        [KnownInput.L2]: [XboxLtIcon],
        [KnownInput.L3]: [StickLPressIcon],
        [KnownInput.R1]: [XboxRbIcon],
        [KnownInput.R2]: [XboxRtIcon],
        [KnownInput.R3]: [StickRPressIcon],
        [KnownInput.LeftStickX]: [
            StickLHorizontalIcon,
            StickLLeftIcon,
            StickLRightIcon,
        ],
        [KnownInput.LeftStickY]: [
            StickLVerticalIcon,
            StickLUpIcon,
            StickLDownIcon,
        ],
        [KnownInput.RightStickX]: [
            StickRHorizontalIcon,
            StickRLeftIcon,
            StickRRightIcon,
        ],
        [KnownInput.RightStickY]: [
            StickRVerticalIcon,
            StickRUpIcon,
            StickRDownIcon,
        ],
        [KnownInput.DPad]: [DpadNoneIcon],
        [KnownInput.DPadDown]: [DpadDownIcon],
        [KnownInput.DPadLeft]: [DpadLeftIcon],
        [KnownInput.DPadRight]: [DpadRightIcon],
        [KnownInput.DPadUp]: [DpadUpIcon],
        [KnownInput.Select]: [
            XboxButtonViewIcon,
            ButtonBackIcon,
        ],
        [KnownInput.Logo]: [XboxGuideIcon],
        [KnownInput.Start]: [
            XboxButtonMenuIcon,
            ButtonStartIcon,
        ],
        [KnownInput.Share]: [XboxButtonShareIcon],
    },
};

/**
 * A gamepad stick axis input.
 *
 * @category Icons
 */
export type GamepadStickInput =
    | KnownInput.LeftStickX
    | KnownInput.LeftStickY
    | KnownInput.RightStickX
    | KnownInput.RightStickY;

/**
 * Icons for each direction of each stick axis, per {@link GamepadIconSet}. Negative is left or up,
 * positive is right or down, and flat is the whole axis. Sticks a gamepad lacks are missing.
 *
 * @category Icons
 */
export const gamepadIconSetStickIcons: Readonly<
    Record<
        GamepadIconSet,
        Readonly<Partial<Record<GamepadStickInput, Readonly<Record<InputDirection, ViraIconSvg>>>>>
    >
> = {
    [GamepadIconSet.MetaQuest]: {
        [KnownInput.LeftStickX]: {
            [InputDirection.Flat]: StickLHorizontalIcon,
            [InputDirection.Negative]: StickLLeftIcon,
            [InputDirection.Positive]: StickLRightIcon,
        },
        [KnownInput.LeftStickY]: {
            [InputDirection.Flat]: StickLVerticalIcon,
            [InputDirection.Negative]: StickLUpIcon,
            [InputDirection.Positive]: StickLDownIcon,
        },
        [KnownInput.RightStickX]: {
            [InputDirection.Flat]: StickRHorizontalIcon,
            [InputDirection.Negative]: StickRLeftIcon,
            [InputDirection.Positive]: StickRRightIcon,
        },
        [KnownInput.RightStickY]: {
            [InputDirection.Flat]: StickRVerticalIcon,
            [InputDirection.Negative]: StickRUpIcon,
            [InputDirection.Positive]: StickRDownIcon,
        },
    },
    [GamepadIconSet.NintendoGamecube]: {
        [KnownInput.LeftStickX]: {
            [InputDirection.Flat]: StickHorizontalIcon,
            [InputDirection.Negative]: StickLeftIcon,
            [InputDirection.Positive]: StickRightIcon,
        },
        [KnownInput.LeftStickY]: {
            [InputDirection.Flat]: StickVerticalIcon,
            [InputDirection.Negative]: StickUpIcon,
            [InputDirection.Positive]: StickDownIcon,
        },
        [KnownInput.RightStickX]: {
            [InputDirection.Flat]: GamecubeStickCHorizontalIcon,
            [InputDirection.Negative]: GamecubeStickCLeftIcon,
            [InputDirection.Positive]: GamecubeStickCRightIcon,
        },
        [KnownInput.RightStickY]: {
            [InputDirection.Flat]: GamecubeStickCVerticalIcon,
            [InputDirection.Negative]: GamecubeStickCUpIcon,
            [InputDirection.Positive]: GamecubeStickCDownIcon,
        },
    },
    [GamepadIconSet.NintendoSwitch]: {
        [KnownInput.LeftStickX]: {
            [InputDirection.Flat]: StickLHorizontalIcon,
            [InputDirection.Negative]: StickLLeftIcon,
            [InputDirection.Positive]: StickLRightIcon,
        },
        [KnownInput.LeftStickY]: {
            [InputDirection.Flat]: StickLVerticalIcon,
            [InputDirection.Negative]: StickLUpIcon,
            [InputDirection.Positive]: StickLDownIcon,
        },
        [KnownInput.RightStickX]: {
            [InputDirection.Flat]: StickRHorizontalIcon,
            [InputDirection.Negative]: StickRLeftIcon,
            [InputDirection.Positive]: StickRRightIcon,
        },
        [KnownInput.RightStickY]: {
            [InputDirection.Flat]: StickRVerticalIcon,
            [InputDirection.Negative]: StickRUpIcon,
            [InputDirection.Positive]: StickRDownIcon,
        },
    },
    [GamepadIconSet.NintendoSwitch2]: {
        [KnownInput.LeftStickX]: {
            [InputDirection.Flat]: StickLHorizontalIcon,
            [InputDirection.Negative]: StickLLeftIcon,
            [InputDirection.Positive]: StickLRightIcon,
        },
        [KnownInput.LeftStickY]: {
            [InputDirection.Flat]: StickLVerticalIcon,
            [InputDirection.Negative]: StickLUpIcon,
            [InputDirection.Positive]: StickLDownIcon,
        },
        [KnownInput.RightStickX]: {
            [InputDirection.Flat]: StickRHorizontalIcon,
            [InputDirection.Negative]: StickRLeftIcon,
            [InputDirection.Positive]: StickRRightIcon,
        },
        [KnownInput.RightStickY]: {
            [InputDirection.Flat]: StickRVerticalIcon,
            [InputDirection.Negative]: StickRUpIcon,
            [InputDirection.Positive]: StickRDownIcon,
        },
    },
    [GamepadIconSet.NintendoWii]: {
        [KnownInput.LeftStickX]: {
            [InputDirection.Flat]: StickLHorizontalIcon,
            [InputDirection.Negative]: StickLLeftIcon,
            [InputDirection.Positive]: StickLRightIcon,
        },
        [KnownInput.LeftStickY]: {
            [InputDirection.Flat]: StickLVerticalIcon,
            [InputDirection.Negative]: StickLUpIcon,
            [InputDirection.Positive]: StickLDownIcon,
        },
        [KnownInput.RightStickX]: {
            [InputDirection.Flat]: StickRHorizontalIcon,
            [InputDirection.Negative]: StickRLeftIcon,
            [InputDirection.Positive]: StickRRightIcon,
        },
        [KnownInput.RightStickY]: {
            [InputDirection.Flat]: StickRVerticalIcon,
            [InputDirection.Negative]: StickRUpIcon,
            [InputDirection.Positive]: StickRDownIcon,
        },
    },
    [GamepadIconSet.NintendoWiiU]: {
        [KnownInput.LeftStickX]: {
            [InputDirection.Flat]: StickLHorizontalIcon,
            [InputDirection.Negative]: StickLLeftIcon,
            [InputDirection.Positive]: StickLRightIcon,
        },
        [KnownInput.LeftStickY]: {
            [InputDirection.Flat]: StickLVerticalIcon,
            [InputDirection.Negative]: StickLUpIcon,
            [InputDirection.Positive]: StickLDownIcon,
        },
        [KnownInput.RightStickX]: {
            [InputDirection.Flat]: StickRHorizontalIcon,
            [InputDirection.Negative]: StickRLeftIcon,
            [InputDirection.Positive]: StickRRightIcon,
        },
        [KnownInput.RightStickY]: {
            [InputDirection.Flat]: StickRVerticalIcon,
            [InputDirection.Negative]: StickRUpIcon,
            [InputDirection.Positive]: StickRDownIcon,
        },
    },
    [GamepadIconSet.PlayStation]: {
        [KnownInput.LeftStickX]: {
            [InputDirection.Flat]: StickLHorizontalIcon,
            [InputDirection.Negative]: StickLLeftIcon,
            [InputDirection.Positive]: StickLRightIcon,
        },
        [KnownInput.LeftStickY]: {
            [InputDirection.Flat]: StickLVerticalIcon,
            [InputDirection.Negative]: StickLUpIcon,
            [InputDirection.Positive]: StickLDownIcon,
        },
        [KnownInput.RightStickX]: {
            [InputDirection.Flat]: StickRHorizontalIcon,
            [InputDirection.Negative]: StickRLeftIcon,
            [InputDirection.Positive]: StickRRightIcon,
        },
        [KnownInput.RightStickY]: {
            [InputDirection.Flat]: StickRVerticalIcon,
            [InputDirection.Negative]: StickRUpIcon,
            [InputDirection.Positive]: StickRDownIcon,
        },
    },
    [GamepadIconSet.SteamController]: {
        [KnownInput.LeftStickX]: {
            [InputDirection.Flat]: StickHorizontalIcon,
            [InputDirection.Negative]: StickLeftIcon,
            [InputDirection.Positive]: StickRightIcon,
        },
        [KnownInput.LeftStickY]: {
            [InputDirection.Flat]: StickVerticalIcon,
            [InputDirection.Negative]: StickUpIcon,
            [InputDirection.Positive]: StickDownIcon,
        },
    },
    [GamepadIconSet.SteamDeck]: {
        [KnownInput.LeftStickX]: {
            [InputDirection.Flat]: StickLHorizontalIcon,
            [InputDirection.Negative]: StickLLeftIcon,
            [InputDirection.Positive]: StickLRightIcon,
        },
        [KnownInput.LeftStickY]: {
            [InputDirection.Flat]: StickLVerticalIcon,
            [InputDirection.Negative]: StickLUpIcon,
            [InputDirection.Positive]: StickLDownIcon,
        },
        [KnownInput.RightStickX]: {
            [InputDirection.Flat]: StickRHorizontalIcon,
            [InputDirection.Negative]: StickRLeftIcon,
            [InputDirection.Positive]: StickRRightIcon,
        },
        [KnownInput.RightStickY]: {
            [InputDirection.Flat]: StickRVerticalIcon,
            [InputDirection.Negative]: StickRUpIcon,
            [InputDirection.Positive]: StickRDownIcon,
        },
    },
    [GamepadIconSet.SteamFrame]: {
        [KnownInput.LeftStickX]: {
            [InputDirection.Flat]: StickLHorizontalIcon,
            [InputDirection.Negative]: StickLLeftIcon,
            [InputDirection.Positive]: StickLRightIcon,
        },
        [KnownInput.LeftStickY]: {
            [InputDirection.Flat]: StickLVerticalIcon,
            [InputDirection.Negative]: StickLUpIcon,
            [InputDirection.Positive]: StickLDownIcon,
        },
        [KnownInput.RightStickX]: {
            [InputDirection.Flat]: StickRHorizontalIcon,
            [InputDirection.Negative]: StickRLeftIcon,
            [InputDirection.Positive]: StickRRightIcon,
        },
        [KnownInput.RightStickY]: {
            [InputDirection.Flat]: StickRVerticalIcon,
            [InputDirection.Negative]: StickRUpIcon,
            [InputDirection.Positive]: StickRDownIcon,
        },
    },
    [GamepadIconSet.ValveIndex]: {
        [KnownInput.LeftStickX]: {
            [InputDirection.Flat]: StickLHorizontalIcon,
            [InputDirection.Negative]: StickLLeftIcon,
            [InputDirection.Positive]: StickLRightIcon,
        },
        [KnownInput.LeftStickY]: {
            [InputDirection.Flat]: StickLVerticalIcon,
            [InputDirection.Negative]: StickLUpIcon,
            [InputDirection.Positive]: StickLDownIcon,
        },
        [KnownInput.RightStickX]: {
            [InputDirection.Flat]: StickRHorizontalIcon,
            [InputDirection.Negative]: StickRLeftIcon,
            [InputDirection.Positive]: StickRRightIcon,
        },
        [KnownInput.RightStickY]: {
            [InputDirection.Flat]: StickRVerticalIcon,
            [InputDirection.Negative]: StickRUpIcon,
            [InputDirection.Positive]: StickRDownIcon,
        },
    },
    [GamepadIconSet.Xbox]: {
        [KnownInput.LeftStickX]: {
            [InputDirection.Flat]: StickLHorizontalIcon,
            [InputDirection.Negative]: StickLLeftIcon,
            [InputDirection.Positive]: StickLRightIcon,
        },
        [KnownInput.LeftStickY]: {
            [InputDirection.Flat]: StickLVerticalIcon,
            [InputDirection.Negative]: StickLUpIcon,
            [InputDirection.Positive]: StickLDownIcon,
        },
        [KnownInput.RightStickX]: {
            [InputDirection.Flat]: StickRHorizontalIcon,
            [InputDirection.Negative]: StickRLeftIcon,
            [InputDirection.Positive]: StickRRightIcon,
        },
        [KnownInput.RightStickY]: {
            [InputDirection.Flat]: StickRVerticalIcon,
            [InputDirection.Negative]: StickRUpIcon,
            [InputDirection.Positive]: StickRDownIcon,
        },
    },
};
