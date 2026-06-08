import {AnthaEngine, AnthaUi} from '@antha/engine';
import {assert, waitUntil} from '@augment-vir/assert';
import {describe, it, testWeb} from '@augment-vir/test';
import {html} from 'element-vir';
import {createAnthaGraphics2dMod, type AnthaGraphics2dModState} from './antha-graphics-2d.mod.js';
import {createMockPixi} from './mock-pixi.js';

describe(createAnthaGraphics2dMod.name, () => {
    it('creates a mod with the correct name', () => {
        const mod = createAnthaGraphics2dMod();

        assert.strictEquals(mod.modName, 'antha-graphics-2d');
    });

    it('initializes pixi state and returns a template', async () => {
        const mod = createAnthaGraphics2dMod();
        const engine = new AnthaEngine<AnthaGraphics2dModState>({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();

        assert.isDefined(engine.state.pixi);
        assert.isDefined(engine.currentTemplateMap.get(mod));
    });

    it('creates a PixiApplication when canvas is already in state', async () => {
        const mod = createAnthaGraphics2dMod();
        const engine = new AnthaEngine<AnthaGraphics2dModState>({
            mods: [
                mod,
            ],
        });

        engine.state.pixi = {
            canvas: document.createElement('canvas'),
        };

        await engine.runSingleTick();

        assert.isDefined(engine.state.pixi.pixiApplication);

        await engine.reset();
    });

    it('destroys pixi application on cleanup', async () => {
        const mod = createAnthaGraphics2dMod();
        const engine = new AnthaEngine<AnthaGraphics2dModState>({
            mods: [
                mod,
            ],
        });
        const mockApp = createMockPixi();

        engine.state.pixi = {
            pixiApplication: mockApp,
        };

        await engine.reset();

        assert.isTrue(mockApp.stage.destroyed);
    });

    it('cleanup is safe when pixi state is empty', async () => {
        const mod = createAnthaGraphics2dMod();
        const engine = new AnthaEngine<AnthaGraphics2dModState>({
            mods: [
                mod,
            ],
        });

        await engine.reset();
    });

    it('returns undefined when an external canvas is provided via pixiOptions', async () => {
        const externalCanvas = document.createElement('canvas');
        const mod = createAnthaGraphics2dMod({
            pixiOptions: {
                canvas: externalCanvas,
            },
        });
        const engine = new AnthaEngine<AnthaGraphics2dModState>({
            mods: [
                mod,
            ],
        });

        engine.state.pixi = {
            pixiApplication: createMockPixi(),
        };

        await engine.runSingleTick();

        assert.isUndefined(engine.currentTemplateMap.get(mod));
    });

    it('handles missing background option', async () => {
        const mod = createAnthaGraphics2dMod({
            pixiOptions: {
                background: '',
            },
        });
        const engine = new AnthaEngine<AnthaGraphics2dModState>({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();

        assert.isDefined(engine.currentTemplateMap.get(mod));
    });

    it('sets canvas via onDomCreated when rendered', async () => {
        const mod = createAnthaGraphics2dMod();
        const engine = new AnthaEngine<AnthaGraphics2dModState>({
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

        await waitUntil.isDefined(() => engine.state.pixi?.canvas);

        assert.instanceOf(engine.state.pixi?.canvas, HTMLCanvasElement);

        testWeb.cleanupRender();
    });

    it('uses dynamic canvas sizing when dynamicCanvasSize is true', async () => {
        const mod = createAnthaGraphics2dMod({
            dynamicCanvasSize: true,
        });
        const engine = new AnthaEngine<AnthaGraphics2dModState>({
            mods: [
                mod,
            ],
        });

        engine.state.pixi = {
            canvas: document.createElement('canvas'),
        };

        await engine.runSingleTick();

        assert.isDefined(engine.state.pixi.pixiApplication);
        assert.isDefined(engine.currentTemplateMap.get(mod));

        await engine.reset();
    });
});
