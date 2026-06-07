/**
 * Number of decimal places used by default to normalize floating-point math results.
 *
 * @category Internal
 */
export const defaultStableMathDigits = 12;

/**
 * Options for stable math helpers.
 *
 * @category Antha Util
 */
export type StableMathOptions = {
    /**
     * Number of digits to round all values to.
     *
     * @default 12
     */
    digits?: number | undefined;
};

/**
 * Stable, rounded math variants of `Math` object.
 *
 * @category Antha Util
 */
export const StableMath = {
    /**
     * Stable wrapper for `Math.acos`.
     *
     * @category Math
     */
    acos(value: number, options?: Readonly<StableMathOptions> | undefined) {
        return StableMath.round(Math.acos(value), options);
    },
    /**
     * Stable wrapper for `Math.asin`.
     *
     * @category Math
     */
    asin(value: number, options?: Readonly<StableMathOptions> | undefined) {
        return StableMath.round(Math.asin(value), options);
    },
    /**
     * Stable wrapper for `Math.atan`.
     *
     * @category Math
     */
    atan(value: number, options?: Readonly<StableMathOptions> | undefined) {
        return StableMath.round(Math.atan(value), options);
    },
    /**
     * Stable wrapper for `Math.atan2`.
     *
     * @category Math
     */
    atan2({
        y,
        x,
        options,
    }: Readonly<{
        y: number;
        x: number;
        options?: Readonly<StableMathOptions> | undefined;
    }>) {
        return StableMath.round(Math.atan2(y, x), options);
    },
    /**
     * Stable wrapper for `Math.cos`.
     *
     * @category Math
     */
    cos(radians: number, options?: Readonly<StableMathOptions> | undefined) {
        return StableMath.round(Math.cos(radians), options);
    },
    /**
     * Convert degrees to radians with stable rounding.
     *
     * @category Math
     */
    degreesToRadians(degrees: number, options?: Readonly<StableMathOptions> | undefined) {
        return StableMath.round((Math.PI * degrees) / 180, options);
    },
    /**
     * Stable wrapper for `Math.hypot`.
     *
     * @category Math
     */
    hypot(values: ReadonlyArray<number>, options?: Readonly<StableMathOptions> | undefined) {
        return StableMath.round(Math.hypot(...values), options);
    },
    /**
     * Convert radians to degrees with stable rounding.
     *
     * @category Math
     */
    radiansToDegrees(radians: number, options?: Readonly<StableMathOptions> | undefined) {
        return StableMath.round((radians * 180) / Math.PI, options);
    },
    /**
     * Round a number to a stable number of digits.
     *
     * @category Math
     */
    round(value: number, {digits = defaultStableMathDigits}: Readonly<StableMathOptions> = {}) {
        if (!Number.isFinite(value)) {
            return value;
        }

        const multiplier = 10 ** digits;
        return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
    },
    /**
     * Stable wrapper for `Math.sin`.
     *
     * @category Math
     */
    sin(radians: number, options?: Readonly<StableMathOptions> | undefined) {
        return StableMath.round(Math.sin(radians), options);
    },
    /**
     * Stable wrapper for `Math.sqrt`.
     *
     * @category Math
     */
    sqrt(value: number, options?: Readonly<StableMathOptions> | undefined) {
        return StableMath.round(Math.sqrt(value), options);
    },
    /**
     * Stable wrapper for `Math.tan`.
     *
     * @category Math
     */
    tan(radians: number, options?: Readonly<StableMathOptions> | undefined) {
        return StableMath.round(Math.tan(radians), options);
    },
};
