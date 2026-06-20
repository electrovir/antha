import {assert, assertWrap, waitUntil} from '@augment-vir/assert';
import {wait} from '@augment-vir/common';
import {describe, it, itCases, testWeb} from '@augment-vir/test';
import {extractNavEntry, NavController} from 'device-navigation';
import {AnthaKeyboard, AnthaKeyboardSpecialKey, handleKeyPress} from './antha-keyboard.element.js';

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

async function renderKeyboard(inputs: Readonly<Partial<typeof AnthaKeyboard.InputsType>> = {}) {
    const fixture = await testWeb.renderElement(AnthaKeyboard, {
        navController: new NavController(document.body),
        ...inputs,
    });

    await fixture.updateComplete;

    return fixture;
}

function getKeyboardButtons(fixture: InstanceType<typeof AnthaKeyboard>): HTMLButtonElement[] {
    return Array.from(fixture.shadowRoot.querySelectorAll('button'));
}

function getKeyboardState(fixture: Readonly<InstanceType<typeof AnthaKeyboard>>) {
    return fixture._lastRenderedProps.state;
}

async function activateButton(button: Readonly<HTMLButtonElement>) {
    assertWrap.isDefined(extractNavEntry(button)).activate(true);
    await wait({
        milliseconds: 0,
    });
}

async function deactivateButton(button: Readonly<HTMLButtonElement>) {
    assertWrap.isDefined(extractNavEntry(button)).activate(false);
    await wait({
        milliseconds: 0,
    });
}

