import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {calculateVirtualViewport} from './virtual-viewport.js';

describe(calculateVirtualViewport.name, () => {
    it('fits a fixed logical viewport inside the physical screen', () => {
        assert.deepEquals(
            calculateVirtualViewport({
                screenSize: {
                    height: 1080,
                    width: 3840,
                },
                virtualHeight: 1080,
                virtualWidth: 1920,
            }),
            {
                height: 1080,
                scale: 1,
                width: 1920,
            },
        );
    });

    it('waits for usable screen dimensions', () => {
        assert.isUndefined(
            calculateVirtualViewport({
                screenSize: {
                    height: 0,
                    width: 3840,
                },
                virtualHeight: 1080,
                virtualWidth: 1920,
            }),
        );
    });
});
