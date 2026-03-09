import {assert, waitUntil} from '@augment-vir/assert';
import {describe, it, testWeb} from '@augment-vir/test';
import {AnthaEngine, AnthaUi, html} from 'antha';
import {createAnthaPixiCanvasMod, type AnthaPixiCanvasModState} from './antha-pixi-canvas.mod.js';
import {createMockPixi} from './mock-pixi.js';

describe(createAnthaPixiCanvasMod.name, () => {
    it('creates a mod with the correct name', () => {
        const mod = createAnthaPixiCanvasMod();

        assert.strictEquals(mod.modName, 'antha-pixi-canvas');
    });

    it('initializes pixi state and returns a template', async () => {
        const mod = createAnthaPixiCanvasMod();
        const engine = new AnthaEngine({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();

        const state = engine.state as Partial<AnthaPixiCanvasModState>;

        assert.isDefined(state.pixi);
        assert.isDefined(engine.currentTemplateMap.get(mod));
    });

    it('creates a PixiApplication when canvas is already in state', async () => {
        const mod = createAnthaPixiCanvasMod();
        const engine = new AnthaEngine({
            mods: [
                mod,
            ],
        });

        (engine.state as AnthaPixiCanvasModState).pixi = {
            canvas: document.createElement('canvas'),
        };

        await engine.runSingleTick();

        const state = engine.state as AnthaPixiCanvasModState;

        assert.isDefined(state.pixi.pixiApplication);

        await engine.reset();
    });

    it('destroys pixi application on cleanup', async () => {
        const mod = createAnthaPixiCanvasMod();
        const engine = new AnthaEngine({
            mods: [
                mod,
            ],
        });
        const mockApp = createMockPixi();

        (engine.state as AnthaPixiCanvasModState).pixi = {
            pixiApplication: mockApp,
        };

        await engine.reset();

        assert.isTrue(mockApp.stage.destroyed);
    });

    it('cleanup is safe when pixi state is empty', async () => {
        const mod = createAnthaPixiCanvasMod();
        const engine = new AnthaEngine({
            mods: [
                mod,
            ],
        });

        await engine.reset();
    });

    it('returns undefined when an external canvas is provided via pixiOptions', async () => {
        const externalCanvas = document.createElement('canvas');
        const mod = createAnthaPixiCanvasMod({
            pixiOptions: {
                canvas: externalCanvas,
            } as any,
        });
        const engine = new AnthaEngine({
            mods: [
                mod,
            ],
        });

        (engine.state as AnthaPixiCanvasModState).pixi = {
            pixiApplication: createMockPixi(),
        };

        await engine.runSingleTick();

        assert.isUndefined(engine.currentTemplateMap.get(mod));
    });

    it('handles missing background option', async () => {
        const mod = createAnthaPixiCanvasMod({
            pixiOptions: {
                background: '',
            },
        });
        const engine = new AnthaEngine({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();

        assert.isDefined(engine.currentTemplateMap.get(mod));
    });

    it('sets canvas via onDomCreated when rendered', async () => {
        const mod = createAnthaPixiCanvasMod();
        const engine = new AnthaEngine({
            mods: [
                mod,
            ],
        });

        await testWeb.render(html`
            <${AnthaUi.assign({
                engine,
            })}></${AnthaUi}>
        `);
        await engine.runSingleTick();

        const state = engine.state as AnthaPixiCanvasModState;

        await waitUntil.isTruthy(() => state.pixi.canvas);

        assert.instanceOf(state.pixi.canvas, HTMLCanvasElement);

        testWeb.cleanupRender();
    });
});
