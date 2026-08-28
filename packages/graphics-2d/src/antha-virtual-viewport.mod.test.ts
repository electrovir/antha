import {assert, assertWrap} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {
    calculateVirtualViewport,
    calculateVirtualViewportPoint,
} from './antha-virtual-viewport.mod.js';

describe(calculateVirtualViewport.name, () => {
    it('uses the same logical dimensions at 1440p and 720p', () => {
        assert.deepEquals(
            [
                calculateVirtualViewport({
                    screenSize: {
                        height: 1440,
                        width: 2560,
                    },
                    virtualWidth: 2560,
                }),
                calculateVirtualViewport({
                    screenSize: {
                        height: 720,
                        width: 1280,
                    },
                    virtualWidth: 2560,
                }),
            ],
            [
                {
                    height: 1440,
                    scale: 1,
                    width: 2560,
                },
                {
                    height: 1440,
                    scale: 0.5,
                    width: 2560,
                },
            ],
        );
    });

    it('maps pointers into logical coordinates and waits for a canvas with width', () => {
        const virtualViewport = calculateVirtualViewport({
            screenSize: {
                height: 720,
                width: 1280,
            },
            virtualWidth: 2560,
        });

        assert.deepEquals(
            [
                calculateVirtualViewportPoint({
                    canvasBounds: {
                        height: 720,
                        left: 100,
                        top: 50,
                        width: 1280,
                    },
                    clientPoint: {
                        x: 740,
                        y: 410,
                    },
                    virtualViewport: assertWrap.isDefined(virtualViewport),
                }),
                calculateVirtualViewport({
                    screenSize: {
                        height: 0,
                        width: 0,
                    },
                    virtualWidth: 2560,
                }),
            ],
            [
                {
                    x: 1280,
                    y: 720,
                },
                undefined,
            ],
        );
    });
});
