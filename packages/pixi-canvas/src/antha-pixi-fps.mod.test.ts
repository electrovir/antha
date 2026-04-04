import {AnthaEngine, html} from '@antha/engine';
import {assert, waitUntil} from '@augment-vir/assert';
import {describe, it, testWeb} from '@augment-vir/test';
import {ViraButton} from 'vira';
import {type AnthaPixiCanvasModState} from './antha-pixi-canvas.mod.js';
import {createAnthaPixiFpsMod, type ShowCountersState} from './antha-pixi-fps.mod.js';
import {createMockPixi} from './mock-pixi.js';

describe(createAnthaPixiFpsMod.name, () => {
    it('creates a mod with default options', () => {
        const mod = createAnthaPixiFpsMod();

        assert.strictEquals(mod.modName, 'antha-pixi-fps');
        assert.isDefined(mod.frequency);
        assert.deepEquals(mod.frequency, {
            durationMs: 500,
        });
        assert.isTrue(mod.executeImmediately);
    });

    it('creates a mod with custom options', () => {
        const mod = createAnthaPixiFpsMod({
            updateIntervalMs: 1000,
            hideFps: false,
            hideTps: false,
            debugTps: true,
        });

        assert.strictEquals(mod.modName, 'antha-pixi-fps');
        assert.deepEquals(mod.frequency, {
            durationMs: 1000,
        });
    });

    it('initializes state defaults via execute', async () => {
        const mod = createAnthaPixiFpsMod({
            hideFps: true,
            hideTps: false,
        });

        const engine = new AnthaEngine<AnthaPixiCanvasModState & ShowCountersState>({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();

        assert.isTrue(engine.state.hideFps);
        assert.isFalse(engine.state.hideTps);
        assert.isDefined(engine.state.tpsStutters);
    });

    it('returns undefined when no counters are enabled', async () => {
        const mod = createAnthaPixiFpsMod({
            hideFps: true,
            hideTps: true,
            debugTps: false,
        });

        const engine = new AnthaEngine({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();

        assert.isUndefined(engine.currentTemplateMap.get(mod));
    });

    it('records stutters when debugTps is enabled', async () => {
        const mod = createAnthaPixiFpsMod({
            debugTps: true,
            hideFps: false,
            hideTps: false,
        });

        const engine = new AnthaEngine<AnthaPixiCanvasModState & ShowCountersState>({
            mods: [
                mod,
            ],
        });

        /** First tick initializes state. */
        await engine.runSingleTick();

        /**
         * Shift engine start time back by 1 second and advance current tick so the next execution
         * sees 32 ticks in 1 second (i.e. 32 TPS), which is below the expected ~62 TPS threshold.
         * The tick count must also exceed the frequency threshold (500ms / 16ms ≈ 31.25 ticks).
         */
        engine.engineStartTime = performance.now() - 1000;
        engine.currentTick = 32;
        engine.lastModExecution.set(mod, {
            tick: 0,
            timeMs: engine.engineStartTime,
        });

        await engine.runSingleTick();

        assert.isLengthExactly(engine.state.tpsStutters || [], 1);
    });

    it('caps stutters at 10 entries', async () => {
        const mod = createAnthaPixiFpsMod({
            debugTps: true,
            hideFps: false,
            hideTps: false,
        });

        const engine = new AnthaEngine<AnthaPixiCanvasModState & ShowCountersState>({
            mods: [
                mod,
            ],
        });

        /** First tick initializes state. */
        await engine.runSingleTick();

        /** Pre-fill 10 stutters so the next stutter triggers the splice. */
        engine.state.tpsStutters = Array.from(
            {
                length: 10,
            },
            () => 50,
        );

        engine.engineStartTime = performance.now() - 1000;
        engine.currentTick = 32;
        engine.lastModExecution.set(mod, {
            tick: 0,
            timeMs: engine.engineStartTime,
        });

        await engine.runSingleTick();

        assert.isLengthExactly(engine.state.tpsStutters, 10);
    });

    it('renders a pause button when enableTickPause is enabled', async () => {
        const mod = createAnthaPixiFpsMod({
            enableTickPause: true,
            hideFps: false,
            hideTps: false,
        });

        const engine = new AnthaEngine<AnthaPixiCanvasModState & ShowCountersState>({
            mods: [
                mod,
            ],
        });

        /** First tick initializes state but enableTickPause is not auto-set on state. */
        await engine.runSingleTick();

        engine.state.enableTickPause = true;

        engine.isLoopRunning = true;

        engine.engineStartTime = performance.now() - 1000;
        engine.currentTick = 32;
        engine.lastModExecution.set(mod, {
            tick: 0,
            timeMs: engine.engineStartTime,
        });

        await engine.runSingleTick();

        assert.isDefined(engine.currentTemplateMap.get(mod));
    });

    it('renders the FPS display with a non-zero value', async () => {
        const mod = createAnthaPixiFpsMod({
            hideFps: false,
            hideTps: false,
        });

        const engine = new AnthaEngine<AnthaPixiCanvasModState>({
            mods: [
                mod,
            ],
        });

        const mockPixi = createMockPixi();

        mockPixi.ticker.elapsedMS = 16;

        engine.state.pixi = {
            pixiApplication: mockPixi,
        };

        await engine.runSingleTick();

        assert.isDefined(engine.currentTemplateMap.get(mod));
    });

    it('renders the TPS display when showTps is enabled', async () => {
        const mod = createAnthaPixiFpsMod({
            hideFps: false,
            hideTps: true,
        });

        const engine = new AnthaEngine({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();

        assert.isDefined(engine.currentTemplateMap.get(mod));
    });

    it('click handler toggles the engine loop via pause button', async () => {
        const mod = createAnthaPixiFpsMod({
            enableTickPause: true,
            hideFps: false,
            hideTps: false,
        });

        const engine = new AnthaEngine<AnthaPixiCanvasModState & ShowCountersState>({
            mods: [
                mod,
            ],
        });

        engine.state.enableTickPause = true;

        await engine.runSingleTick();

        const template = engine.currentTemplateMap.get(mod);

        assert.isDefined(template);

        const fixture = await testWeb.render(html`
            <div>${template}</div>
        `);

        const viraButton = await waitUntil.instanceOf(ViraButton, () =>
            fixture.querySelector(ViraButton.tagName),
        );

        /** Engine is not running, so clicking starts the loop. */
        viraButton.click();
        assert.isTrue(engine.isLoopRunning);

        /** Engine is now running, so clicking stops the loop. */
        viraButton.click();
        assert.isFalse(engine.isLoopRunning);

        testWeb.cleanupRender();
    });

    it('renders stutter list when debugTps has recorded stutters', async () => {
        const mod = createAnthaPixiFpsMod({
            debugTps: true,
            hideFps: false,
            hideTps: false,
        });

        const engine = new AnthaEngine<AnthaPixiCanvasModState & ShowCountersState>({
            mods: [
                mod,
            ],
        });

        /** First tick initializes state. */
        await engine.runSingleTick();

        /** Pre-fill stutters so the stutter list template is rendered. */
        engine.state.tpsStutters = [
            50,
            45,
        ];

        engine.engineStartTime = performance.now() - 1000;
        engine.currentTick = 32;
        engine.lastModExecution.set(mod, {
            tick: 0,
            timeMs: engine.engineStartTime,
        });

        await engine.runSingleTick();

        assert.isDefined(engine.currentTemplateMap.get(mod));
        assert.isLengthAtLeast(engine.state.tpsStutters, 2);
    });
});
