import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {listenToObject} from './listen-to-object.js';

describe(listenToObject.name, () => {
    it('emits assigned property values', () => {
        const original = {
            count: 0,
            label: 'start',
        };
        const receivedValues: number[] = [];

        const removeListener = listenToObject(original, 'count', (value) => {
            receivedValues.push(value);
        });

        original.count = 1;
        original.count = 2;
        removeListener();

        assert.deepEquals(
            {
                count: original.count,
                label: original.label,
                receivedValues,
            },
            {
                count: 2,
                label: 'start',
                receivedValues: [
                    1,
                    2,
                ],
            },
        );
    });

    it('removes individual listeners', () => {
        const original = {
            count: 0,
        };
        const firstValues: number[] = [];
        const secondValues: number[] = [];

        const removeFirstListener = listenToObject(original, 'count', (value) => {
            firstValues.push(value);
        });
        const removeSecondListener = listenToObject(original, 'count', (value) => {
            secondValues.push(value);
        });

        original.count = 1;
        removeFirstListener();
        original.count = 2;
        removeSecondListener();

        assert.deepEquals(
            {
                firstValues,
                secondValues,
            },
            {
                firstValues: [
                    1,
                ],
                secondValues: [
                    1,
                    2,
                ],
            },
        );
    });

    it('tracks separate properties independently', () => {
        const original = {
            count: 0,
            label: 'start',
        };
        const countValues: number[] = [];
        const labelValues: string[] = [];

        const removeCountListener = listenToObject(original, 'count', (value) => {
            countValues.push(value);
        });
        const removeLabelListener = listenToObject(original, 'label', (value) => {
            labelValues.push(value);
        });

        original.count = 1;
        original.label = 'done';
        original.count = 2;
        removeCountListener();
        removeLabelListener();

        assert.deepEquals(
            {
                countValues,
                labelValues,
            },
            {
                countValues: [
                    1,
                    2,
                ],
                labelValues: [
                    'done',
                ],
            },
        );
    });

    it('supports listeners after all listeners are removed', () => {
        const original = {
            count: 0,
        };
        const firstValues: number[] = [];
        const secondValues: number[] = [];

        const removeFirstListener = listenToObject(original, 'count', (value) => {
            firstValues.push(value);
        });

        original.count = 1;
        removeFirstListener();
        original.count = 2;

        const removeSecondListener = listenToObject(original, 'count', (value) => {
            secondValues.push(value);
        });

        original.count = 3;
        removeSecondListener();

        assert.deepEquals(
            {
                count: original.count,
                firstValues,
                secondValues,
            },
            {
                count: 3,
                firstValues: [
                    1,
                ],
                secondValues: [
                    3,
                ],
            },
        );
    });
});
