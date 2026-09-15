import {assert} from '@augment-vir/assert';
import {DeferredPromise, selectFrom, wait, type AnyObject} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {html} from 'element-vir';
import {
    AnthaEngine,
    ModExecutionTriggerType,
    SkipExecution,
    defaultAnthaEngineOptions,
    defineAnthaMod,
    type AnthaMod,
    type AnthaModState,
    type AnthaModsState,
    type LastExecution,
    type ModCleanupParams,
    type ModExecutionTrigger,
    type ModInstanceId,
    type ModTrigger,
} from './antha-engine.js';

describe(defineAnthaMod.name, () => {
    it('returns the same mod object', () => {
        const mod: AnthaMod<{
            count: number;
        }> = {
            modName: 'test',
            execute({state}) {
                state.count = (state.count || 0) + 1;
            },
        };

        assert.strictEquals(defineAnthaMod<AnthaModState<typeof mod>>(mod), mod);
    });
    it('requires explicit state type', () => {
        defineAnthaMod({
            modName: 'test',
            execute({state}) {
                // @ts-expect-error: state type is intentionally never
                state.count = 5;
            },
        });
    });
});

describe('AnthaModsState', () => {
    it('combines state from a readonly mod array', () => {
        const mods = [
            defineAnthaMod<{count: number}>({
                modName: 'counter',
                execute() {},
            }),
            defineAnthaMod<{name: string}>({
                modName: 'name',
                execute() {},
            }),
        ] as const;

        assert.tsType<AnthaModsState<typeof mods>>().matches<{
            count: number;
            name: string;
        }>();
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

        it('accepts mods', () => {
            const mod: AnthaMod = {
                modName: 'test',
                execute() {},
            };
            const engine = new AnthaEngine({
                mods: [mod],
            });

            assert.isLengthExactly(engine.currentMods, 1);
            assert.strictEquals(engine.currentMods[0], mod);
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
            modName: 'test',
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

        await engine.reset();

        assert.strictEquals(engine.currentTick, 0);
        assert.isFalse(engine.isLoopRunning);
        assert.isUndefined(engine.state.count);
        assert.isEmpty(Object.keys(engine.state));
        assert.isLengthExactly(engine.currentTemplateArray, 0);
        assert.isUndefined(engine.lastModExecution.get(mod));
        assert.isUndefined(engine.currentTemplateMap.get(mod));
        assert.isEmpty(engine.observable.value);
    });

    describe('mod cleanup', () => {
        it('calls cleanup on each mod during reset', async () => {
            let cleanupCalledA = false;
            let cleanupCalledB = false;
            const engine = new AnthaEngine({
                mods: [
                    {
                        modName: 'test',
                        execute() {},
                        cleanup() {
                            cleanupCalledA = true;
                        },
                    },
                    {
                        modName: 'test',
                        execute() {},
                        cleanup() {
                            cleanupCalledB = true;
                        },
                    },
                ],
            });

            await engine.runSingleTick();
            await engine.reset();

            assert.isTrue(cleanupCalledA);
            assert.isTrue(cleanupCalledB);
        });

        it('passes correct params to cleanup', async () => {
            let capturedParams: Readonly<ModCleanupParams<{value: number}>> | undefined;
            const mod: AnthaMod<{value: number}> = defineAnthaMod<{value: number}>({
                modName: 'test',
                execute({state}) {
                    state.value = 42;
                },
                cleanup(params) {
                    capturedParams = params;
                },
            });
            const engine = new AnthaEngine({
                mods: [mod],
            });

            await engine.runSingleTick();
            await engine.reset();

            assert.isDefined(capturedParams);
            assert.isDefined(capturedParams.modInstanceId);
            assert.isDefined(engine.hostElement);
            assert.deepEquals(
                selectFrom(capturedParams, {
                    engine: true,
                    hostElement: true,
                    trigger: true,
                }),
                {
                    engine,
                    hostElement: engine.hostElement,
                    trigger: undefined,
                },
            );
        });

        it('provides the same modInstanceId to cleanup as to execute', async () => {
            let executeInstanceId: ModInstanceId | undefined;
            let cleanupInstanceId: ModInstanceId | undefined;
            const engine = new AnthaEngine({
                mods: [
                    defineAnthaMod<AnyObject>({
                        modName: 'test',
                        execute({modInstanceId}) {
                            executeInstanceId = modInstanceId;
                        },
                        cleanup({modInstanceId}) {
                            cleanupInstanceId = modInstanceId;
                        },
                    }),
                ],
            });

            await engine.runSingleTick();
            await engine.reset();

            assert.isDefined(executeInstanceId);
            assert.strictEquals(cleanupInstanceId, executeInstanceId);
        });

        it('provides a modInstanceId to cleanup even when the engine has not ticked yet.', async () => {
            let executeInstanceId: ModInstanceId | undefined;
            let cleanupInstanceId: ModInstanceId | undefined;
            const engine = new AnthaEngine({
                mods: [
                    defineAnthaMod<AnyObject>({
                        modName: 'test',
                        execute({modInstanceId}) {
                            executeInstanceId = modInstanceId;
                        },
                        cleanup({modInstanceId}) {
                            cleanupInstanceId = modInstanceId;
                        },
                    }),
                ],
            });

            await engine.reset();

            assert.isUndefined(executeInstanceId);
            assert.isTruthy(cleanupInstanceId);
        });

        it('awaits async cleanup', async () => {
            let cleanupFinished = false;
            const engine = new AnthaEngine({
                mods: [
                    {
                        modName: 'test',
                        execute() {},
                        async cleanup() {
                            await wait({
                                milliseconds: 10,
                            });
                            cleanupFinished = true;
                        },
                    },
                ],
            });

            await engine.runSingleTick();
            await engine.reset();

            assert.isTrue(cleanupFinished);
        });

        it('cleanup receives current state before it is cleared', async () => {
            let capturedValue: number | undefined;
            const engine = new AnthaEngine({
                mods: [
                    defineAnthaMod<{value: number}>({
                        modName: 'test',
                        execute({state}) {
                            state.value = 99;
                        },
                        cleanup({state}) {
                            capturedValue = state.value;
                        },
                    }),
                ],
            });

            await engine.runSingleTick();
            await engine.reset();

            assert.strictEquals(capturedValue, 99);
            assert.isUndefined(engine.state.value);
        });

        it('does not fail when mods have no cleanup', async () => {
            const engine = new AnthaEngine({
                mods: [
                    {
                        modName: 'test',
                        execute() {},
                    },
                ],
            });

            await engine.runSingleTick();
            await engine.reset();

            assert.strictEquals(engine.currentTick, 0);
        });
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
                        modName: 'test',
                        execute() {},
                    },
                ],
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
                        modName: 'test',
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
            assert.strictEquals(tickAfterSecond, 2);
        });

        it('executes all mods', async () => {
            let executedA = false;
            let executedB = false;
            const engine = new AnthaEngine({
                mods: [
                    {
                        modName: 'test',
                        execute() {
                            executedA = true;
                        },
                    },
                    {
                        modName: 'test',
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
                        modName: 'test',
                        execute() {
                            return html`
                                <p>first</p>
                            `;
                        },
                    },
                    {
                        modName: 'test',
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
                modName: 'test',
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
                        modName: 'test',
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
            let capturedTrigger: ModTrigger | undefined;

            const engine = new AnthaEngine({
                mods: [
                    defineAnthaMod<{
                        myVal: number;
                    }>({
                        modName: 'test',
                        execute(params) {
                            capturedEngine = params.engine;
                            capturedTick = params.currentTick;
                            capturedState = params.state;
                            capturedTicksSince = params.ticksSinceLastExecute;
                            capturedLastExecution = params.lastExecution;
                            capturedTrigger = params.trigger;
                        },
                    }),
                ],
            });

            engine.state.myVal = 42;
            await engine.runSingleTick();

            assert.strictEquals(capturedEngine, engine);
            assert.strictEquals(capturedTick, 0 as number);
            assert.strictEquals(capturedState, engine.state);
            assert.strictEquals(capturedTicksSince, 0);
            assert.isUndefined(capturedLastExecution);
            assert.isUndefined(capturedTrigger);
        });

        it('passes lastExecution on subsequent ticks', async () => {
            let capturedLastExecution = 'sentinel' as LastExecution | string | undefined;
            let capturedTicksSince: number | undefined;
            const engine = new AnthaEngine({
                mods: [
                    {
                        modName: 'test',
                        execute(params) {
                            capturedLastExecution = params.lastExecution;
                            capturedTicksSince = params.ticksSinceLastExecute;
                        },
                    },
                ],
            });

            await engine.runSingleTick();
            assert.isUndefined(capturedLastExecution as any);

            await engine.runSingleTick();
            assert.isDefined(capturedLastExecution);
            assert.isNotString(capturedLastExecution);
            assert.strictEquals(capturedLastExecution.tick, 0);
            assert.strictEquals(capturedTicksSince, 1);
        });

        it('handles mods returning void', async () => {
            const engine = new AnthaEngine({
                mods: [
                    {
                        modName: 'test',
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
                        modName: 'test',
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
            assert.strictEquals(engine.currentTick, 1);
        });

        it('records lastModExecution after executing', async () => {
            const mod: AnthaMod = {
                modName: 'test',
                execute() {},
            };
            const engine = new AnthaEngine({
                mods: [mod],
            });

            await engine.runSingleTick();

            const lastExecution = engine.lastModExecution.get(mod);
            assert.isDefined(lastExecution);
            assert.strictEquals(lastExecution.tick, 0);
            assert.isNumber(lastExecution.timeMs);
        });

        it('applies initState on first execution', async () => {
            const engine = new AnthaEngine({
                mods: [
                    defineAnthaMod<{count: number; label: string}>({
                        modName: 'test',
                        initState: {
                            count: 10,
                            label: 'hello',
                        },
                        execute({state}) {
                            return html`
                                <p>${String(state.count)} ${state.label}</p>
                            `;
                        },
                    }),
                ],
            });

            await engine.runSingleTick();

            assert.strictEquals(engine.state.count, 10);
            assert.strictEquals(engine.state.label, 'hello');
        });

        it('uses cached template when mod does not execute due to its trigger', async () => {
            const mod: AnthaMod = {
                trigger: {
                    executeImmediately: true,
                    tickCount: 3,
                },
                modName: 'test',
                execute() {
                    return html`
                        <p>infrequent</p>
                    `;
                },
            };
            const engine = new AnthaEngine({
                mods: [mod],
            });

            // First tick: executeImmediately + no lastExecution → executes.
            await engine.runSingleTick();
            assert.isDefined(engine.currentTemplateArray[0]);

            // Second tick: trigger not reached → skipped, but template is cached.
            await engine.runSingleTick();
            assert.isDefined(engine.currentTemplateArray[0]);

            // The mod should not have re-executed on tick 1.
            const lastExec = engine.lastModExecution.get(mod);
            assert.isDefined(lastExec);
            assert.strictEquals((lastExec as LastExecution).tick, 0 as number);
        });

        it('passes trigger to mod execute params', async () => {
            let capturedTrigger: ModTrigger | undefined;
            const engine = new AnthaEngine({
                mods: [
                    {
                        trigger: {
                            executeImmediately: true,
                            tickCount: 2,
                        },
                        modName: 'test',
                        execute(params) {
                            capturedTrigger = params.trigger;
                        },
                    },
                ],
            });

            await engine.runSingleTick();

            assert.deepEquals(capturedTrigger, {
                executeImmediately: true,
                tickCount: 2,
            });
        });

        it('state is shared across mods', async () => {
            const engine = new AnthaEngine({
                mods: [
                    defineAnthaMod<{
                        value: number;
                    }>({
                        modName: 'test',
                        execute({state}) {
                            state.value = 99;
                        },
                    }),
                    defineAnthaMod<{
                        value: number;
                        doubled: number;
                    }>({
                        modName: 'test',
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

    describe('event-triggered mods', () => {
        it('can switch a mod between tick and event execution at runtime', async () => {
            class TestEngineEvent extends Event {
                public static readonly type = 'test-engine-event';

                constructor() {
                    super(TestEngineEvent.type);
                }
            }

            const executionTriggers: Readonly<ModExecutionTrigger>[] = [];
            const mod = defineAnthaMod<AnyObject>({
                modName: 'event-triggered-mod',
                execute({executionTrigger}) {
                    executionTriggers.push(executionTrigger);
                },
            });
            const engine = new AnthaEngine({
                mods: [
                    mod,
                ],
            });
            let listenerCount = 0;

            engine.listen(TestEngineEvent, () => {
                listenerCount++;
            });

            await engine.runSingleTick();
            mod.trigger = {
                event: TestEngineEvent,
                executeImmediately: false,
            };
            const event = new TestEngineEvent();
            engine.dispatch(event);
            assert.deepEquals(
                executionTriggers.map(({type}) => {
                    return type;
                }),
                [
                    ModExecutionTriggerType.Tick,
                ],
            );
            await engine.runSingleTick();
            mod.trigger = {
                event: [
                    TestEngineEvent,
                ],
                executeImmediately: false,
            };
            engine.dispatch(new TestEngineEvent());
            await engine.runSingleTick();
            mod.trigger = undefined;
            engine.dispatch(new TestEngineEvent());
            await engine.runSingleTick();

            assert.deepEquals(
                executionTriggers.map(({type}) => {
                    return type;
                }),
                [
                    ModExecutionTriggerType.Tick,
                    ModExecutionTriggerType.Event,
                    ModExecutionTriggerType.Event,
                    ModExecutionTriggerType.Tick,
                ],
            );
            assert.strictEquals(listenerCount, 3);
        });

        it('runs triggered mods in attachment order with all pending events', async () => {
            class TestEngineEvent extends Event {
                public static readonly type = 'test-engine-event';

                constructor() {
                    super(TestEngineEvent.type);
                }
            }

            const executionOrder: Array<
                Readonly<{
                    eventCount: number;
                    modName: string;
                }>
            > = [];
            const firstMod = defineAnthaMod<AnyObject>({
                trigger: {
                    event: TestEngineEvent,
                    executeImmediately: false,
                },
                modName: 'first',
                execute({executionTrigger}) {
                    if (executionTrigger.type === ModExecutionTriggerType.Event) {
                        executionOrder.push({
                            eventCount: executionTrigger.events.length,
                            modName: 'first',
                        });
                    }
                },
            });
            const secondMod = defineAnthaMod<AnyObject>({
                trigger: {
                    event: TestEngineEvent,
                    executeImmediately: false,
                },
                modName: 'second',
                execute({executionTrigger}) {
                    if (executionTrigger.type === ModExecutionTriggerType.Event) {
                        executionOrder.push({
                            eventCount: executionTrigger.events.length,
                            modName: 'second',
                        });
                    }
                },
            });
            const engine = new AnthaEngine({
                mods: [
                    firstMod,
                    secondMod,
                ],
            });

            engine.dispatch(new TestEngineEvent());
            engine.dispatch(new TestEngineEvent());
            await engine.runSingleTick();

            assert.deepEquals(executionOrder, [
                {
                    eventCount: 2,
                    modName: 'first',
                },
                {
                    eventCount: 2,
                    modName: 'second',
                },
            ]);
        });

        it('skips ordinary ticks and events that do not match the trigger', async () => {
            class MatchingEvent extends Event {
                constructor() {
                    super('matching-event');
                }
            }

            class OtherEvent extends Event {
                constructor() {
                    super('other-event');
                }
            }

            const executionTriggers: Readonly<ModExecutionTrigger>[] = [];
            const mod = defineAnthaMod<AnyObject>({
                trigger: {
                    event: MatchingEvent,
                    executeImmediately: false,
                },
                modName: 'matching-event-mod',
                execute({executionTrigger}) {
                    executionTriggers.push(executionTrigger);
                },
            });
            const engine = new AnthaEngine({
                mods: [
                    mod,
                ],
            });

            await engine.runSingleTick();
            engine.dispatch(new OtherEvent());
            await engine.runSingleTick();

            assert.deepEquals(executionTriggers, []);

            const matchingEvent = new MatchingEvent();
            engine.dispatch(matchingEvent);
            await engine.runSingleTick();

            assert.deepEquals(executionTriggers, [
                {
                    events: [
                        matchingEvent,
                    ],
                    type: ModExecutionTriggerType.Event,
                },
            ]);
        });

        it('executes immediately once before returning to event-only execution', async () => {
            class TestEngineEvent extends Event {
                constructor() {
                    super('test-engine-event');
                }
            }

            const executionTriggers: Readonly<ModExecutionTrigger>[] = [];
            const engine = new AnthaEngine({
                mods: [
                    defineAnthaMod<AnyObject>({
                        trigger: {
                            event: TestEngineEvent,
                            executeImmediately: true,
                        },
                        modName: 'event-triggered-mod',
                        execute({executionTrigger}) {
                            executionTriggers.push(executionTrigger);
                        },
                    }),
                ],
            });

            await engine.runSingleTick();
            await engine.runSingleTick();
            const event = new TestEngineEvent();
            engine.dispatch(event);
            await engine.runSingleTick();

            assert.deepEquals(executionTriggers, [
                {
                    events: [],
                    type: ModExecutionTriggerType.Event,
                },
                {
                    events: [
                        event,
                    ],
                    type: ModExecutionTriggerType.Event,
                },
            ]);
        });

        it('supports multiple event classes and forwards events to listeners', async () => {
            class FirstEvent extends Event {
                constructor() {
                    super('first-event');
                }
            }

            class SecondEvent extends Event {
                constructor() {
                    super('second-event');
                }
            }

            const executionTriggers: Readonly<ModExecutionTrigger>[] = [];
            const receivedEvents: Event[] = [];
            const mod = defineAnthaMod<AnyObject>({
                trigger: {
                    event: [
                        FirstEvent,
                        SecondEvent,
                    ],
                    executeImmediately: false,
                },
                modName: 'multiple-event-mod',
                execute({executionTrigger}) {
                    executionTriggers.push(executionTrigger);
                },
            });
            const engine = new AnthaEngine({
                mods: [
                    mod,
                ],
            });
            engine.listen(FirstEvent, (event) => {
                receivedEvents.push(event);
            });
            const firstEvent = new FirstEvent();
            const secondEvent = new SecondEvent();

            assert.strictEquals(engine.dispatch(firstEvent), 1);
            assert.strictEquals(engine.dispatch(secondEvent), 0);
            assert.deepEquals(receivedEvents, [
                firstEvent,
            ]);

            await engine.runSingleTick();

            assert.deepEquals(executionTriggers, [
                {
                    events: [
                        firstEvent,
                        secondEvent,
                    ],
                    type: ModExecutionTriggerType.Event,
                },
            ]);
        });

        it('runs regular and event-triggered mods in attachment order', async () => {
            class TestEngineEvent extends Event {
                constructor() {
                    super('test-engine-event');
                }
            }

            const executionOrder: string[] = [];
            const engine = new AnthaEngine({
                mods: [
                    defineAnthaMod<AnyObject>({
                        modName: 'regular-before',
                        execute() {
                            executionOrder.push('regular-before');
                        },
                    }),
                    defineAnthaMod<AnyObject>({
                        trigger: {
                            event: TestEngineEvent,
                            executeImmediately: false,
                        },
                        modName: 'event-before',
                        execute() {
                            executionOrder.push('event-before');
                        },
                    }),
                    defineAnthaMod<AnyObject>({
                        modName: 'regular-after',
                        execute() {
                            executionOrder.push('regular-after');
                        },
                    }),
                    defineAnthaMod<AnyObject>({
                        trigger: {
                            event: TestEngineEvent,
                            executeImmediately: false,
                        },
                        modName: 'event-after',
                        execute() {
                            executionOrder.push('event-after');
                        },
                    }),
                ],
            });

            engine.dispatch(new TestEngineEvent());
            await engine.runSingleTick();

            assert.deepEquals(executionOrder, [
                'regular-before',
                'event-before',
                'regular-after',
                'event-after',
            ]);
        });

        it('keeps an event-triggered template until its next event', async () => {
            class TestEngineEvent extends Event {
                constructor() {
                    super('test-engine-event');
                }
            }

            const mod = defineAnthaMod<AnyObject>({
                trigger: {
                    event: TestEngineEvent,
                    executeImmediately: false,
                },
                modName: 'event-template',
                execute() {
                    return html`
                        Event rendered.
                    `;
                },
            });
            const engine = new AnthaEngine({
                mods: [
                    mod,
                ],
            });

            engine.dispatch(new TestEngineEvent());
            await engine.runSingleTick();
            const eventTemplate = engine.currentTemplateMap.get(mod);

            await engine.runSingleTick();

            assert.isDefined(eventTemplate);
            assert.strictEquals(engine.currentTemplateMap.get(mod), eventTemplate);
        });

        it('defers events dispatched during execution until the next tick', async () => {
            class TestEngineEvent extends Event {
                constructor() {
                    super('test-engine-event');
                }
            }

            const executionStarted = new DeferredPromise<void>();
            const continueExecution = new DeferredPromise<void>();
            const eventBatches: Array<ReadonlyArray<Event>> = [];
            const mod = defineAnthaMod<AnyObject>({
                trigger: {
                    event: TestEngineEvent,
                    executeImmediately: false,
                },
                modName: 'async-event-mod',
                async execute({executionTrigger}) {
                    if (executionTrigger.type === ModExecutionTriggerType.Event) {
                        eventBatches.push(executionTrigger.events);
                        if (eventBatches.length === 1) {
                            executionStarted.resolve();
                            await continueExecution.promise;
                        }
                    }
                },
            });
            const engine = new AnthaEngine({
                mods: [
                    mod,
                ],
            });
            const firstEvent = new TestEngineEvent();

            engine.dispatch(firstEvent);
            const firstTick = engine.runSingleTick();
            await executionStarted.promise;

            const secondEvent = new TestEngineEvent();
            engine.dispatch(secondEvent);
            continueExecution.resolve();
            await firstTick;

            assert.deepEquals(
                [...eventBatches],
                [
                    [
                        firstEvent,
                    ],
                ],
            );

            await engine.runSingleTick();

            assert.deepEquals(eventBatches, [
                [
                    firstEvent,
                ],
                [
                    secondEvent,
                ],
            ]);
        });

        it('clears pending event triggers on reset', async () => {
            class TestEngineEvent extends Event {
                constructor() {
                    super('test-engine-event');
                }
            }

            const executionTriggers: Readonly<ModExecutionTrigger>[] = [];
            const mod = defineAnthaMod<AnyObject>({
                trigger: {
                    event: TestEngineEvent,
                    executeImmediately: false,
                },
                modName: 'reset-event-mod',
                execute({executionTrigger}) {
                    executionTriggers.push(executionTrigger);
                },
            });
            const engine = new AnthaEngine({
                mods: [
                    mod,
                ],
            });

            engine.dispatch(new TestEngineEvent());
            await engine.reset();
            await engine.runSingleTick();

            assert.deepEquals(executionTriggers, []);
        });
    });

    describe('shouldModExecute', () => {
        it('returns true when no trigger is set', () => {
            const engine = new AnthaEngine();
            const mod: AnthaMod = {
                modName: 'test',
                execute() {},
            };

            assert.isTrue(engine.shouldModExecute(mod, undefined));
        });

        it('returns true when no trigger is set, even with lastExecution', () => {
            const engine = new AnthaEngine();
            const mod: AnthaMod = {
                modName: 'test',
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
                trigger: {
                    executeImmediately: true,
                    tickCount: 10,
                },
                modName: 'test',
                execute() {},
            };

            assert.isTrue(engine.shouldModExecute(mod, undefined));
        });

        it('does not immediately execute when executeImmediately is false', () => {
            const engine = new AnthaEngine();
            const mod: AnthaMod = {
                trigger: {
                    executeImmediately: false,
                    tickCount: 10,
                },
                modName: 'test',
                execute() {},
            };

            assert.isFalse(engine.shouldModExecute(mod, undefined));
        });

        it('returns true when the tick count is reached', () => {
            const engine = new AnthaEngine();
            engine.currentTick = 10;
            const mod: AnthaMod = {
                trigger: {
                    executeImmediately: false,
                    tickCount: 5,
                },
                modName: 'test',
                execute() {},
            };
            const lastExecution: LastExecution = {
                tick: 5,
                timeMs: 0,
            };

            assert.isTrue(engine.shouldModExecute(mod, lastExecution));
        });

        it('returns false when the tick count is not yet reached', () => {
            const engine = new AnthaEngine();
            engine.currentTick = 3;
            const mod: AnthaMod = {
                trigger: {
                    executeImmediately: false,
                    tickCount: 5,
                },
                modName: 'test',
                execute() {},
            };
            const lastExecution: LastExecution = {
                tick: 1,
                timeMs: 0,
            };

            assert.isFalse(engine.shouldModExecute(mod, lastExecution));
        });

        it('handles durationMs using wall-clock time', () => {
            const engine = new AnthaEngine();
            engine.currentTick = 10;

            const mod: AnthaMod = {
                trigger: {
                    durationMs: 160,
                    executeImmediately: false,
                },
                modName: 'test',
                execute() {},
            };
            const lastExecution: LastExecution = {
                tick: 0,
                timeMs: performance.now() - 200,
            };

            assert.isTrue(engine.shouldModExecute(mod, lastExecution));
        });

        it('returns false when durationMs is not reached', () => {
            const engine = new AnthaEngine();
            engine.currentTick = 5;

            const mod: AnthaMod = {
                trigger: {
                    durationMs: 160,
                    executeImmediately: false,
                },
                modName: 'test',
                execute() {},
            };
            const lastExecution: LastExecution = {
                tick: 0,
                timeMs: performance.now(),
            };

            assert.isFalse(engine.shouldModExecute(mod, lastExecution));
        });

        it('returns true when tickCount is 0', () => {
            const engine = new AnthaEngine();
            const mod: AnthaMod = {
                trigger: {
                    executeImmediately: false,
                    tickCount: 0,
                },
                modName: 'test',
                execute() {},
            };
            const lastExecution: LastExecution = {
                tick: 0,
                timeMs: 0,
            };

            assert.isTrue(engine.shouldModExecute(mod, lastExecution));
        });

        it('returns true when durationMs is 0', () => {
            const engine = new AnthaEngine();
            const mod: AnthaMod = {
                trigger: {
                    durationMs: 0,
                    executeImmediately: false,
                },
                modName: 'test',
                execute() {},
            };
            const lastExecution: LastExecution = {
                tick: 0,
                timeMs: 0,
            };

            assert.isTrue(engine.shouldModExecute(mod, lastExecution));
        });

        it('respects tickCount after executeImmediately', () => {
            const engine = new AnthaEngine();
            engine.currentTick = 1;
            const mod: AnthaMod = {
                trigger: {
                    executeImmediately: true,
                    tickCount: 5,
                },
                modName: 'test',
                execute() {},
            };
            const lastExecution: LastExecution = {
                tick: 0,
                timeMs: 0,
            };

            assert.isFalse(engine.shouldModExecute(mod, lastExecution));
        });

        it('handles durationMs with no lastExecution', () => {
            const engine = new AnthaEngine();
            const mod: AnthaMod = {
                trigger: {
                    durationMs: 160,
                    executeImmediately: false,
                },
                modName: 'test',
                execute() {},
            };

            assert.isTrue(engine.shouldModExecute(mod, undefined));
        });
    });

    it('stops running when isLoopRunning is set to false', async () => {
        const engine = new AnthaEngine({
            mods: [
                {
                    modName: 'test',
                    execute() {},
                },
            ],
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

        assert.strictEquals(engine.currentTick, 2);
        assert.isLengthExactly(engine.currentTemplateArray, 0);
    });

    it('provides time since engine start on first execution', async () => {
        let capturedMs: number | undefined;
        const engine = new AnthaEngine({
            mods: [
                {
                    modName: 'test',
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
                    modName: 'test',
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
            trigger: {
                executeImmediately: true,
                tickCount: 100,
            },
            modName: 'test',
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

    it('does not record execution when mod returns SkipExecution', async () => {
        let executeCount = 0;
        const mod: AnthaMod = {
            trigger: {
                executeImmediately: true,
                tickCount: 100,
            },
            modName: 'test',
            execute() {
                executeCount++;
                return SkipExecution;
            },
        };
        const engine = new AnthaEngine({
            mods: [mod],
        });

        await engine.runSingleTick();
        assert.strictEquals(executeCount, 1);
        assert.isUndefined(engine.lastModExecution.get(mod));
    });

    it('retries executeImmediately on subsequent ticks after SkipExecution', async () => {
        let executeCount = 0;
        let ready = false;
        const mod: AnthaMod = {
            trigger: {
                executeImmediately: true,
                tickCount: 100,
            },
            modName: 'test',
            execute() {
                executeCount++;
                if (!ready) {
                    return SkipExecution;
                }
                return html`
                    <p>ready</p>
                `;
            },
        };
        const engine = new AnthaEngine({
            mods: [mod],
        });

        /** Tick 0: dependency not ready, returns SkipExecution. */
        await engine.runSingleTick();
        assert.strictEquals(executeCount, 1 as number);
        assert.isUndefined(engine.lastModExecution.get(mod));
        assert.isUndefined(engine.currentTemplateArray[0]);

        /** Tick 1: still not ready, retries because no lastExecution was recorded. */
        await engine.runSingleTick();
        assert.strictEquals(executeCount, 2 as number);
        assert.isUndefined(engine.lastModExecution.get(mod));

        /** Make the dependency available. */
        ready = true;

        /** Tick 2: now ready, executes successfully. */
        await engine.runSingleTick();
        assert.strictEquals(executeCount, 3 as number);
        assert.isDefined(engine.lastModExecution.get(mod));
        assert.isDefined(engine.currentTemplateArray[0]);

        /** Tick 3: trigger not reached (100 ticks), should not re-execute. */
        await engine.runSingleTick();
        assert.strictEquals(executeCount, 3);
    });

    it('preserves previous template when SkipExecution is returned after a successful run', async () => {
        let shouldSkip = false;
        const mod: AnthaMod = {
            modName: 'test',
            execute() {
                if (shouldSkip) {
                    return SkipExecution;
                }
                return html`
                    <p>content</p>
                `;
            },
        };
        const engine = new AnthaEngine({
            mods: [mod],
        });

        await engine.runSingleTick();
        assert.isDefined(engine.currentTemplateArray[0]);
        const firstTemplate = engine.currentTemplateArray[0];

        shouldSkip = true;
        await engine.runSingleTick();
        /** Template from prior successful execution is preserved. */
        assert.strictEquals(engine.currentTemplateArray[0], firstTemplate);
    });

    it('supports adding mods at runtime', async () => {
        const engine = new AnthaEngine();

        await engine.runSingleTick();
        assert.isLengthExactly(engine.currentTemplateArray, 0);

        engine.currentMods.push({
            modName: 'test',
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
                    modName: 'test',
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
