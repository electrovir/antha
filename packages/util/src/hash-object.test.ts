import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {hashObject} from './hash-object.js';

const exampleState = {
    frame: 42,
    players: [
        {
            id: 'player-one',
            position: {
                x: 1.5,
                y: -3,
            },
            isAlive: true,
        },
        {
            id: 'player-two',
            position: {
                x: 0,
                y: 10,
            },
            isAlive: false,
        },
    ],
    winner: null,
};

describe(hashObject.name, () => {
    it('ignores object key order', () => {
        assert.strictEquals(
            hashObject(exampleState),
            hashObject({
                winner: null,
                players: exampleState.players,
                frame: 42,
            }),
        );
    });

    it('detects a small nested change', () => {
        assert.notStrictEquals(
            hashObject(exampleState),
            hashObject({
                ...exampleState,
                players: [
                    exampleState.players[0],
                    {
                        ...exampleState.players[1],
                        position: {
                            x: 0,
                            y: 10.000001,
                        },
                    },
                ],
            }),
        );
    });

    it('ignores Map and Set insertion order', () => {
        assert.deepEquals(
            [
                hashObject(
                    new Map<unknown, unknown>([
                        [
                            'a',
                            1,
                        ],
                        [
                            {
                                id: 2,
                            },
                            [3],
                        ],
                    ]),
                ),
                hashObject(
                    new Set([
                        'a',
                        2,
                    ]),
                ),
            ],
            [
                hashObject(
                    new Map<unknown, unknown>([
                        [
                            {
                                id: 2,
                            },
                            [3],
                        ],
                        [
                            'a',
                            1,
                        ],
                    ]),
                ),
                hashObject(
                    new Set([
                        2,
                        'a',
                    ]),
                ),
            ],
        );
    });

    it('detects Map and Set content changes', () => {
        const hashes = [
            hashObject(
                new Map([
                    [
                        'a',
                        1,
                    ],
                ]),
            ),
            hashObject(
                new Map([
                    [
                        'a',
                        2,
                    ],
                ]),
            ),
            hashObject(
                new Map([
                    [
                        'b',
                        1,
                    ],
                ]),
            ),
            hashObject(new Set(['a'])),
            hashObject(new Set(['b'])),
            hashObject(new Map()),
            hashObject(new Set()),
        ];

        assert.strictEquals(new Set(hashes).size, hashes.length);
    });

    it('hashes equivalent special values the same', () => {
        assert.deepEquals(
            [
                hashObject(-0),
                hashObject(Number.NaN),
                hashObject(() => {}),
            ],
            [
                hashObject(0),
                hashObject(Math.sqrt(-1)),
                hashObject(Symbol('other')),
            ],
        );
    });

    it('distinguishes values with the same string form', () => {
        const hashes = [
            hashObject('1'),
            hashObject(1),
            hashObject(1n),
            hashObject(Number.NaN),
            hashObject(() => {}),
            hashObject([1]),
            hashObject(null),
            hashObject(undefined),
            hashObject({}),
            hashObject([]),
            hashObject([
                'a',
                'b',
            ]),
            hashObject(['ab']),
        ];

        assert.strictEquals(new Set(hashes).size, hashes.length);
    });
});
