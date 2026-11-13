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

    it('fades out corrections from late snapshots', () => {
        const interpolator = new SnapshotInterpolator<'x'>({
            delay: {
                milliseconds: 100,
            },
            correctionFade: {
                milliseconds: 100,
            },
        });
        interpolator.add({
            time: 1000,
            value: {
                x: 0,
            },
        });
        interpolator.add({
            time: 1100,
            value: {
                x: 10,
            },
        });
        const heldValue = interpolator.sample(1300);

        /** A correction that adds nothing still keeps the one already fading. */
        function addAndSample() {
            interpolator.add({
                time: 1400,
                value: {
                    x: 40,
                },
            });
            return interpolator.sample(1400);
        }
        interpolator.add({
            time: 1300,
            value: {
                x: 30,
            },
        });

        assert.deepEquals(
            [
                heldValue,
                interpolator.sample(1300),
                interpolator.sample(1400),
                addAndSample(),
            ],
            [
                {
                    x: 10,
                },
                {
                    x: 10,
                },
                {
                    x: 30 - 10 * Math.exp(-1),
                },
                {
                    x: 30 - 10 * Math.exp(-1),
                },
            ],
        );
    });

    it('jumps instead of sliding or fading across a teleport', () => {
        const interpolator = new SnapshotInterpolator<'x'>({
            delay: {
                milliseconds: 100,
            },
            correctionFade: {
                milliseconds: 100,
            },
        });
        interpolator.add({
            time: 1000,
            value: {
                x: 0,
            },
            teleportCount: 0,
        });
        interpolator.add({
            time: 1100,
            value: {
                x: 100,
            },
            teleportCount: 1,
        });
        const beforeTeleport = interpolator.sample(1150);
        const afterTeleport = interpolator.sample(1200);
        interpolator.sample(1400);
        interpolator.add({
            time: 1250,
            value: {
                x: 200,
            },
            teleportCount: 2,
        });

        assert.deepEquals(
            [
                beforeTeleport,
                afterTeleport,
                interpolator.sample(1400),
            ],
            [
                {
                    x: 0,
                },
                {
                    x: 100,
                },
                {
                    x: 200,
                },
            ],
        );
    });

    it('follows a curve between snapshots that both have a velocity', () => {
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
            velocity: {
                x: 10,
                y: 10,
            },
        });
        interpolator.add({
            time: 1100,
            value: {
                x: 0,
                y: 0,
            },
            velocity: {
                x: 0,
            },
        });

        assert.deepEquals(interpolator.sample(1150), {
            x: 0.125,
            y: 0,
        });
    });

    it('extrapolates along the velocity for a limited time past the newest snapshot', () => {
        const interpolator = new SnapshotInterpolator<'x' | 'y'>({
            delay: {
                milliseconds: 0,
            },
            extrapolate: {
                milliseconds: 100,
            },
        });
        interpolator.add({
            time: 1000,
            value: {
                x: 0,
                y: 0,
            },
            velocity: {
                x: 10,
            },
        });

        assert.deepEquals(
            [
                interpolator.sample(1050),
                interpolator.sample(1500),
            ],
            [
                {
                    x: 0.5,
                    y: 0,
                },
                {
                    x: 1,
                    y: 0,
                },
            ],
        );
    });
});
