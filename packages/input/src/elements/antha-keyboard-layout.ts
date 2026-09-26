/** @category Internal */
export enum AnthaKeyboardSpecialKey {
    Backspace = 'backspace',
    Enter = 'enter',
    Tab = 'tab',
    NavLeft = 'nav-left',
    NavRight = 'nav-right',
    Paste = 'paste',
    HideKeyboard = 'hide-keyboard',
    CapsLock = 'caps-lock',
    LeftShift = 'left-shift',
    RightShift = 'right-shift',
    ClearAll = 'clear-all',
}

/** @category Internal */
export enum ToggleKey {
    Shift = 'shift',
    CapsLock = 'caps-lock',
}

/** @category Internal */
export enum SpecialKeyLabelAlignment {
    Left = 'left',
    Right = 'right',
    Center = 'center',
}

/** @category Internal */
export type LetterKey = {
    key: string;
    shiftedKey?: string;

    navX: number;
    navWidth?: number;
    isWide?: boolean;
    label?: string;

    special?: never;
    toggleKey?: never;
    alignment?: never;
};

/** @category Internal */
export type SpecialKey = {
    special: AnthaKeyboardSpecialKey;
    label: string;
    alignment: SpecialKeyLabelAlignment;
    isWide?: boolean;
    toggleKey?: ToggleKey;

    navX: number;
    navWidth?: number;

    shiftedKey?: never;
    key?: never;
};

/** @category Internal */
export type KeyboardKey = Readonly<LetterKey | SpecialKey>;

/** @category Internal */
export const anthaKeyboardRows: ReadonlyArray<ReadonlyArray<KeyboardKey>> = [
    [
        {
            key: '`',
            shiftedKey: '~',
            navX: 1,
        },
        {
            key: '1',
            shiftedKey: '!',
            navX: 2,
        },
        {
            key: '2',
            shiftedKey: '@',
            navX: 3,
        },
        {
            key: '3',
            shiftedKey: '#',
            navX: 4,
        },
        {
            key: '4',
            shiftedKey: '$',
            navX: 5,
        },
        {
            key: '5',
            shiftedKey: '%',
            navX: 6,
        },
        {
            key: '6',
            shiftedKey: '^',
            navX: 7,
        },
        {
            key: '7',
            shiftedKey: '&',
            navX: 8,
        },
        {
            key: '8',
            shiftedKey: '*',
            navX: 9,
        },
        {
            key: '9',
            shiftedKey: '(',
            navX: 10,
        },
        {
            key: '0',
            shiftedKey: ')',
            navX: 11,
        },
        {
            key: '-',
            shiftedKey: '_',
            navX: 12,
        },
        {
            key: '=',
            shiftedKey: '+',
            navX: 13,
        },
        {
            special: AnthaKeyboardSpecialKey.Backspace,
            isWide: true,
            label: 'Backspace',
            alignment: SpecialKeyLabelAlignment.Right,
            navX: 14,
        },
    ],
    [
        {
            special: AnthaKeyboardSpecialKey.Tab,
            isWide: true,
            alignment: SpecialKeyLabelAlignment.Left,
            label: 'Tab',
            navX: 1,
        },
        {
            key: 'q',
            navX: 3,
        },
        {
            key: 'w',
            navX: 4,
        },
        {
            key: 'e',
            navX: 5,
        },
        {
            key: 'r',
            navX: 6,
        },
        {
            key: 't',
            navX: 7,
        },
        {
            key: 'y',
            navX: 8,
        },
        {
            key: 'u',
            navX: 9,
        },
        {
            key: 'i',
            navX: 10,
        },
        {
            key: 'o',
            navX: 11,
        },
        {
            key: 'p',
            navX: 12,
        },
        {
            key: '[',
            shiftedKey: '{',
            navX: 13,
        },
        {
            key: ']',
            shiftedKey: '}',
            navX: 14,
        },
        {
            key: '\\',
            shiftedKey: '|',
            navX: 15,
        },
    ],
    [
        {
            special: AnthaKeyboardSpecialKey.CapsLock,
            alignment: SpecialKeyLabelAlignment.Left,
            toggleKey: ToggleKey.CapsLock,
            isWide: true,
            label: 'Caps',
            navX: 1,
        },
        {
            key: 'a',
            navX: 3,
        },
        {
            key: 's',
            navX: 4,
        },
        {
            key: 'd',
            navX: 5,
        },
        {
            key: 'f',
            navX: 6,
        },
        {
            key: 'g',
            navX: 7,
        },
        {
            key: 'h',
            navX: 8,
        },
        {
            key: 'j',
            navX: 9,
        },
        {
            key: 'k',
            navX: 10,
        },
        {
            key: 'l',
            navX: 11,
        },
        {
            key: ';',
            shiftedKey: ':',
            navX: 12,
        },
        {
            key: "'",
            shiftedKey: '"',
            navX: 13,
        },
        {
            special: AnthaKeyboardSpecialKey.Enter,
            alignment: SpecialKeyLabelAlignment.Right,
            isWide: true,
            label: 'Enter',
            navX: 14,
        },
    ],
    [
        {
            special: AnthaKeyboardSpecialKey.LeftShift,
            alignment: SpecialKeyLabelAlignment.Left,
            toggleKey: ToggleKey.Shift,
            isWide: true,
            label: 'Shift',
            navX: 1,
        },
        {
            key: 'z',
            navX: 3,
        },
        {
            key: 'x',
            navX: 4,
        },
        {
            key: 'c',
            navX: 5,
        },
        {
            key: 'v',
            navX: 6,
        },
        {
            key: 'b',
            navX: 7,
        },
        {
            key: 'n',
            navX: 8,
        },
        {
            key: 'm',
            navX: 9,
        },
        {
            key: ',',
            shiftedKey: '<',
            navX: 10,
        },
        {
            key: '.',
            shiftedKey: '>',
            navX: 11,
        },
        {
            key: '/',
            shiftedKey: '?',
            navX: 12,
        },
        {
            special: AnthaKeyboardSpecialKey.RightShift,
            alignment: SpecialKeyLabelAlignment.Right,
            toggleKey: ToggleKey.Shift,
            label: 'Shift',
            isWide: true,
            navX: 14,
            navWidth: 2,
        },
    ],
    [
        {
            special: AnthaKeyboardSpecialKey.ClearAll,
            alignment: SpecialKeyLabelAlignment.Left,
            label: 'Clear',
            navX: 0,
        },
        {
            key: ' ',
            navX: 1,
            navWidth: 11,
            isWide: true,
            label: 'Space',
        },
        {
            special: AnthaKeyboardSpecialKey.NavLeft,
            alignment: SpecialKeyLabelAlignment.Center,
            label: '←',
            navX: 12,
        },
        {
            special: AnthaKeyboardSpecialKey.NavRight,
            alignment: SpecialKeyLabelAlignment.Center,
            label: '→',
            navX: 14,
        },
        {
            special: AnthaKeyboardSpecialKey.Paste,
            alignment: SpecialKeyLabelAlignment.Center,
            label: 'Paste',
            navX: 15,
        },
        {
            special: AnthaKeyboardSpecialKey.HideKeyboard,
            alignment: SpecialKeyLabelAlignment.Center,
            label: 'Hide',
            navX: 15,
        },
    ],
];
