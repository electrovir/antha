import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {flattenBindingValues, readBindingValues} from './binding-values.js';

const template = {
    first: 0,
    nested: {
        flag: false,
        second: 0,
    },
    last: 0,
};

describe(flattenBindingValues.name, () => {
    it('flattens values in template order with NaN for missing values', () => {
        assert.deepEquals(
            [
                flattenBindingValues(template, {
                    last: 3,
                    nested: {
                        flag: true,
                    },
                    unknown: 9,
                }),
                flattenBindingValues(template, {
                    first: 1,
                    nested: 5,
                }),
                flattenBindingValues(template, undefined),
            ],
            [
                [
                    Number.NaN,
                    1,
                    Number.NaN,
                    3,
                ],
                [
                    1,
                    Number.NaN,
                    Number.NaN,
                    Number.NaN,
                ],
                [
                    Number.NaN,
                    Number.NaN,
                    Number.NaN,
                    Number.NaN,
                ],
            ],
        );
    });
});

describe(readBindingValues.name, () => {
    it('fills the template in key order', () => {
        assert.deepEquals(
            readBindingValues(
                template,
                [
                    1,
                    0,
                    2,
                    3,
                    4,
                ],
            ),
            {
                first: 1,
                nested: {
                    flag: false,
                    second: 2,
                },
                last: 3,
            },
        );
    });

    it('throws when the numbers run out', () => {
        assert.throws(() => {
            readBindingValues(template, [
                1,
            ]);
        });
    });
});
