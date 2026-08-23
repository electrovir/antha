/* eslint-disable @typescript-eslint/no-non-null-assertion */

import {assert} from '@augment-vir/assert';
import {describe, it, itCases} from '@augment-vir/test';
import {defaultGamepadLayouts} from './default-layouts.js';
import {findMatchingGamepadLayout, findMatchingGamepadModel} from './find-matches.js';
import {mockLayouts} from './gamepad-layout.mock.js';
import {PredefinedGamepadBrand, PredefinedGamepadModel} from './gamepad-model.js';

describe(findMatchingGamepadLayout.name, () => {
    itCases(findMatchingGamepadLayout, [
        {
            it: 'finds nothing from an unexpected device name',
            input: {
                gamepad: {
                    deviceName: 'hi this is not real',
                },
            },
            expect: undefined,
        },
        {
            it: 'finds nothing when the gamepad is absent',
            input: {
                gamepad: undefined,
            },
            expect: undefined,
        },
        {
            it: 'finds a default layout',
            input: {
                gamepad: {
                    deviceName: 'Pro Controller Extended Gamepad',
                },
                systemVersions: defaultGamepadLayouts[0]!.systemVersions[0]!,
            },
            expect: defaultGamepadLayouts[0],
        },
        {
            it: 'is case insensitive',
            input: {
                gamepad: {
                    deviceName: 'pro controller extended gamepad',
                },
                systemVersions: defaultGamepadLayouts[0]!.systemVersions[0]!,
            },
            expect: defaultGamepadLayouts[0],
        },
        {
            it: 'finds a layout from a string gamepad name',
            input: {
                gamepad: 'Pro Controller Extended Gamepad',
                systemVersions: defaultGamepadLayouts[0]!.systemVersions[0]!,
            },
            expect: defaultGamepadLayouts[0],
        },
        {
            it: 'finds layout with more specific version number',
            input: {
                gamepad: {
                    deviceName: 'Wireless Controller Extended Gamepad',
                },
                layouts: mockLayouts,
                systemVersions: {
                    browserVersion: '17.3.1',
                    browserName: 'Safari',
                    osName: 'macOS',
                    osVersion: '10.15.7',
                },
            },
            expect: mockLayouts[8],
        },
        {
            it: 'finds the Steam Deck Firefox layout for Linux',
            input: {
                gamepad: '28de-11ff-Microsoft X-Box 360 pad 0',
                systemVersions: {
                    browserVersion: '154.0',
                    browserName: 'Firefox',
                    osName: 'Linux',
                    osVersion: '',
                },
            },
            expect: defaultGamepadLayouts[defaultGamepadLayouts.length - 1],
        },
        {
            it: 'finds the Xbox 360 Firefox layout for Linux',
            input: {
                gamepad: '045e-02a1-Xbox 360 Wireless Receiver',
                systemVersions: {
                    browserVersion: '154.0',
                    browserName: 'Firefox',
                    osName: 'Linux',
                    osVersion: '',
                },
            },
            expect: defaultGamepadLayouts[defaultGamepadLayouts.length - 3],
        },
    ]);
});

describe(findMatchingGamepadModel.name, () => {
    itCases(findMatchingGamepadModel, [
        {
            it: 'matches a gamepad object',
            input: {
                gamepad: {
                    deviceName: 'Pro Controller Extended Gamepad',
                },
            },
            expect: {
                gamepadModel: PredefinedGamepadModel.SwitchPro,
                gamepadBrand: PredefinedGamepadBrand.Nintendo,
                gamepadModelDescription:
                    'Nintendo Switch Pro gamepad for the Nintendo Switch console.',
            },
        },
        {
            it: 'matches a gamepad name string',
            input: {
                gamepad: 'Pro Controller Extended Gamepad',
            },
            expect: {
                gamepadModel: PredefinedGamepadModel.SwitchPro,
                gamepadBrand: PredefinedGamepadBrand.Nintendo,
                gamepadModelDescription:
                    'Nintendo Switch Pro gamepad for the Nintendo Switch console.',
            },
        },
        {
            it: 'matches a Steam Deck Firefox device name',
            input: {
                gamepad: '28de-11ff-Microsoft X-Box 360 pad 0',
            },
            expect: {
                gamepadModel: PredefinedGamepadModel.SteamDeck,
                gamepadBrand: PredefinedGamepadBrand.Valve,
                gamepadModelDescription: 'Gamepad for the Valve Steam Deck handheld console.',
            },
        },
        {
            it: 'matches a Steam Deck Chrome device name',
            input: {
                gamepad: 'Microsoft X-Box 360 pad 0 (STANDARD GAMEPAD Vendor: 28de Product: 11ff)',
            },
            expect: {
                gamepadModel: PredefinedGamepadModel.SteamDeck,
                gamepadBrand: PredefinedGamepadBrand.Valve,
                gamepadModelDescription: 'Gamepad for the Valve Steam Deck handheld console.',
            },
        },
        {
            it: 'matches an Xbox 360 Chrome device name',
            input: {
                gamepad: 'Xbox 360 Wireless Receiver (STANDARD GAMEPAD Vendor: 045e Product: 02a1)',
            },
            expect: {
                gamepadModel: PredefinedGamepadModel.Xbox360,
                gamepadBrand: PredefinedGamepadBrand.Microsoft,
                gamepadModelDescription:
                    'Microsoft Xbox 360 gamepad for the Microsoft Xbox 360 console. Can be wired or wireless.',
            },
        },
        {
            it: 'matches an Xbox 360 Firefox device name',
            input: {
                gamepad: '045e-02a1-Xbox 360 Wireless Receiver',
            },
            expect: {
                gamepadModel: PredefinedGamepadModel.Xbox360,
                gamepadBrand: PredefinedGamepadBrand.Microsoft,
                gamepadModelDescription:
                    'Microsoft Xbox 360 gamepad for the Microsoft Xbox 360 console. Can be wired or wireless.',
            },
        },
        {
            it: 'handles an absent gamepad',
            input: {
                gamepad: undefined,
            },
            expect: {
                gamepadModel: undefined,
                gamepadBrand: undefined,
                gamepadModelDescription: undefined,
            },
        },
    ]);

    it('returns the expected result for a custom model map', () => {
        assert.deepEquals(
            findMatchingGamepadModel({
                gamepad: 'custom gamepad',
                gamepadModelMap: {
                    'custom gamepad': 'custom-model',
                },
                gamepadBrandMap: {
                    'custom-model': 'custom-brand',
                },
            }),
            {
                gamepadModel: 'custom-model',
                gamepadBrand: 'custom-brand',
                gamepadModelDescription: undefined,
            },
        );
    });
});
