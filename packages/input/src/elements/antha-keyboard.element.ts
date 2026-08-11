import {assertWrap} from '@augment-vir/assert';
import {clamp, type PartialWithUndefined, type RequireExactlyOne} from '@augment-vir/common';
import {nav, navAttribute, type NavController, NavValue} from 'device-navigation';
import {
    classMap,
    css,
    defineElement,
    defineElementEvent,
    html,
    listen,
    nothing,
    onDomCreated,
} from 'element-vir';
import {
    noNativeSpacing,
    noUserSelect,
    viraAnimationDurations,
    ViraBoldText,
    ViraInput,
    ViraTextArea,
    viraTheme,
} from 'vira';

/**
 * Keypress details emitted by the `keyPress` event from {@link AnthaKeyboard}.
 *
 * @category Internal
 */
export type AnthaKeyboardKeyPress = RequireExactlyOne<{
    typedCharacter: string;
    special: AnthaKeyboardSpecialKey;
}>;

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

enum SpecialKeyLabelAlignment {
    Left = 'left',
    Right = 'right',
    Center = 'center',
}

type LetterKey = {
    key: string;
    shiftedKey?: string;
    hidden?: boolean;

    navX: number;
    navWidth?: number;
    isWide?: boolean;
    label?: string;

    special?: never;
    toggleKey?: never;
    alignment?: never;
};

type SpecialKey = {
    special: AnthaKeyboardSpecialKey;
    label: string;
    alignment: SpecialKeyLabelAlignment;
    isWide?: boolean;
    toggleKey?: ToggleKey;
    hidden?: boolean;

    navX: number;
    navWidth?: number;

    shiftedKey?: never;
    key?: never;
};

type KeyboardKey = Readonly<LetterKey | SpecialKey>;

type KeyboardToggleState = Partial<Record<ToggleKey, boolean>>;

const keyboardToggleHandlers: Record<
    ToggleKey,
    (params: Readonly<{toggled: KeyboardToggleState}>) => KeyboardToggleState
> = {
    [ToggleKey.Shift]({toggled}) {
        return {
            ...toggled,
            [ToggleKey.Shift]: !toggled[ToggleKey.Shift],
        };
    },
    [ToggleKey.CapsLock]({toggled}) {
        return {
            ...toggled,
            [ToggleKey.Shift]: false,
            [ToggleKey.CapsLock]: !toggled[ToggleKey.CapsLock],
        };
    },
};

function pressKeyboardKey({
    key,
    isUppercase,
    toggled,
}: Readonly<{
    key: KeyboardKey;
    isUppercase: boolean;
    toggled: KeyboardToggleState;
}>): Readonly<{
    keyPress: AnthaKeyboardKeyPress;
    toggled: KeyboardToggleState | undefined;
}> {
    const keyPress: AnthaKeyboardKeyPress = key.special
        ? {
              special: key.special,
          }
        : {
              typedCharacter: key.shiftedKey
                  ? toggled[ToggleKey.Shift] && key.shiftedKey
                      ? key.shiftedKey
                      : key.key
                  : isUppercase
                    ? key.key.toUpperCase()
                    : key.key,
          };

    const toggledFromSpecial = key.toggleKey
        ? keyboardToggleHandlers[key.toggleKey]({
              toggled,
          })
        : undefined;

    const toggledAfterShift =
        toggled[ToggleKey.Shift] && (key.shiftedKey || !key.special)
            ? {
                  ...(toggledFromSpecial || toggled),
                  [ToggleKey.Shift]: false,
              }
            : toggledFromSpecial;

    return {
        keyPress,
        toggled: toggledAfterShift,
    };
}

/**
 * An on-screen keyboard that works with `AnthaMenuNavMod` to allow navigation by controller.
 *
 * @category Pre-Build Mods
 */
export const AnthaKeyboard = defineElement<
    {
        navController: NavController;
    } & PartialWithUndefined<{
        /**
         * If set to `true`, a "Hide" (keyboard hide) button is shown.
         *
         * @default false
         */
        showHideButton: boolean;
        /**
         * If `true`, a text box with the currently entered text is not rendered above the keyboard.
         *
         * @default false
         */
        hideText: boolean;
        /**
         * Max length of the text.
         *
         * @default 128
         */
        maxLength: number;
    }>
