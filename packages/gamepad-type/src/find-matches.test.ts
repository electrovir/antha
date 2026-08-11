/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {describe, itCases} from '@augment-vir/test';
import {defaultGamepadLayouts} from './default-layouts.js';
import {findMatchingGamepadLayout} from './find-matches.js';
import {mockLayouts} from './gamepad-layout.mock.js';

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
    ]);
});
