import {assert} from '@augment-vir/assert';
import {wait} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {html} from 'element-vir';
import {
    AnthaEngine,
    defaultAnthaEngineOptions,
    defineAnthaMod,
    type AnthaMod,
    type LastExecution,
} from './antha.js';

describe(defineAnthaMod.name, () => {
    it('returns the same mod object', () => {
        const mod: AnthaMod<{
            count: number;
        }> = {
            execute({state}) {
                state.count = (state.count || 0) + 1;
            },
        };

        assert.strictEquals(defineAnthaMod(mod), mod);
    });
    it('requires explicit state type', () => {
        defineAnthaMod({
            execute({state}) {
                // @ts-expect-error: state type is intentionally never
                state.count = 5;
            },
        });
    });
});

describe(AnthaEngine.name, () => {
    describe('constructor', () => {
        it('accepts missing init', () => {
            const engine = new AnthaEngine();

            assert.deepEquals(engine.options, defaultAnthaEngineOptions);
            assert.deepEquals(engine.currentMods, []);
            assert.strictEquals(engine.currentTick, 0);
            assert.isFalse(engine.isLoopRunning);
        });

        it('accepts undefined init', () => {
            const engine = new AnthaEngine(undefined);

            assert.deepEquals(engine.options, defaultAnthaEngineOptions);
            assert.deepEquals(engine.currentMods, []);
        });

        it('accepts options', () => {
            const engine = new AnthaEngine({
                options: {
                    tickDurationMs: 100,
                },
            });

            assert.strictEquals(engine.options.tickDurationMs, 100);
        });

        it('accepts mods', () => {
            const mod: AnthaMod = {
                execute() {},
            };
            const engine = new AnthaEngine({
                mods: [mod],
            });

            assert.isLengthExactly(engine.currentMods, 1);
            assert.strictEquals(engine.currentMods[0], mod);
        });

        it('uses defaults when config properties are undefined', () => {
            const engine = new AnthaEngine({
                options: {
                    tickDurationMs: undefined,
                },
            });

            assert.deepEquals(engine.options, defaultAnthaEngineOptions);
        });
    });

    describe('stopLoop', () => {
        it('returns true and stops when the loop is running', () => {
            const engine = new AnthaEngine();
            engine.isLoopRunning = true;

            const result = engine.stopLoop();

            assert.isTrue(result);
            assert.isFalse(engine.isLoopRunning);
        });

        it('returns false when the loop is not running', () => {
            const engine = new AnthaEngine();

            const result = engine.stopLoop();

            assert.isFalse(result);
            assert.isFalse(engine.isLoopRunning);
        });
    });

    it('reset clears all engine state', async () => {
        const mod: AnthaMod = defineAnthaMod<{
            count: number;
        }>({
            execute({state}) {
                state.count = (state.count || 0) + 1;
                return html`
                    <p>test</p>
                `;
            },
        });
        const engine = new AnthaEngine({
            mods: [mod],
        });

        engine.isLoopRunning = true;
        await engine.runSingleTick();
        await engine.runSingleTick();

        assert.isAbove(engine.currentTick, 0);
        assert.isDefined(engine.state.count);
        assert.isAbove(engine.currentTemplateArray.length, 0);
        assert.isDefined(engine.lastModExecution.get(mod));
        assert.isDefined(engine.currentTemplateMap.get(mod));
        assert.isAbove(engine.observable.value.length, 0);

        engine.reset();

        assert.strictEquals(engine.currentTick, 0);
        assert.isFalse(engine.isLoopRunning);
        assert.isUndefined(engine.state.count);
        assert.isEmpty(Object.keys(engine.state));
        assert.isLengthExactly(engine.currentTemplateArray, 0);
        assert.isUndefined(engine.lastModExecution.get(mod));
        assert.isUndefined(engine.currentTemplateMap.get(mod));
        assert.isEmpty(engine.observable.value);
    });

    describe('startLoop', () => {
        it('returns true and starts when the loop is not running', () => {
            const engine = new AnthaEngine();

            const result = engine.startLoop();

            assert.isTrue(result);
            assert.isTrue(engine.isLoopRunning);

            engine.stopLoop();
        });

        it('returns false when the loop is already running', () => {
            const engine = new AnthaEngine();
            engine.startLoop();

            const result = engine.startLoop();

            assert.isFalse(result);

            engine.stopLoop();
        });

        it('sets engineStartTime', () => {
            const engine = new AnthaEngine();
            const before = performance.now();
            engine.startLoop();
            const after = performance.now();

            assert.isAtLeast(engine.engineStartTime, before);
            assert.isAtMost(engine.engineStartTime, after);

            engine.stopLoop();
        });

        it('executes ticks over time', async () => {
            const engine = new AnthaEngine({
                mods: [
                    {
                        execute() {},
                    },
                ],
                options: {
                    tickDurationMs: 10,
                },
            });

            engine.startLoop();
            await wait({
                milliseconds: 100,
            });
            engine.stopLoop();

            assert.isAbove(engine.currentTick, 0);
        });
    });

    describe('runSingleTick', () => {
        it('increments currentTick', async () => {
            const engine = new AnthaEngine({
                mods: [
                    {
                        execute() {},
                    },
                ],
            });

            const tickBefore: number = engine.currentTick;
            assert.strictEquals(tickBefore, 0 as number);

            await engine.runSingleTick();
            const tickAfterFirst: number = engine.currentTick;
            assert.strictEquals(tickAfterFirst, 1 as number);

            await engine.runSingleTick();
            const tickAfterSecond: number = engine.currentTick;
            assert.strictEquals(tickAfterSecond, 2 as number);
        });

        it('executes all mods', async () => {
            let executedA = false;
            let executedB = false;
            const engine = new AnthaEngine({
                mods: [
                    {
                        execute() {
                            executedA = true;
                        },
                    },
                    {
                        execute() {
                            executedB = true;
                        },
                    },
                ],
            });

            await engine.runSingleTick();

            assert.isTrue(executedA);
            assert.isTrue(executedB);
        });

        it('stores templates in currentTemplateArray', async () => {
            const engine = new AnthaEngine({
                mods: [
                    {
                        execute() {
                            return html`
                                <p>first</p>
                            `;
                        },
                    },
                    {
                        execute() {
                            return html`
                                <p>second</p>
                            `;
                        },
                    },
                ],
            });

            await engine.runSingleTick();

            assert.isLengthExactly(engine.currentTemplateArray, 2);
            assert.isDefined(engine.currentTemplateArray[0]);
            assert.isDefined(engine.currentTemplateArray[1]);
        });

        it('stores templates in currentTemplateMap', async () => {
            const mod: AnthaMod = {
                execute() {
                    return html`
                        <p>mapped</p>
                    `;
                },
            };
            const engine = new AnthaEngine({
                mods: [mod],
            });

            await engine.runSingleTick();

            assert.isDefined(engine.currentTemplateMap.get(mod));
        });

        it('updates the observable', async () => {
            const engine = new AnthaEngine({
                mods: [
                    {
                        execute() {
                            return html`
                                <p>observed</p>
                            `;
                        },
                    },
                ],
            });

            await engine.runSingleTick();

            assert.isLengthExactly(engine.observable.value, 1);
        });

        it('passes correct params to mod execute', async () => {
            let capturedEngine: AnthaEngine | undefined;
            let capturedTick: number | undefined;
            let capturedState: Record<string, unknown> | undefined;
            let capturedTicksSince: number | undefined;
            let capturedLastExecution: unknown = 'sentinel';
            let capturedExecImmediate: boolean | undefined;
            let capturedFrequency: unknown = 'sentinel';

            const engine = new AnthaEngine({
                mods: [
                    defineAnthaMod<{
                        myVal: number;
                    }>({
                        execute(params) {
                            capturedEngine = params.engine;
                            capturedTick = params.currentTick;
                            capturedState = params.state as Record<string, unknown>;
                            capturedTicksSince = params.ticksSinceLastExecute;
                            capturedLastExecution = params.lastExecution;
                            capturedExecImmediate = params.executeImmediately;
                            capturedFrequency = params.frequency;
                        },
                    }),
                ],
                options: {
                    tickDurationMs: 50,
                },
            });

            engine.state.myVal = 42;
            await engine.runSingleTick();

            assert.strictEquals(capturedEngine, engine);
            assert.strictEquals(capturedTick, 0 as number);
            assert.strictEquals(capturedState, engine.state);
            assert.strictEquals(capturedTicksSince, 0 as number);
            assert.isUndefined(capturedLastExecution);
            assert.isFalse(capturedExecImmediate);
            assert.isUndefined(capturedFrequency);
        });

        it('passes lastExecution on subsequent ticks', async () => {
            let capturedLastExecution: unknown = 'sentinel';
            let capturedTicksSince: number | undefined;
            const engine = new AnthaEngine({
                mods: [
                    {
                        execute(params) {
                            capturedLastExecution = params.lastExecution;
                            capturedTicksSince = params.ticksSinceLastExecute;
                        },
                    },
                ],
            });

            await engine.runSingleTick();
            assert.isUndefined(capturedLastExecution);

            await engine.runSingleTick();
            assert.isDefined(capturedLastExecution);
            const lastExec = capturedLastExecution as LastExecution;
            assert.strictEquals(lastExec.tick, 0 as number);
            assert.strictEquals(capturedTicksSince, 1 as number);
        });

        it('handles mods returning void', async () => {
            const engine = new AnthaEngine({
                mods: [
                    {
                        execute() {
                            // returns void
                        },
                    },
                ],
            });

            await engine.runSingleTick();

            assert.isUndefined(engine.currentTemplateArray[0]);
        });

        it('handles async mods', async () => {
            const engine = new AnthaEngine({
                mods: [
                    {
                        async execute() {
                            await wait({
                                milliseconds: 1,
                            });
                            return html`
                                <p>async</p>
                            `;
                        },
                    },
                ],
            });

            await engine.runSingleTick();

            assert.isDefined(engine.currentTemplateArray[0]);
            assert.strictEquals(engine.currentTick, 1 as number);
        });

        it('records lastModExecution after executing', async () => {
            const mod: AnthaMod = {
                execute() {},
            };
            const engine = new AnthaEngine({
                mods: [mod],
            });

            await engine.runSingleTick();

            const lastExec = engine.lastModExecution.get(mod);
            assert.isDefined(lastExec);
            const execution = lastExec as LastExecution;
            assert.strictEquals(execution.tick, 0 as number);
            assert.isNumber(execution.timeMs);
        });

        it('uses cached template when mod does not execute due to frequency', async () => {
            const mod: AnthaMod = {
                frequency: {
                    ticks: 3,
                },
                executeImmediately: true,
                execute() {
                    return html`
                        <p>infrequent</p>
                    `;
                },
            };
            const engine = new AnthaEngine({
                mods: [mod],
            });

            // First tick: executeImmediately + no lastExecution → executes
            await engine.runSingleTick();
            assert.isDefined(engine.currentTemplateArray[0]);

            // Second tick: frequency not reached → skipped, but template is cached
            await engine.runSingleTick();
            assert.isDefined(engine.currentTemplateArray[0]);

            // The mod should not have re-executed on tick 1
            const lastExec = engine.lastModExecution.get(mod);
            assert.isDefined(lastExec);
            assert.strictEquals((lastExec as LastExecution).tick, 0 as number);
        });

        it('passes frequency and executeImmediately to mod execute params', async () => {
            let capturedExecImmediate: boolean | undefined;
            let capturedFrequency: unknown = 'sentinel';
            const engine = new AnthaEngine({
                mods: [
                    {
                        frequency: {
                            ticks: 2,
                        },
                        executeImmediately: true,
                        execute(params) {
                            capturedExecImmediate = params.executeImmediately;
                            capturedFrequency = params.frequency;
                        },
                    },
                ],
            });

            await engine.runSingleTick();

            assert.isTrue(capturedExecImmediate);
            assert.deepEquals(capturedFrequency, {
                ticks: 2,
            });
        });

        it('state is shared across mods', async () => {
            const engine = new AnthaEngine({
                mods: [
                    defineAnthaMod<{
                        value: number;
                    }>({
                        execute({state}) {
                            state.value = 99;
                        },
                    }),
                    defineAnthaMod<{
                        value: number;
                        doubled: number;
                    }>({
                        execute({state}) {
                            state.doubled = (state.value || 0) * 2;
                        },
                    }),
                ],
            });

            await engine.runSingleTick();

            assert.strictEquals(engine.state.value, 99);
            assert.strictEquals(engine.state.doubled, 198);
        });
    });

    describe('shouldModExecute', () => {
        it('returns true when no frequency is set', () => {
            const engine = new AnthaEngine();
            const mod: AnthaMod = {
                execute() {},
            };

            assert.isTrue(engine.shouldModExecute(mod, undefined));
        });

        it('returns true when no frequency is set, even with lastExecution', () => {
            const engine = new AnthaEngine();
            const mod: AnthaMod = {
                execute() {},
            };
            const lastExecution: LastExecution = {
                tick: 0,
                timeMs: 0,
            };

            assert.isTrue(engine.shouldModExecute(mod, lastExecution));
        });

        it('returns true when executeImmediately is true and no lastExecution', () => {
            const engine = new AnthaEngine();
            const mod: AnthaMod = {
                frequency: {
                    ticks: 10,
                },
                executeImmediately: true,
                execute() {},
            };

            assert.isTrue(engine.shouldModExecute(mod, undefined));
        });

        it('does not immediately execute when executeImmediately is false', () => {
            const engine = new AnthaEngine();
            const mod: AnthaMod = {
                frequency: {
                    ticks: 10,
                },
                execute() {},
            };

            assert.isFalse(engine.shouldModExecute(mod, undefined));
        });

        it('returns true when tick frequency is reached', () => {
            const engine = new AnthaEngine();
            engine.currentTick = 10;
            const mod: AnthaMod = {
                frequency: {
                    ticks: 5,
                },
                execute() {},
            };
            const lastExecution: LastExecution = {
                tick: 5,
                timeMs: 0,
            };

            assert.isTrue(engine.shouldModExecute(mod, lastExecution));
        });

        it('returns false when tick frequency is not yet reached', () => {
            const engine = new AnthaEngine();
            engine.currentTick = 3;
            const mod: AnthaMod = {
                frequency: {
                    ticks: 5,
                },
                execute() {},
            };
            const lastExecution: LastExecution = {
                tick: 1,
                timeMs: 0,
            };

            assert.isFalse(engine.shouldModExecute(mod, lastExecution));
        });

        it('handles durationMs frequency by converting to ticks', () => {
            const engine = new AnthaEngine({
                options: {
                    tickDurationMs: 16,
                },
            });
            engine.currentTick = 10;

            const mod: AnthaMod = {
                frequency: {
                    durationMs: 160,
                },
                execute() {},
            };
            const lastExecution: LastExecution = {
                tick: 0,
                timeMs: 0,
            };

            assert.isTrue(engine.shouldModExecute(mod, lastExecution));
        });

        it('returns false when durationMs frequency is not reached', () => {
            const engine = new AnthaEngine({
                options: {
                    tickDurationMs: 16,
                },
            });
            engine.currentTick = 5;

            const mod: AnthaMod = {
                frequency: {
                    durationMs: 160,
                },
                execute() {},
            };
            const lastExecution: LastExecution = {
                tick: 0,
                timeMs: 0,
            };

            assert.isFalse(engine.shouldModExecute(mod, lastExecution));
        });

        it('returns true when ticksBetweenExecutions is 0 (zero frequency ticks)', () => {
            const engine = new AnthaEngine();
            const mod: AnthaMod = {
                frequency: {
                    ticks: 0,
                },
                execute() {},
            };
            const lastExecution: LastExecution = {
                tick: 0,
                timeMs: 0,
            };

            assert.isTrue(engine.shouldModExecute(mod, lastExecution));
        });

        it('returns true when durationMs is 0 (zero frequency duration)', () => {
            const engine = new AnthaEngine({
                options: {
                    tickDurationMs: 16,
                },
            });
            const mod: AnthaMod = {
                frequency: {
                    durationMs: 0,
                },
                execute() {},
            };
            const lastExecution: LastExecution = {
                tick: 0,
                timeMs: 0,
            };

            assert.isTrue(engine.shouldModExecute(mod, lastExecution));
        });

        it('respects frequency after executeImmediately first tick', () => {
            const engine = new AnthaEngine();
            engine.currentTick = 1;
            const mod: AnthaMod = {
                frequency: {
                    ticks: 5,
                },
                executeImmediately: true,
                execute() {},
            };
            const lastExecution: LastExecution = {
                tick: 0,
                timeMs: 0,
            };

            assert.isFalse(engine.shouldModExecute(mod, lastExecution));
        });
    });

    it('stops running when isLoopRunning is set to false', async () => {
        const engine = new AnthaEngine({
            mods: [
                {
                    execute() {},
                },
            ],
            options: {
                tickDurationMs: 10,
            },
        });

        engine.startLoop();
        await wait({
            milliseconds: 50,
        });
        const ticksAfterStart = engine.currentTick;
        assert.isAbove(ticksAfterStart, 0);

        engine.isLoopRunning = false;
        await wait({
            milliseconds: 50,
        });
        const ticksAfterStop = engine.currentTick;

        await wait({
            milliseconds: 50,
        });
        assert.isAtMost(engine.currentTick, ticksAfterStop + 1);
    });

    it('can run ticks with an empty mod list', async () => {
        const engine = new AnthaEngine();

        await engine.runSingleTick();
        await engine.runSingleTick();

        assert.strictEquals(engine.currentTick, 2 as number);
        assert.isLengthExactly(engine.currentTemplateArray, 0);
    });

    it('provides time since engine start on first execution', async () => {
        let capturedMs: number | undefined;
        const engine = new AnthaEngine({
            mods: [
                {
                    execute(params) {
                        capturedMs = params.msSinceLastExecute;
                    },
                },
            ],
        });

        await wait({
            milliseconds: 10,
        });
        await engine.runSingleTick();

        assert.isDefined(capturedMs);
        assert.isAbove(capturedMs, 0);
    });

    it('provides time since last execution on subsequent ticks', async () => {
        const msTimes: number[] = [];
        const engine = new AnthaEngine({
            mods: [
                {
                    execute(params) {
                        msTimes.push(params.msSinceLastExecute);
                    },
                },
            ],
        });

        await engine.runSingleTick();
        await wait({
            milliseconds: 10,
        });
        await engine.runSingleTick();

        assert.isLengthAtLeast(msTimes, 2);
        assert.isAbove(msTimes[1], 0);
    });

    it('reuses the last template when a mod is skipped', async () => {
        let executeCount = 0;
        const mod: AnthaMod = {
            frequency: {
                ticks: 100,
            },
            executeImmediately: true,
            execute() {
                executeCount++;
                return html`
                    <p>run ${String(executeCount)}</p>
                `;
            },
        };
        const engine = new AnthaEngine({
            mods: [mod],
        });

        await engine.runSingleTick();
        assert.strictEquals(executeCount, 1);
        assert.isDefined(engine.currentTemplateArray[0]);

        await engine.runSingleTick();
        assert.strictEquals(executeCount, 1);
        assert.isDefined(engine.currentTemplateArray[0]);
    });

    it('supports adding mods at runtime', async () => {
        const engine = new AnthaEngine();

        await engine.runSingleTick();
        assert.isLengthExactly(engine.currentTemplateArray, 0);

        engine.currentMods.push({
            execute() {
                return html`
                    <p>dynamic</p>
                `;
            },
        });

        await engine.runSingleTick();
        assert.isLengthExactly(engine.currentTemplateArray, 1);
    });

    it('supports removing mods at runtime', async () => {
        const engine = new AnthaEngine({
            mods: [
                {
                    execute() {
                        return html`
                            <p>removable</p>
                        `;
                    },
                },
            ],
        });

        await engine.runSingleTick();
        assert.isLengthExactly(engine.currentTemplateArray, 1);

        engine.currentMods.length = 0;

        await engine.runSingleTick();
        assert.isLengthExactly(engine.currentTemplateArray, 0);
    });
});
