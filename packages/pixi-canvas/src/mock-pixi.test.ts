import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {Container} from 'pixi.js';
import {createMockPixi} from './mock-pixi.js';

describe(createMockPixi.name, () => {
    it('creates a mock', () => {
        const mock = createMockPixi();
        const mockChild = new Container();

        assert.isLengthExactly(mock.stage.children, 0 as number);
        mock.stage.addChild(mockChild);
        assert.isLengthExactly(mock.stage.children, 1 as number);
        assert.strictEquals(mock.stage.children[0], mockChild);
    });
    it('inits a size', () => {
        const mock = createMockPixi({
            options: {
                width: 100,
                height: 50,
            },
        });
        assert.strictEquals(mock.screen.width, 100);
        assert.strictEquals(mock.screen.height, 50);
    });
    it('supports additional mocking', () => {
        assert.isUndefined(createMockPixi().canvas);
        assert.isDefined(
            createMockPixi({
                mocks: {
                    canvas: {} as any,
                },
            }).canvas,
        );
    });
    it('destroys ticker and stage', () => {
        const mock = createMockPixi();

        assert.isFalse(mock.stage.destroyed);

        mock.destroy();

        assert.isTrue(mock.stage.destroyed);
    });
});
