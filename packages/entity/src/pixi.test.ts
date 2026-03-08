import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {Container, Graphics} from 'pixi.js';
import {defineEntitySuite} from './entity-suite.js';
import {createMockPixi} from './pixi.mock.js';

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
    it('allows a view child to be destroyed', () => {
        const {EntityStore, defineEntity} = defineEntitySuite();
        let updateCount = 0;

        class MyEntity extends defineEntity({
            key: 'MyEntity',
            paramsShape: undefined,
        }) {
            public override update(): void {
                updateCount++;
            }
            public override createView() {
                return {
                    view: new Graphics().rect(0, 0, 10, 10).fill('red'),
                };
            }
        }
        const entityStore = new EntityStore({
            pixi: createMockPixi(),
            state: {},
        });

        MyEntity.paramsMap;

        const instance = entityStore.addEntity(MyEntity);

        entityStore.updateAllEntities();
        entityStore.updateAllEntities();
        assert.strictEquals(updateCount, 2);

        instance.destroy();
    });
});