describe(AnthaKeyboard.tagName, () => {
    it('renders text and keyboard controls', async () => {
        const fixture = await renderKeyboard();

        try {
            assert.instanceOf(fixture, AnthaKeyboard);
            assert.isDefined(fixture.shadowRoot.querySelector('.entered-text'));
            assert.isLengthExactly(getKeyboardButtons(fixture), 58);
        } finally {
            testWeb.cleanupRender();
        }
    });

    it('renders hide button and hidden text mode', async () => {
        const fixture = await renderKeyboard({
            hideText: true,
            showHideButton: true,
        });

        try {
            assert.isUndefined(fixture.shadowRoot.querySelector('.entered-text') || undefined);
            assert.isLengthExactly(getKeyboardButtons(fixture), 59);
        } finally {
            testWeb.cleanupRender();
        }
    });

    it('updates value from activated letter and toggle keys', async () => {
        const fixture = await renderKeyboard({
            maxLength: 8,
        });
        const buttons = getKeyboardButtons(fixture);

        try {
            await waitUntil.isDefined(() => getKeyboardState(fixture).beamElement);

            await activateButton(assertWrap.isDefined(buttons[1]));
            await waitUntil.strictEquals('1', () => getKeyboardState(fixture).value);

            await activateButton(assertWrap.isDefined(buttons[41]));
            await activateButton(assertWrap.isDefined(buttons[29]));
            await waitUntil.strictEquals('1A', () => getKeyboardState(fixture).value);

            await activateButton(assertWrap.isDefined(buttons[41]));
            await activateButton(assertWrap.isDefined(buttons[1]));
            await waitUntil.strictEquals('1A!', () => getKeyboardState(fixture).value);

            await activateButton(assertWrap.isDefined(buttons[28]));
            await activateButton(assertWrap.isDefined(buttons[30]));
            await waitUntil.strictEquals('1A!S', () => getKeyboardState(fixture).value);
        } finally {
            testWeb.cleanupRender();
        }
    });

    it('updates cursor from activated arrow keys', async () => {
        const fixture = await renderKeyboard();
        const buttons = getKeyboardButtons(fixture);

        try {
            await activateButton(assertWrap.isDefined(buttons[29]));
            await waitUntil.strictEquals('a', () => getKeyboardState(fixture).value);

            await activateButton(assertWrap.isDefined(buttons[55]));
            await waitUntil.strictEquals(0, () => getKeyboardState(fixture).cursorPosition);
            await deactivateButton(assertWrap.isDefined(buttons[55]));

            await activateButton(assertWrap.isDefined(buttons[56]));
            await waitUntil.strictEquals(1, () => getKeyboardState(fixture).cursorPosition);
            await waitUntil.isDefined(() => getKeyboardState(fixture).arrowRepeatDelay);
            await wait({
                milliseconds: 450,
            });
            await waitUntil.isDefined(() => getKeyboardState(fixture).arrowRepeatInterval);
            await deactivateButton(assertWrap.isDefined(buttons[56]));
            await waitUntil.isUndefined(() => getKeyboardState(fixture).arrowRepeatDelay);
            await waitUntil.isUndefined(() => getKeyboardState(fixture).arrowRepeatInterval);
        } finally {
            testWeb.cleanupRender();
        }
    });

    it('does not start duplicate arrow repeat timers', async () => {
        const fixture = await renderKeyboard();
        const buttons = getKeyboardButtons(fixture);

        try {
            const button = assertWrap.isDefined(buttons[56]);

            await activateButton(button);

            const arrowRepeatDelay = await waitUntil.isDefined(
                () => getKeyboardState(fixture).arrowRepeatDelay,
            );
            const navEntry = assertWrap.isDefined(extractNavEntry(button));

            await assertWrap.isDefined(navEntry.navParams.listeners?.activate)({
                element: button,
                enabled: true,
                navEntry,
                previousNavValue: undefined,
            });

            assert.strictEquals(getKeyboardState(fixture).arrowRepeatDelay, arrowRepeatDelay);

            await deactivateButton(button);
        } finally {
            testWeb.cleanupRender();
        }
    });

    it('handles prompt edits and non-editing special keys', async () => {
        const originalPrompt = globalThis.prompt;
        const fixture = await renderKeyboard({
            showHideButton: true,
        });
        const buttons = getKeyboardButtons(fixture);

        try {
            await waitUntil.isDefined(() => getKeyboardState(fixture).beamElement);

            globalThis.prompt = () => null;
            assertWrap
                .isDefined(fixture.shadowRoot.querySelector<HTMLElement>('.entered-text'))
                .click();
            await wait({
                milliseconds: 0,
            });
            assert.strictEquals(getKeyboardState(fixture).value, '');

            globalThis.prompt = () => 'typed';
            assertWrap
                .isDefined(fixture.shadowRoot.querySelector<HTMLElement>('.entered-text'))
                .click();
            await waitUntil.strictEquals('typed', () => getKeyboardState(fixture).value);

            await activateButton(assertWrap.isDefined(buttons[57]));
            await waitUntil.strictEquals('typedX Y Z', () => getKeyboardState(fixture).value);

            await activateButton(assertWrap.isDefined(buttons[58]));
            await waitUntil.strictEquals('typedX Y Z', () => getKeyboardState(fixture).value);
        } finally {
            globalThis.prompt = originalPrompt;
            testWeb.cleanupRender();
        }
    });

    it('scrolls cursor into view from the right edge', async () => {
        const fixture = await renderKeyboard();
        const buttons = getKeyboardButtons(fixture);

        try {
            const beamElement = await waitUntil.isDefined(
                () => getKeyboardState(fixture).beamElement,
            );
            const container = assertWrap.instanceOf(beamElement.parentElement, HTMLElement);

            Object.defineProperty(container, 'scrollLeft', {
                configurable: true,
                value: 0,
                writable: true,
            });
            beamElement.getBoundingClientRect = () => {
                return DOMRect.fromRect({
                    x: 160,
                    width: 12,
                });
            };
            container.getBoundingClientRect = () => {
                return DOMRect.fromRect({
                    x: 0,
                    width: 100,
                });
            };

            await activateButton(assertWrap.isDefined(buttons[29]));
            await waitUntil.isAbove(0, () => container.scrollLeft);
        } finally {
            testWeb.cleanupRender();
        }
    });
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
