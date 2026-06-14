import {describe, itCases} from '@augment-vir/test';
import {AnthaKeyboardSpecialKey, handleKeyPress} from './antha-keyboard.element.js';

/** Stripped of newlines this becomes `'X Y Z'` (length 5). */
const fakeClipboardText = 'X\nY\rZ';

Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: {
        readText() {
            return Promise.resolve(fakeClipboardText);
        },
    },
});

describe(handleKeyPress.name, () => {
    itCases(handleKeyPress, [
        {
            it: 'inserts a typed character at the cursor',
            input: {
                currentValue: 'gg',
                cursorPosition: 1,
                maxLength: 128,
                keyPress: {
                    typedCharacter: 'k',
                },
            },
            expect: 'gkg',
        },
        {
            it: 'inserts a typed character at the start',
            input: {
                currentValue: 'bc',
                cursorPosition: 0,
                maxLength: 128,
                keyPress: {
                    typedCharacter: 'a',
                },
            },
            expect: 'abc',
        },
        {
            it: 'inserts a typed character at the end',
            input: {
                currentValue: 'ab',
                cursorPosition: 2,
                maxLength: 128,
                keyPress: {
                    typedCharacter: 'c',
                },
            },
            expect: 'abc',
        },
        {
            it: 'clamps cursor position for typed characters',
            input: {
                currentValue: 'ab',
                cursorPosition: 99,
                maxLength: 128,
                keyPress: {
                    typedCharacter: 'c',
                },
            },
            expect: 'abc',
        },
        {
            it: 'removes the character before the cursor for backspace',
            input: {
                currentValue: 'abc',
                cursorPosition: 2,
                maxLength: 128,
                keyPress: {
                    special: AnthaKeyboardSpecialKey.Backspace,
                },
            },
            expect: 'ac',
        },
        {
            it: 'preserves value when backspace is pressed at the start',
            input: {
                currentValue: 'abc',
                cursorPosition: 0,
                maxLength: 128,
                keyPress: {
                    special: AnthaKeyboardSpecialKey.Backspace,
                },
            },
            expect: 'abc',
        },
        {
            it: 'allows backspace even when at max length',
            input: {
                currentValue: 'abc',
                cursorPosition: 3,
                maxLength: 3,
                keyPress: {
                    special: AnthaKeyboardSpecialKey.Backspace,
                },
            },
            expect: 'ab',
        },
        {
            it: 'clears all text',
            input: {
                currentValue: 'abc',
                cursorPosition: 1,
                maxLength: 128,
                keyPress: {
                    special: AnthaKeyboardSpecialKey.ClearAll,
                },
            },
            expect: '',
        },
        {
            it: 'allows clear all even when at max length',
            input: {
                currentValue: 'abc',
                cursorPosition: 1,
                maxLength: 3,
                keyPress: {
                    special: AnthaKeyboardSpecialKey.ClearAll,
                },
            },
            expect: '',
        },
        {
            it: 'preserves value for non-editing special keys',
            input: {
                currentValue: 'abc',
                cursorPosition: 1,
                maxLength: 128,
                keyPress: {
                    special: AnthaKeyboardSpecialKey.NavLeft,
                },
            },
            expect: 'abc',
        },
        {
            it: 'inserts a typed character when below max length',
            input: {
                currentValue: 'ab',
                cursorPosition: 2,
                maxLength: 3,
                keyPress: {
                    typedCharacter: 'c',
                },
            },
            expect: 'abc',
        },
        {
            it: 'blocks a typed character when at max length',
            input: {
                currentValue: 'abc',
                cursorPosition: 3,
                maxLength: 3,
                keyPress: {
                    typedCharacter: 'd',
                },
            },
            expect: 'abc',
        },
        {
            it: 'pastes the full clipboard and strips newlines when there is room',
            input: {
                currentValue: '',
                cursorPosition: 0,
                maxLength: 10,
                keyPress: {
                    special: AnthaKeyboardSpecialKey.Paste,
                },
            },
            expect: 'X Y Z',
        },
        {
            it: 'truncates a paste so it does not surpass max length',
            input: {
                currentValue: 'ab',
                cursorPosition: 2,
                maxLength: 4,
                keyPress: {
                    special: AnthaKeyboardSpecialKey.Paste,
                },
            },
            expect: 'abX ',
        },
        {
            it: 'blocks a paste when already at max length',
            input: {
                currentValue: 'abc',
                cursorPosition: 1,
                maxLength: 3,
                keyPress: {
                    special: AnthaKeyboardSpecialKey.Paste,
                },
            },
            expect: 'abc',
        },
    ]);
});
