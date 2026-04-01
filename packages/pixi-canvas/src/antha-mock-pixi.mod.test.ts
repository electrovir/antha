import {AnthaEngine} from '@antha/engine';
import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {AnthaMockPixiMod} from './antha-mock-pixi.mod.js';
import {type AnthaPixiCanvasModState} from './antha-pixi-canvas.mod.js';
import {createMockPixi, MockPixiApp} from './mock-pixi.js';

describe('AnthaMockPixiMod', () => {
    it('sets up state.pixi with a MockPixiApp', async () => {
        const engine = new AnthaEngine({
            mods: [
                AnthaMockPixiMod,
            ],
        });

        await engine.runSingleTick();

        const state = engine.state as Partial<AnthaPixiCanvasModState>;

        assert.isDefined(state.pixi);
        assert.instanceOf(state.pixi.pixiApplication, MockPixiApp);
    });

    it('does not overwrite existing state.pixi', async () => {
        const existingMock = createMockPixi();

        const engine = new AnthaEngine({
            mods: [
                AnthaMockPixiMod,
            ],
        });

        (engine.state as AnthaPixiCanvasModState).pixi = {
            pixiApplication: existingMock,
        };

        await engine.runSingleTick();

        const state = engine.state as AnthaPixiCanvasModState;

        assert.strictEquals(state.pixi.pixiApplication, existingMock);
    });

    it('cleanup destroys pixi application and removes canvas', async () => {
        const engine = new AnthaEngine({
            mods: [
                AnthaMockPixiMod,
            ],
        });

        await engine.runSingleTick();

        const state = engine.state as AnthaPixiCanvasModState;
        const mockApp = state.pixi.pixiApplication as unknown as MockPixiApp;
        const canvas = document.createElement('canvas');

        document.body.append(canvas);
        state.pixi.canvas = canvas;

        assert.isTrue(document.body.contains(canvas));

        await engine.reset();

        assert.isTrue(mockApp.stage.destroyed);
        assert.isFalse(document.body.contains(canvas));
    });
});
