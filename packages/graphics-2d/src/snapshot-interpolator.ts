import {assertWrap} from '@augment-vir/assert';
import {mapObjectValues, type PartialWithUndefined} from '@augment-vir/common';
import {type AnyDuration, convertDuration} from 'date-vir';

/**
 * One value received at a point in time, for {@link SnapshotInterpolator}.
 *
 * @category Internal
 */
export type TimedSnapshot<Key extends string> = {
    /**
     * When the value was received, in milliseconds on the same clock that is later passed to
     * `sample`.
     */
    time: number;
    /** The numbers to interpolate between snapshots. */
    value: Readonly<Record<Key, number>>;
} & PartialWithUndefined<{
    /**
     * How fast each number is changing at `time`, per second. A number with a velocity in both
     * snapshots around the sampled time follows a curve between them instead of a straight line, so
     * turns look smooth.
     */
    velocity: Readonly<Partial<Record<Key, number>>>;
    /**
     * Increase this whenever the value jumps on purpose, such as a respawn. The shown value then
     * jumps too instead of sliding across. Because it's a count, the jump is still caught when the
     * snapshot that made it was lost.
     */
    teleportCount: number;
}>;

/** A cubic Hermite curve: it passes through both ends with the given velocities. */
function interpolateCurve({
    start,
    end,
    startVelocity,
    endVelocity,
    progress,
    seconds,
}: Readonly<{
    start: number;
    end: number;
    startVelocity: number;
    endVelocity: number;
    progress: number;
    seconds: number;
}>) {
    const squared = progress * progress;
    const cubed = squared * progress;

    return (
        (2 * cubed - 3 * squared + 1) * start +
        (cubed - 2 * squared + progress) * seconds * startVelocity +
        (-2 * cubed + 3 * squared) * end +
        (cubed - squared) * seconds * endVelocity
    );
}

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
    protected readonly correctionFadeMs: number | undefined;
    protected readonly extrapolateMs: number | undefined;
    /** What is still being added to the shown value so that a late snapshot doesn't make it jump. */
    protected correction: Record<Key, number> | undefined;
    protected lastRenderTime: number | undefined;
    protected lastTeleportCount: number | undefined;

    constructor({
        delay,
        correctionFade,
        extrapolate,
    }: Readonly<
        {
            /** How far in the past to show the value. Usually two or three send intervals. */
            delay: Readonly<AnyDuration>;
        } & PartialWithUndefined<{
            /**
             * When a late snapshot changes what should already be on screen, the shown value moves
             * there gradually instead of jumping. Each such correction shrinks to about a third
             * over this duration.
             *
             * @default corrections jump
             */
            correctionFade: Readonly<AnyDuration>;
            /**
             * Once the delayed time passes the newest snapshot, keep moving each number along its
             * velocity for up to this long, instead of holding it. Use this for things that collide
             * with local objects: with a zero `delay`, sampling at now plus half the round trip
             * shows them about where their owner sees them, so a bump happens at the same spot on
             * both screens. Combine it with `correctionFade`, since every new snapshot corrects the
             * guess.
             *
             * @default the newest snapshot is held
             */
            extrapolate: Readonly<AnyDuration>;
        }>
    >) {
        this.delayMs = convertDuration(delay, {
            milliseconds: true,
        }).milliseconds;
        this.correctionFadeMs = correctionFade
            ? convertDuration(correctionFade, {
                  milliseconds: true,
              }).milliseconds
            : undefined;
        this.extrapolateMs = extrapolate
            ? convertDuration(extrapolate, {
                  milliseconds: true,
              }).milliseconds
            : undefined;
    }

    /** Add a snapshot. A snapshot that is not newer than the newest one already added is ignored. */
    public add(snapshot: Readonly<TimedSnapshot<Key>>) {
        const newest = this.snapshots.at(-1);

        if (newest && snapshot.time <= newest.time) {
            return;
        }

        const before =
            this.lastRenderTime == undefined ? undefined : this.interpolate(this.lastRenderTime);

        this.snapshots = [
            ...this.snapshots,
            snapshot,
        ];

        if (!before || this.lastRenderTime == undefined || this.correctionFadeMs == undefined) {
            return;
        }

        const after = assertWrap.isDefined(this.interpolate(this.lastRenderTime));

        this.correction =
            before.teleportCount === after.teleportCount
                ? mapObjectValues(after.value, (key, afterValue) => {
                      return (this.correction?.[key] ?? 0) + before.value[key] - afterValue;
                  })
                : undefined;
    }

    /**
     * Get the value at `now` minus the delay. Before enough history exists this returns the oldest
     * snapshot, and once the delayed time passes the newest snapshot this holds the newest one,
     * unless `extrapolate` is set. Returns `undefined` before any snapshot is added.
     */
    public sample(now: number) {
        const renderTime = now - this.delayMs;
        const sampled = this.interpolate(renderTime);
        const elapsedMs = renderTime - (this.lastRenderTime ?? renderTime);

        this.trim(renderTime);
        this.lastRenderTime = renderTime;

        if (!sampled) {
            return undefined;
        }

        if (sampled.teleportCount !== this.lastTeleportCount) {
            this.lastTeleportCount = sampled.teleportCount;
            this.correction = undefined;
        }

        if (!this.correction || this.correctionFadeMs == undefined) {
            return sampled.value;
        }

        const remaining = Math.exp(-Math.max(elapsedMs, 0) / this.correctionFadeMs);
        const correction = mapObjectValues(this.correction, (key, value) => value * remaining);
        this.correction = correction;

        return mapObjectValues(sampled.value, (key, value) => value + correction[key]);
    }

    /** The value at `renderTime` from the stored snapshots, without any correction. */
    protected interpolate(renderTime: number) {
        const laterIndex = this.snapshots.findIndex((snapshot) => snapshot.time > renderTime);
        const later = this.snapshots[laterIndex];
        const earlier = laterIndex === -1 ? this.snapshots.at(-1) : this.snapshots[laterIndex - 1];

        if (!later && earlier && this.extrapolateMs != undefined) {
            const aheadSeconds = convertDuration(
                {
                    milliseconds: Math.min(renderTime - earlier.time, this.extrapolateMs),
                },
                {
                    seconds: true,
                },
            ).seconds;

            return {
                teleportCount: earlier.teleportCount,
                value: mapObjectValues(earlier.value, (key, value) => {
                    return value + (earlier.velocity?.[key] ?? 0) * aheadSeconds;
                }),
            };
        } else if (later && earlier && earlier.teleportCount === later.teleportCount) {
            const progress = (renderTime - earlier.time) / (later.time - earlier.time);
            const seconds = convertDuration(
                {
                    milliseconds: later.time - earlier.time,
                },
                {
                    seconds: true,
                },
            ).seconds;

            return {
                teleportCount: earlier.teleportCount,
                value: mapObjectValues(earlier.value, (key, start) => {
                    const end = later.value[key];
                    const startVelocity = earlier.velocity?.[key];
                    const endVelocity = later.velocity?.[key];

                    return startVelocity == undefined || endVelocity == undefined
                        ? start + (end - start) * progress
                        : interpolateCurve({
                              start,
                              end,
                              startVelocity,
                              endVelocity,
                              progress,
                              seconds,
                          });
                }),
            };
        } else {
            const held = earlier || later;

            return (
                held && {
                    value: held.value,
                    teleportCount: held.teleportCount,
                }
            );
        }
    }

    /** Drop snapshots that no render time from now on can need. */
    protected trim(renderTime: number) {
        const laterIndex = this.snapshots.findIndex((snapshot) => snapshot.time > renderTime);

        this.snapshots =
            laterIndex === -1
                ? this.snapshots.slice(-1)
                : this.snapshots.slice(Math.max(laterIndex - 1, 0));
    }
}
