import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {SnapshotInterpolator} from './snapshot-interpolator.js';

function createInterpolator() {
    const interpolator = new SnapshotInterpolator<'x' | 'y'>({
        delay: {
            milliseconds: 100,
        },
    });
    interpolator.add({
        time: 1000,
        value: {
            x: 0,
            y: 0,
        },
    });
    interpolator.add({
        time: 1100,
        value: {
            x: 10,
            y: 20,
        },
    });

    return interpolator;
}

describe(SnapshotInterpolator.name, () => {
    it('interpolates between the snapshots around the delayed time', () => {
        const interpolator = createInterpolator();

        assert.deepEquals(
            [
                interpolator.sample(1050),
                interpolator.sample(1150),
                interpolator.sample(1300),
            ],
            [
                {
                    x: 0,
                    y: 0,
                },
                {
                    x: 5,
                    y: 10,
                },
                {
                    x: 10,
                    y: 20,
                },
            ],
        );
    });

    it('ignores stale snapshots and keeps working after holding the newest one', () => {
        const interpolator = createInterpolator();

        assert.isUndefined(
            new SnapshotInterpolator<'x'>({
                delay: {
                    milliseconds: 100,
                },
            }).sample(0),
        );
        interpolator.sample(1300);
        interpolator.add({
            time: 1050,
            value: {
                x: 99,
                y: 99,
            },
        });
        interpolator.add({
            time: 1300,
            value: {
                x: 30,
                y: 40,
            },
        });

        assert.deepEquals(interpolator.sample(1300), {
            x: 20,
            y: 30,
        });
    });
});