>()({
    tagName: 'antha-keyboard',
    events: {
        keyPress: defineElementEvent<AnthaKeyboardKeyPress>(),
        valueChange: defineElementEvent<string>(),
    },
    styles: css`
        :host {
            display: flex;
            flex-direction: column;
            gap: 16px;
            font-family: sans-serif;
        }

        ${ViraTextArea}, ${ViraInput} {
            width: 100%;
        }

        .entered-text {
            cursor: pointer;
            box-sizing: border-box;
            width: 0;
            max-width: 100%;
            min-width: 100%;
            overflow: hidden;
            white-space: pre;
            padding: 8px 16px;
            height: calc(1em + 20px);
            background: ${viraTheme.colors['vira-grey-behind-fg-highest-contrast'].background
                .value};
            border: 2px solid
                ${viraTheme.colors['vira-grey-foreground-decoration'].foreground.value};
            border-radius: 8px;

            &:hover {
                border-color: ${viraTheme.colors['vira-brand-foreground-header'].foreground.value};
            }
        }

        .beam {
            display: inline-block;
            width: 3px;
            height: calc(1em + 4px);
            margin-top: -1px;
            margin-right: -3px;
            background: red;
            vertical-align: middle;
            animation: blink 1s linear infinite;
        }
        @keyframes blink {
            60% {
                opacity: 1;
            }
            80% {
                opacity: 0.2;
            }
            100% {
                opacity: 1;
            }
        }

        .keyboard-wrapper {
            display: flex;
            flex-direction: column;
            gap: 4px;
            ${noUserSelect}

            & .row {
                display: flex;
                gap: inherit;
            }

            & button {
                ${noNativeSpacing};
                min-width: 40px;
                height: 40px;
                border: 1px solid
                    ${viraTheme.colors['vira-grey-foreground-header'].foreground.value};
                border-radius: 4px;
                background-color: ${viraTheme.colors['vira-grey-behind-fg-highest-contrast']
                    .background.value};
                font: inherit;
                cursor: pointer;
                ${noUserSelect}

                &.left-aligned {
                    text-align: left;
                }

                &.right-aligned {
                    text-align: right;
                }

                &.with-label {
                    padding: 0 8px;
                }

                &.toggled-on {
                    background-color: ${viraTheme.colors['vira-blue-behind-fg-small-body']
                        .background.value};
                    font-weight: bold;
                }

                & * {
                    pointer-events: none;
                }

                & ${ViraBoldText} {
                    ${noUserSelect}
                }

                & .key-label {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 2px;

                    & .secondary-label {
                        font-size: 0.6em;
                        opacity: 0.6;
                    }
                    > span {
                        transition: font-size
                            ${viraAnimationDurations['vira-interaction-animation-duration'].value};
                    }
                }
            }

            &
                ${navAttribute.css({
                    baseSelector: 'button',
                    navValue: NavValue.Focused,
                })} {
                font-weight: bold;
                outline: 4px solid
                    ${viraTheme.colors['vira-brand-foreground-header'].foreground.value};
                outline-offset: -1px;

                &:not(.toggled-on) {
                    background-color: ${viraTheme.colors['vira-grey-behind-fg-small-body']
                        .background.value};
                }
            }

            &
                ${navAttribute.css({
                    baseSelector: 'button',
                    navValue: NavValue.Active,
                })} {
                font-weight: bold;
                outline: 4px solid
                    ${viraTheme.colors['vira-brand-foreground-non-body'].foreground.value};
                outline-offset: -1px;
                margin-top: 1px;
                margin-bottom: -1px;

                &:not(.toggled-on) {
                    background-color: ${viraTheme.colors['vira-grey-behind-fg-body'].background
                        .value};
                }
            }

            & .wide-key {
                padding: 0 10px;
                flex-grow: 1;
            }
        }
    `,
    state() {
        return {
            value: '',
            toggled: {} as KeyboardToggleState,
            cursorPosition: 0,
            beamElement: undefined as undefined | HTMLElement,
            arrowRepeatDelay: undefined as undefined | ReturnType<typeof globalThis.setTimeout>,
            arrowRepeatInterval: undefined as undefined | ReturnType<typeof globalThis.setInterval>,
        };
    },
    render({dispatch, events, inputs, state, updateState}) {
        const keyboardRows: ReadonlyArray<ReadonlyArray<KeyboardKey>> = [
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
                    hidden: !inputs.showHideButton,
                },
            ],
        ];

        const isUppercase: boolean =
            state.toggled[ToggleKey.CapsLock] || !!state.toggled[ToggleKey.Shift];

        async function performKeyPress(key: KeyboardKey) {
            const result = pressKeyboardKey({
                key,
                isUppercase,
                toggled: state.toggled,
            });

            if (result.toggled) {
                updateState({
                    toggled: result.toggled,
                });
            }

            const oldValue = state.value;
            const newValue = await handleKeyPress({
                keyPress: result.keyPress,
                currentValue: oldValue,
                cursorPosition: state.cursorPosition,
                maxLength: Math.round(Math.abs(inputs.maxLength || 0)) || 128,
            });

            updateState({
                value: newValue,
            });

            if (result.keyPress.special === AnthaKeyboardSpecialKey.NavLeft) {
                updateState({
                    cursorPosition: Math.max(state.cursorPosition - 1, 0),
                });
            } else if (result.keyPress.special === AnthaKeyboardSpecialKey.NavRight) {
                updateState({
                    cursorPosition: Math.min(state.cursorPosition + 1, state.value.length),
                });
            }

            if (oldValue !== newValue) {
                const lengthDiff = newValue.length - oldValue.length;

                updateState({
                    cursorPosition: state.cursorPosition + lengthDiff,
                });

                dispatch(new events.valueChange(newValue));
            }

            if (state.beamElement) {
                scrollBeamIntoView(state.beamElement);
            }

            dispatch(new events.keyPress(result.keyPress));
        }

        function stopArrowRepeat() {
            if (state.arrowRepeatDelay != undefined) {
                globalThis.clearTimeout(state.arrowRepeatDelay);
            }
            if (state.arrowRepeatInterval != undefined) {
                globalThis.clearInterval(state.arrowRepeatInterval);
            }

            updateState({
                arrowRepeatDelay: undefined,
                arrowRepeatInterval: undefined,
            });
        }

        function startArrowRepeat(key: KeyboardKey) {
            /** Don't start a second timer if one is already running for the held key. */
            if (state.arrowRepeatDelay != undefined || state.arrowRepeatInterval != undefined) {
                return;
            }

            /** Hold duration before auto-repeat kicks in, then the interval between repeats. */
            updateState({
                arrowRepeatDelay: globalThis.setTimeout(() => {
                    updateState({
                        arrowRepeatInterval: globalThis.setInterval(() => {
                            void performKeyPress(key);
                        }, 80),
                    });
                }, 400),
            });
        }

        const keyboardTemplate = keyboardRows.map((row, y) => {
            return html`
                <div class="row">
                    ${row.map((key) => {
                        if (key.hidden) {
                            return;
                        }
                        const contents = key.label
                            ? html`
                                  <${ViraBoldText.assign({
                                      /** Boldness will be applied via CSS. */
                                      bold: false,
                                      text: key.label,
                                  })}></${ViraBoldText}>
                              `
                            : key.shiftedKey
                              ? html`
                                    <span class="key-label">
                                        <span
                                            class=${classMap({
                                                'secondary-label': !state.toggled[ToggleKey.Shift],
                                            })}
                                        >
                                            ${key.shiftedKey}
                                        </span>
                                        <span
                                            class=${classMap({
                                                'secondary-label': !!state.toggled[ToggleKey.Shift],
                                            })}
                                        >
                                            ${key.key}
                                        </span>
                                    </span>
                                `
                              : isUppercase
                                ? assertWrap.isDefined(key.key).toUpperCase()
                                : assertWrap.isDefined(key.key);

                        return html`
                            <button
                                class=${classMap({
                                    'wide-key': !!key.isWide,
                                    'with-label': !!key.label,
                                    'toggled-on': !!key.toggleKey && !!state.toggled[key.toggleKey],
                                    'left-aligned': key.alignment === SpecialKeyLabelAlignment.Left,
                                    'right-aligned':
                                        key.alignment === SpecialKeyLabelAlignment.Right,
                                })}
                                ${nav(inputs.navController, {
                                    x: key.navX,
                                    width: key.navWidth,
                                    y,
                                    listeners: {
                                        async activate({enabled}) {
                                            if (enabled) {
                                                await performKeyPress(key);

                                                if (
                                                    key.special ===
                                                        AnthaKeyboardSpecialKey.NavLeft ||
                                                    key.special === AnthaKeyboardSpecialKey.NavRight
                                                ) {
                                                    startArrowRepeat(key);
                                                }
                                            } else {
                                                stopArrowRepeat();
                                            }
                                        },
                                    },
                                })}
                            >
                                ${contents}
                            </button>
                        `;
                    })}
                </div>
            `;
        });

        // prettier-ignore
        const textContent = html`${state.value.slice(0, state.cursorPosition)}<span class="beam" 
            ${onDomCreated((element) => {
                updateState({
                    beamElement: assertWrap.instanceOf( element, HTMLElement),
                });
            })}></span>${state.value.slice(state.cursorPosition)}`

        const textElement = inputs.hideText
            ? nothing
            : // prettier-ignore
              html`
                  <div
                      class="entered-text"
                      ${listen('click', (event) => {
                          event.stopImmediatePropagation();

                          const newValue = prompt('', state.value);
                          
                          if (newValue == null) {
                              return;
                          }
                          
                          updateState({
                              value: newValue,
                              cursorPosition: newValue.length,
                          });

                          if (state.beamElement) {
                              scrollBeamIntoView(state.beamElement);
                          }
                      })}
                  >${textContent}</div>
              `;

        return html`
            ${textElement}
            <div class="keyboard-wrapper">${keyboardTemplate}</div>
        `;
    },
});

