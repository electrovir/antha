import {assert, assertWrap} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {getDirectionalInputVector} from './directional-input.js';

enum TestBinding {
    Down = 'down',
    Left = 'left',
    Right = 'right',
    Up = 'up',
}

const bindingNames = {
    down: TestBinding.Down,
    left: TestBinding.Left,
    right: TestBinding.Right,
    up: TestBinding.Up,
};

describe(getDirectionalInputVector.name, () => {
    it('normalizes diagonal input', () => {
        const input = assertWrap.isDefined(
            getDirectionalInputVector({
                activeBindings: {
                    [TestBinding.Down]: {
                        actCount: 0,
                        holdDuration: {
                            milliseconds: 0,
                        },
                        lastActDuration: {
                            milliseconds: 0,
                        },
                        rawInputs: [],
                        value: 1,
                    },
                    [TestBinding.Right]: {
                        actCount: 0,
                        holdDuration: {
                            milliseconds: 0,
                        },
                        lastActDuration: {
                            milliseconds: 0,
                        },
                        rawInputs: [],
                        value: 1,
                    },
                },
                bindingNames,
            }),
        );

        assert.isApproximately(input.x, Math.SQRT1_2, 0.00001);
        assert.isApproximately(input.y, Math.SQRT1_2, 0.00001);
    });

    it('uses the newest input when opposing directions are held', () => {
        assert.deepEquals(
            getDirectionalInputVector({
                activeBindings: {
                    [TestBinding.Left]: {
                        actCount: 0,
                        holdDuration: {
                            milliseconds: 20,
                        },
                        lastActDuration: {
                            milliseconds: 0,
                        },
                        rawInputs: [],
                        value: 1,
                    },
                    [TestBinding.Right]: {
                        actCount: 0,
                        holdDuration: {
                            milliseconds: 10,
                        },
                        lastActDuration: {
                            milliseconds: 0,
                        },
                        rawInputs: [],
                        value: 1,
                    },
                },
                bindingNames,
            }),
            {
                x: 1,
                y: 0,
            },
        );
    });

    it('uses the newest negative input when opposing directions are held', () => {
        assert.deepEquals(
            getDirectionalInputVector({
                activeBindings: {
                    [TestBinding.Left]: {
                        actCount: 0,
                        holdDuration: {
                            milliseconds: 10,
                        },
                        lastActDuration: {
                            milliseconds: 0,
                        },
                        rawInputs: [],
                        value: 1,
                    },
                    [TestBinding.Right]: {
                        actCount: 0,
                        holdDuration: {
                            milliseconds: 20,
                        },
                        lastActDuration: {
                            milliseconds: 0,
                        },
                        rawInputs: [],
                        value: 1,
                    },
                },
                bindingNames,
            }),
            {
                x: -1,
                y: 0,
            },
        );
    });

    it('returns undefined when no directional bindings are active', () => {
        assert.isUndefined(
            getDirectionalInputVector({
                activeBindings: undefined,
                bindingNames,
            }),
        );
    });
});
