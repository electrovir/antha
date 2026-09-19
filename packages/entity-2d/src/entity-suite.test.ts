import {describe, itCases} from '@augment-vir/test';
import {reverseParamsMap} from './entity-suite.js';

describe(reverseParamsMap.name, () => {
    itCases(reverseParamsMap, [
        {
            it: 'converts a full params map',
            input: {
                hitbox: {
                    angle: true,
                    width: 'w',
                },
                view: {
                    alpha: true,
                    width: 'w',
                },
            },
            expect: {
                angle: {
                    hitbox: ['angle'],
                },
                w: {
                    hitbox: ['width'],
                    view: ['width'],
                },
                alpha: {
                    view: ['alpha'],
                },
            },
        },
        {
            it: 'converts a partial params map',
            input: {
                hitbox: {
                    angle: true,
                    width: 'w',
                },
            },
            expect: {
                angle: {
                    hitbox: ['angle'],
                },
                w: {
                    hitbox: ['width'],
                },
            },
        },
        {
            it: 'skips falsy mapping values',
            input: {
                hitbox: {
                    // @ts-expect-error: can't assign false to a params map
                    angle: false,
                    width: 'w',
                },
            },
            expect: {
                w: {
                    hitbox: ['width'],
                },
            },
        },
    ]);
});