/**
 * Scrolls the entered-text container so the cursor (beam) stays within the visible band, keeping
 * `edgePadding` of space between the beam and either edge. Reads the beam's live layout position
 * rather than measuring text substrings.
 */
function scrollBeamIntoView(beam: Readonly<HTMLElement>) {
    requestAnimationFrame(() => {
        const container = beam.parentElement;
        /* c8 ignore next 3 */
        if (!container) {
            return;
        }

        const edgePadding = 24;
        const beamRect = beam.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        if (beamRect.left < containerRect.left + edgePadding) {
            container.scrollLeft -= containerRect.left + edgePadding - beamRect.left;
        } else if (beamRect.right > containerRect.right - edgePadding) {
            container.scrollLeft += beamRect.right - (containerRect.right - edgePadding);
        }
    });
}

/**
 * A helper for handling key press events from {@link AnthaKeyboard}. This is used internally in
 * {@link AnthaKeyboard} but is useful if you want to hide the keyboard's built-in text pane and use
 * your own processing.
 *
 * @category Internal
 */
export async function handleKeyPress({
    currentValue,
    keyPress,
    cursorPosition,
    maxLength,
}: Readonly<{
    keyPress: Readonly<AnthaKeyboardKeyPress>;
    currentValue: string;
    cursorPosition: number;
    maxLength: number;
}>): Promise<string> {
    cursorPosition = clamp(cursorPosition, {
        max: currentValue.length,
        min: 0,
    });

    if (keyPress.special === AnthaKeyboardSpecialKey.ClearAll) {
        return '';
    } else if (keyPress.special === AnthaKeyboardSpecialKey.Backspace) {
        return [
            currentValue.slice(0, Math.max(0, cursorPosition - 1)),
            currentValue.slice(cursorPosition),
        ].join('');
    } else if (currentValue.length >= maxLength) {
        return currentValue;
    } else if (keyPress.typedCharacter) {
        return [
            currentValue.slice(0, cursorPosition),
            keyPress.typedCharacter,
            currentValue.slice(cursorPosition),
        ].join('');
    } else if (keyPress.special === AnthaKeyboardSpecialKey.Paste) {
        const maxAllowedPasteLength = maxLength - currentValue.length;

        return [
            currentValue.slice(0, cursorPosition),
            (await globalThis.navigator.clipboard.readText())
                .replaceAll(/[\n\r]/g, ' ')
                .slice(0, maxAllowedPasteLength),
            currentValue.slice(cursorPosition),
        ].join('');
    } else {
        return currentValue;
    }
}
