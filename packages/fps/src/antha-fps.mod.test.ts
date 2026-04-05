import {AnthaEngine} from '@antha/engine';
import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {createAnthaFpsMod, type ShowCountersState} from './antha-fps.mod.js';

describe(createAnthaFpsMod.name, () => {
    it('creates a mod with default options', () => {
        const mod = createAnthaFpsMod();

        assert.strictEquals(mod.modName, 'antha-fps');
        assert.isDefined(mod.frequency);
        assert.deepEquals(mod.frequency, {
            durationMs: 500,
        });
        assert.isTrue(mod.executeImmediately);
    });

    it('creates a mod with custom options', () => {
        const mod = createAnthaFpsMod({
            fpsUpdateIntervalMs: 1000,
            hideFps: false,
            debugFps: true,
        });

        assert.strictEquals(mod.modName, 'antha-fps');
        assert.deepEquals(mod.frequency, {
            durationMs: 1000,
        });
    });

    it('initializes state defaults via execute', async () => {
        const mod = createAnthaFpsMod({
            hideFps: true,
        });

        const engine = new AnthaEngine<ShowCountersState>({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();

        assert.isTrue(engine.state.hideFps);
        assert.isDefined(engine.state.fpsStutters);
    });

    it('returns undefined when no counters are enabled', async () => {
        const mod = createAnthaFpsMod({
            hideFps: true,
            debugFps: false,
        });

        const engine = new AnthaEngine({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();

        assert.isUndefined(engine.currentTemplateMap.get(mod));
    });

    it('records stutters when debugFps is enabled', async () => {
        const mod = createAnthaFpsMod({
            debugFps: true,
            hideFps: false,
        });

        const engine = new AnthaEngine<ShowCountersState>({
            mods: [
                mod,
            ],
        });

        /** First tick initializes state. */
        await engine.runSingleTick();

        /**
         * Shift engine start time back by 1 second and advance current tick so the next execution
         * sees 32 ticks in 1 second (i.e. 32 FPS), which is below the expected ~62 FPS threshold.
         * The tick count must also exceed the frequency threshold (500ms / 16ms ≈ 31.25 ticks).
         */
        engine.engineStartTime = performance.now() - 1000;
        engine.currentTick = 32;
        engine.lastModExecution.set(mod, {
            tick: 0,
            timeMs: engine.engineStartTime,
        });

        await engine.runSingleTick();

        assert.isLengthExactly(engine.state.fpsStutters || [], 1);
    });

    it('caps stutters at 10 entries', async () => {
        const mod = createAnthaFpsMod({
            debugFps: true,
            hideFps: false,
        });

        const engine = new AnthaEngine<ShowCountersState>({
            mods: [
                mod,
            ],
        });

        /** First tick initializes state. */
        await engine.runSingleTick();

        /** Pre-fill 10 stutters so the next stutter triggers the splice. */
        engine.state.fpsStutters = Array.from(
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

        assert.isLengthExactly(engine.state.fpsStutters, 10);
    });

    it('renders stutter list when debugFps has recorded stutters', async () => {
        const mod = createAnthaFpsMod({
            debugFps: true,
            hideFps: false,
        });

        const engine = new AnthaEngine<ShowCountersState>({
            mods: [
                mod,
            ],
        });

        /** First tick initializes state. */
        await engine.runSingleTick();

        /** Pre-fill stutters so the stutter list template is rendered. */
        engine.state.fpsStutters = [
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
        assert.isLengthAtLeast(engine.state.fpsStutters, 2);
    });
});
