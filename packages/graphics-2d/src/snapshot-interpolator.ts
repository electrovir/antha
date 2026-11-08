import {assertWrap} from '@augment-vir/assert';
import {mapObjectValues} from '@augment-vir/common';
import {type AnyDuration, convertDuration} from 'date-vir';

/**
 * One value received at a point in time, for {@link SnapshotInterpolator}.
 *
 * @category Internal
 */
export type TimedSnapshot<Key extends string> = {
    /** When the value was received, on the same clock that is later passed to `sample`. */
    time: number;
    /** The numbers to interpolate between snapshots. */
    value: Readonly<Record<Key, number>>;
};

/**
 * Smooths numbers that arrive in bursts, such as another player's position over the network, by
 * showing them slightly in the past and sliding between the two snapshots around that moment.
 *
 * Without this, a value that updates less often than the screen redraws visibly jumps. A longer
 * delay hides more network jitter but makes the shown value lag further behind.
 *
 * @category Util
 * @example
 *
 * ```ts
 * import {SnapshotInterpolator} from '@antha/graphics-2d';
 *
 * const interpolator = new SnapshotInterpolator<'x' | 'y'>({delay: {milliseconds: 100}});
 * interpolator.add({time: 1000, value: {x: 0, y: 0}});
 * interpolator.add({time: 1100, value: {x: 10, y: 20}});
 * interpolator.sample(1150); // {x: 5, y: 10}
 * ```
 */
export class SnapshotInterpolator<Key extends string> {
    /** Snapshots ordered by time, oldest first. */
    protected snapshots: TimedSnapshot<Key>[] = [];
    /** How far in the past `sample` looks, in milliseconds. */
    protected readonly delayMs: number;

    constructor({
        delay,
    }: Readonly<{
        /** How far in the past to show the value. Usually two or three send intervals. */
        delay: Readonly<AnyDuration>;
    }>) {
        this.delayMs = convertDuration(delay, {
            milliseconds: true,
        }).milliseconds;
    }

    /** Add a snapshot. A snapshot that is not newer than the newest one already added is ignored. */
    public add(snapshot: Readonly<TimedSnapshot<Key>>) {
        const newest = this.snapshots.at(-1);

        if (newest && snapshot.time <= newest.time) {
            return;
        }

        this.snapshots = [
            ...this.snapshots,
            snapshot,
        ];
    }

    /**
     * Get the interpolated value at `now` minus the delay. Before enough history exists this
     * returns the oldest snapshot, and once the delayed time passes the newest snapshot this holds
     * the newest one instead of guessing ahead. Returns `undefined` before any snapshot is added.
     */
    public sample(now: number) {
        const renderTime = now - this.delayMs;
        const laterIndex = this.snapshots.findIndex((snapshot) => snapshot.time > renderTime);

        if (laterIndex === -1) {
            const newest = this.snapshots.at(-1);
            this.snapshots = newest
                ? [
                      newest,
                  ]
                : [];

            return newest?.value;
        }

        const later = assertWrap.isDefined(this.snapshots[laterIndex]);
        const earlier = this.snapshots[laterIndex - 1];

        if (!earlier) {
            return later.value;
        }

        this.snapshots = this.snapshots.slice(laterIndex - 1);
        const progress = (renderTime - earlier.time) / (later.time - earlier.time);

        return mapObjectValues(earlier.value, (key, start) => {
            return start + (later.value[key] - start) * progress;
        });
    }
}
