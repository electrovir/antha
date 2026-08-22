import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {normalizeVector2d, StableMath} from './stable-math.js';

describe('stable math', () => {
    it('normalizes trig output', () => {
        assert.deepEquals(
            {
                cosPiHalf: StableMath.cos(Math.PI / 2),
                sinPi: StableMath.sin(Math.PI),
                tanPiQuarter: StableMath.tan(Math.PI / 4),
            },
            {
                cosPiHalf: 0,
                sinPi: 0,
                tanPiQuarter: 1,
            },
        );
    });

    it('matches game-vir rounded vector math', () => {
        const radians = StableMath.degreesToRadians(70, {
            digits: 4,
        });
        const magnitude = 7;

        assert.deepEquals(
            {
                x:
                    StableMath.cos(radians, {
                        digits: 4,
                    }) * magnitude,
                y:
                    StableMath.sin(radians, {
                        digits: 4,
                    }) * magnitude,
            },
            {
                x: 2.394,
                y: 6.5779,
            },
        );
    });

    it('converts angles and vector components', () => {
        assert.deepEquals(
            {
                degrees: StableMath.radiansToDegrees(Math.PI, {
                    digits: 4,
                }),
                hypot: StableMath.hypot(
                    [
                        3,
                        4,
                    ],
                    {
                        digits: 4,
                    },
                ),
                radians: StableMath.atan2({
                    y: 1,
                    x: 1,
                    options: {
                        digits: 4,
                    },
                }),
            },
            {
                degrees: 180,
                hypot: 5,
                radians: 0.7854,
            },
        );
    });

    it('wraps inverse and root math functions', () => {
        assert.deepEquals(
            {
                acos: StableMath.acos(0, {
                    digits: 4,
                }),
                asin: StableMath.asin(1, {
                    digits: 4,
                }),
                atan: StableMath.atan(1, {
                    digits: 4,
                }),
                infinity: StableMath.round(Infinity),
                sqrt: StableMath.sqrt(2, {
                    digits: 4,
                }),
            },
            {
                acos: 1.5708,
                asin: 1.5708,
                atan: 0.7854,
                infinity: Infinity,
                sqrt: 1.4142,
            },
        );
    });

    it('normalizes two-dimensional vectors', () => {
        assert.deepEquals(
            [
                normalizeVector2d({
                    x: 3,
                    y: 4,
                    options: {
                        digits: 4,
                    },
                }),
                normalizeVector2d({
                    x: 0,
                    y: 0,
                }),
            ],
            [
                {
                    x: 0.6,
                    y: 0.8,
                },
                {
                    x: 0,
                    y: 0,
                },
            ],
        );
    });
});
