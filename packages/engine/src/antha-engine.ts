import {waitUntil} from '@augment-vir/assert';
import {
    applyBrand,
    awaitedForEach,
    ensureArray,
    getOrSetFromMap,
    makeWritable,
    mergeDefinedProperties,
    type AnyObject,
    type ArrayElement,
    type Branded,
    type Constructor,
    type MaybePromise,
    type PartialWithUndefined,
    type RequiredAndNotNull,
    type RequireExactlyOne,
    type UnionToIntersection,
    type UnknownObject,
} from '@augment-vir/common';
import {createId} from '@paralleldrive/cuid2';
import {type Duration, type DurationUnit} from 'date-vir';
import {css, html, type HtmlInterpolation} from 'element-vir';
import {Observable} from 'observavir';
import {GenericListenTarget} from 'typed-event-target';
import {AnthaUi} from './antha-ui.element.js';
import {type AnthaLogger} from './logger/antha-logger.js';
import {browserAnthaLogger} from './logger/browser-antha-logger.js';

/**
 * A string type used for mod instances. In reality these are just strings, but this branded type
 * helps keep track of them. Under the hood, these are CUID2 ids.
 *
 * @category Internal
 */
export type ModInstanceId = Branded<string, 'antha-mod-instance-id'>;

/**
 * A timestamp measured from the start of an {@link AnthaEngine}. Always measured in milliseconds.
 *
 * @category Internal
 */
export type EngineTime = Branded<number, 'antha-engine-time'>;

/**
 * Brands a millisecond time as {@link EngineTime}.
 *
 * @category Util
 */
export function createEngineTime({
    milliseconds,
}: Readonly<Duration<DurationUnit.Milliseconds>>): EngineTime {
    return applyBrand<EngineTime>(milliseconds);
}

/**
 * Parameters passed to the execute callback in {@link AnthaMod}.
 *
 * @category Internal
 */
export type ModExecuteParams<State extends AnyObject = UnknownObject> = {
    state: Partial<State>;
    engine: AnthaEngine;
    executionTrigger: Readonly<ModExecutionTrigger>;
    ticksSinceLastExecute: number;
    msSinceLastExecute: DOMHighResTimeStamp;
    lastExecution: Readonly<LastExecution> | undefined;
    currentTick: number;
    hostElement: HTMLElement;
    modInstanceId: ModInstanceId;
} & ModOptions;

/**
 * Parameters passed to the cleanup callback in {@link AnthaMod}.
 *
 * @category Internal
 */
export type ModCleanupParams<State extends AnyObject> = {
    state: Partial<State>;
    engine: AnthaEngine;
    hostElement: HTMLElement;
    modInstanceId: ModInstanceId;
} & ModOptions;

/**
 * The reason an Antha mod is currently executing.
 *
 * @category Internal
 */
export enum ModExecutionTriggerType {
    Tick = 'tick',
    Event = 'event',
}

/**
 * Identifies what caused the current mod execution.
 *
 * @category Internal
 */
export type ModExecutionTrigger =
    | {
          type: ModExecutionTriggerType.Tick;
          events?: never;
      }
    | {
          type: ModExecutionTriggerType.Event;
          events: ReadonlyArray<Event>;
      };

/**
 * Return this from a mod's `execute` callback to instruct {@link AnthaEngine} that the mod's current
 * execution should not count toward the mod's trigger schedule. This is useful when a mod needs a
 * dependency (such as a canvas or external resource) that isn't ready yet so that the engine will
 * keep retrying on subsequent ticks, even if the mod has a low execution frequency.
 *
 * @category Mod
 */
export const SkipExecution: unique symbol = Symbol.for('antha-engine-mode-skip-execution');

/**
 * Type for {@link SkipExecution}.
 *
 * @category Mod
 */
export type SkipExecution = typeof SkipExecution;

/**
 * Allowed output from the execute callback in {@link AnthaMod}.
 *
 * @category Internal
 */
export type ModExecuteResult = MaybePromise<HtmlInterpolation | void | SkipExecution>;

/**
 * Possible trigger options for a {@link AnthaMod}.
 *
 * @category Internal
 */
export type ModTrigger = {
    /**
     * If `true`, this mod executes on the engine's first tick instead of waiting for its first
     * eligible scheduled tick or event.
     *
     * @default false
     */
    executeImmediately: boolean;
} & RequireExactlyOne<{
    /**
     * Execute with a period of the given milliseconds. This will be converted to a tick count based
     * on what tick speed the engine is running at.
     */
    durationMs: number;
    /** Execute every `tickCount` ticks. */
    tickCount: number;
    /**
     * When set, this mod executes only when the engine dispatches an instance of one of these event
     * classes.
     */
    event: Constructor<Event> | ReadonlyArray<Constructor<Event>>;
}>;

/**
 * Possible options to use when defining {@link AnthaMod}.
 *
 * @category Internal
 */
export type ModOptions = PartialWithUndefined<{
    trigger: ModTrigger;
}>;

/**
 * A mod for {@link AnthaEngine}. This is the core of getting anything done in the engine, everything
 * runs in a mod.
 *
 * @category Mod
 * @example
 *
 * ```ts
 * import {AnthaMod} from '@antha/engine';
 * import {html} from 'element-vir';
 *
 * const myMod: AnthaMod<{count: number}> = {
 *     execute({state}) {
 *         state.count = (state.count || 0) + 1;
 *         return html`
 *             <span class="counter">${String(state.count)}</span>
 *         `;
 *     },
 * };
 * ```
 */
export type AnthaMod<State extends AnyObject = any> = {
    /**
     * Not used by the Antha engine, just a nice string to help debugging so you can which mod is
     * which.
     */
    modName: string;
    /**
     * The execute callback. This is where the mod's functionality lives. This will be called in
     * each tick based on the configured trigger. Any non-nullish output will be rendered as HTML to
     * the DOM.
     */
    execute: (this: void, params: Readonly<ModExecuteParams<NoInfer<State>>>) => ModExecuteResult;
} & ModOptions &
    PartialWithUndefined<{
        initState: Partial<NoInfer<State>>;
        /**
         * Use this to cleanup resources that the mod has created. This is called when the engine is
         * reset.
         */
        cleanup: (
            this: void,
            params: Readonly<ModCleanupParams<NoInfer<State>>>,
        ) => MaybePromise<void>;
    }>;

/**
 * Extracts state type from a mod.
 *
 * @category Internal
 */
export type AnthaModState<Mod extends AnthaMod> = Mod extends AnthaMod<infer State> ? State : never;

/**
 * Combines the state requirements of an array of mods into the complete engine state type.
 *
 * @category Internal
 */
export type AnthaModsState<Mods extends ReadonlyArray<AnthaMod>> = UnionToIntersection<
    AnthaModState<ArrayElement<Mods>>
>;

/**
 * A helper for defining {@link AnthaMod} inline. This is _not_ required in order to define an
 * {@link AnthaMod}. It simply helps with type inference.
 *
 * @category Mod
 * @example
 *
 * ```ts
 * import {defineAnthaMod} from '@antha/engine';
 * import {html} from 'element-vir';
 *
 * defineAnthaMod<{count: number}>({
 *     execute({state}) {
 *         state.count = (state.count || 0) + 1;
 *         return html`
 *             <span class="counter">${String(state.count)}</span>
 *         `;
 *     },
 * });
 * ```
 */
export function defineAnthaMod<State extends AnyObject = never>(
    mod: AnthaMod<NoInfer<State>>,
): AnthaMod<NoInfer<State>> {
    return mod;
}

/**
 * Possible options to use when constructing {@link AnthaEngine}. Defaults are contained in
 * {@link defaultAnthaEngineOptions}.
 *
 * @category Engine
 */
export type AnthaEngineOptions = PartialWithUndefined<{
    /**
     * A custom logger to handle mod and engine logs. By default, this merely logs to the browser
     * console.
     */
    logger: AnthaLogger;
}>;

/**
 * Default values for {@link AnthaEngineOptions}.
 *
 * @category Internal
 */
export const defaultAnthaEngineOptions: RequiredAndNotNull<AnthaEngineOptions> = {
    logger: browserAnthaLogger,
};

/**
 * The last known execution for a given mod. Passed to each mod's execute callback via
 * {@link ModExecuteParams} and used inside {@link AnthaEngine} to keep track of when a mod should run
 * again.
 *
 * @category Internal
 */
export type LastExecution = {
    tick: number;
    timeMs: DOMHighResTimeStamp;
};

/**
 * Init options for the constructor of {@link AnthaEngine}.
 *
 * @category Internal
 */
export type AnthaEngineInit<State extends AnyObject = AnyObject> = PartialWithUndefined<{
    /** The Antha mods to start the Antha engine with. */
    mods: AnthaMod[];
    /**
     * Various options to start the Antha engine with.
     *
     * @default defaultAnthaEngineOptions
     */
    engineOptions: Readonly<AnthaEngineOptions>;
    /**
     * The host element to start the Antha engine with.
     *
     * @default globalThis.document.documentElement
     */
    hostElement: HTMLElement;
    initState: Partial<State>;
}>;

/**
 * The Antha Engine. This keeps track of when to execute each mod, the mod's template outputs, and
 * the state passed to and mutated by each mod.
 *
 * @category Engine
 * @example
 *
 * ```ts
 * import {AnthaEngine, defineAnthaMod} from '@antha/engine';
 * import {html} from 'element-vir';
 *
 * new AnthaEngine({
 *     mods: [
 *         defineAnthaMod<{count: number}>({
 *             execute({state}) {
 *                 state.count = (state.count || 0) + 1;
 *                 return html`
 *                     <span class="counter">${String(state.count)}</span>
 *                 `;
 *             },
 *         }),
 *     ],
 * });
 * ```
 */
export class AnthaEngine<State extends AnyObject = AnyObject> extends GenericListenTarget {
    constructor(init?: AnthaEngineInit<State> | undefined) {
        super();
        this.state = init?.initState || {};
        this.options = mergeDefinedProperties(defaultAnthaEngineOptions, init?.engineOptions);
        this.currentMods = init?.mods || [];
        this.hostElement = init?.hostElement;
        this.log = this.options.logger;
    }

    /**
     * Send a log through the engine. This will use the user's provided logger or default to browser
     * logs.
     */
    public log: AnthaLogger;

    /** Get this.hostElement but if one doesn't exist yet, create one. */
    protected getEnsuredHostElement(): HTMLElement {
        if (!this.hostElement) {
            const instance = globalThis.document.createElement(
                AnthaUi.tagName,
            ) as typeof AnthaUi.InstanceType;
            this.hostElement = instance;
            instance.assignInputs({
                engine: this,
                options: {
                    disableConnectStart: true,
                    disableDisconnectReset: true,
                },
            });
            globalThis.document.body.append(instance);
        }

        return this.hostElement;
    }

    /** The element that this engine considers itself to be "hosted" in. */
    public hostElement: HTMLElement | undefined;
    /**
     * Hook into this observable for updating event-based code, like UI elements. This is used
     * directly in AnthaUi to update the UI.
     */
    public readonly observable = new Observable<HtmlInterpolation[]>({
        defaultValue: [],
        equalityCheck: undefined,
    });
    /** The current engine options. This can be modified at any time. */
    public readonly options: RequiredAndNotNull<AnthaEngineOptions>;
    /** The current mods to execute. This can be modified at any time. */
    public readonly currentMods: AnthaMod[];
    /**
     * Used to store each template by its mod so that mod-to-template tracking remains stable even
     * if mods are inserted, removed, or moved around in the `currentMods` array.
     */
    public readonly currentTemplateMap = new WeakMap<AnthaMod, HtmlInterpolation>();
    public readonly modInstanceIdMap = new WeakMap<AnthaMod, ModInstanceId>();
    /**
     * The current array of templates. This array is mutated and passed to the UI via the
     * `observable`.
     */
    public readonly currentTemplateArray: HtmlInterpolation[] = [];
    /**
     * Used to store when each mod was last executed in order to know when the next execution should
     * be.
     */
    public readonly lastModExecution = new WeakMap<AnthaMod, Readonly<LastExecution>>();
    /** The engine's current tick number. This is incremented after each tick is finished executing. */
    public currentTick = 0;
    /**
     * The engine's current state. This is intended to be mutated by mods, but it can also be
     * modified at any time externally.
     */
    public readonly state: Partial<State>;
    /** Total milliseconds elapsed since the engine started. Updated each tick. */
    public engineTime: EngineTime = createEngineTime({
        milliseconds: 0,
    });
    /** When the engine started running its loop. */
    public engineStartTime: DOMHighResTimeStamp = performance.now();
    /**
     * Indicates whether the loop is running or not. This can be freely modified at any time to
     * start or stop the next tick.
     */
    public isLoopRunning = false;
    /** Indicates whether a tick is currently running or not. This should not be modified externally. */
    public readonly isTickRunning = false as boolean;
    /** Events waiting for their triggered mod's next normal tick. */
    protected eventTriggeredMods = new Map<AnthaMod, Event[]>();

    /**
     * Stop the tick loop. If the loop already isn't running, no changes will be made.
     *
     * @returns Whether the loop was stopped or not.
     */
    public stopLoop(): boolean {
        if (this.isLoopRunning) {
            this.isLoopRunning = false;
            return true;
        } else {
            return false;
        }
    }

    /** Reset the engine back to its initial state and run all mod cleanup callbacks. */
    public async reset() {
        this.stopLoop();
        await waitUntil.isFalse(() => this.isTickRunning);

        this.eventTriggeredMods = new Map();
        this.currentTick = 0;

        /** Clear all per-mod tracking for current mods. */
        await awaitedForEach(this.currentMods, async (mod) => {
            this.lastModExecution.delete(mod);
            this.currentTemplateMap.delete(mod);
            await mod.cleanup?.({
                engine: this,
                hostElement: this.getEnsuredHostElement(),
                modInstanceId: getOrSetFromMap(this.modInstanceIdMap, mod, () => {
                    return applyBrand<ModInstanceId>(createId());
                }),
                state: this.state,
                trigger: mod.trigger,
            });
        });

        this.currentTemplateArray.length = 0;

        /** Clear all state properties. */
        Object.keys(this.state).forEach((key) => {
            delete this.state[key];
        });

        this.observable.setValue([]);
    }

    /**
     * Start the tick loop. If the loop is already running, no changes will be made.
     *
     * @returns Whether the loop was started or not.
     */
    public startLoop(): boolean {
        if (this.isLoopRunning) {
            return false;
        }

        this.engineStartTime = performance.now();
        this.isLoopRunning = true;

        void this.runTickInLoop();
        return true;
    }

    /** Execute a single tick on each render frame. */
    protected async runTickInLoop() {
        if (!this.isLoopRunning) {
            return;
        }

        await this.runSingleTick();

        requestAnimationFrame(() => this.runTickInLoop());
    }

    /**
     * Run a single tick. This happens automatically in a loop if `startLoop` is called or
     * `isLoopRunning` is set to `true`.
     */
    public async runSingleTick(): Promise<void> {
        makeWritable(this).isTickRunning = true;

        try {
            const eventTriggeredMods = this.eventTriggeredMods;
            /** Construct a new map so that the new triggers can populate fresh. */
            this.eventTriggeredMods = new Map();

            /** Clear the array as we're about to populate it. */
            this.currentTemplateArray.length = 0;
            const executionStart = performance.now();
            this.engineTime = createEngineTime({
                milliseconds: executionStart - this.engineStartTime,
            });

            /**
             * Use a plain `for` loop instead of `awaitedForEach` so that synchronous mods execute
             * without microtask boundaries between them. Only yield when a mod actually returns a
             * `Promise`.
             */
            for (let index = 0; index < this.currentMods.length; index++) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const mod = this.currentMods[index]!;
                const lastExecution = this.lastModExecution.get(mod);
                const shouldExecute = this.shouldModExecute(mod, lastExecution, eventTriggeredMods);
                const events = mod.trigger?.event ? eventTriggeredMods.get(mod) || [] : undefined;
                const executionTrigger: ModExecutionTrigger = events
                    ? {
                          type: ModExecutionTriggerType.Event,
                          events,
                      }
                    : {
                          type: ModExecutionTriggerType.Tick,
                      };

                let executeResult: HtmlInterpolation | void | SkipExecution | undefined;

                if (shouldExecute) {
                    if (!lastExecution && mod.initState) {
                        Object.assign(this.state, mod.initState);
                    }

                    const rawResult = mod.execute({
                        engine: this,
                        modInstanceId: getOrSetFromMap(this.modInstanceIdMap, mod, () => {
                            return applyBrand<ModInstanceId>(createId());
                        }),
                        currentTick: this.currentTick,
                        state: this.state,
                        executionTrigger,
                        ticksSinceLastExecute: this.currentTick - (lastExecution?.tick ?? 0),
                        trigger: mod.trigger,
                        lastExecution,
                        hostElement: this.getEnsuredHostElement(),
                        msSinceLastExecute:
                            executionStart - (lastExecution?.timeMs ?? this.engineStartTime),
                    });

                    executeResult = rawResult instanceof Promise ? await rawResult : rawResult;
                }

                const skipped = executeResult === SkipExecution;

                const rawTemplate: HtmlInterpolation =
                    shouldExecute && !skipped
                        ? (executeResult as Exclude<typeof executeResult, SkipExecution>) ||
                          undefined
                        : undefined;

                const modTemplate: HtmlInterpolation =
                    shouldExecute && !skipped
                        ? rawTemplate
                            ? html`
                                  <div
                                      data-antha-mod=${mod.modName}
                                      style=${css`
                                          display: contents;
                                      `}
                                  >
                                      ${rawTemplate}
                                  </div>
                              `
                            : undefined
                        : this.currentTemplateMap.get(mod);

                this.currentTemplateArray[index] = modTemplate;

                if (shouldExecute && !skipped) {
                    this.currentTemplateMap.set(mod, modTemplate);
                    this.lastModExecution.set(mod, {
                        tick: this.currentTick,
                        timeMs: executionStart,
                    });
                }
            }

            this.observable.setValue(this.currentTemplateArray);
            this.currentTick++;
        } finally {
            makeWritable(this).isTickRunning = false;
        }
    }

    /**
     * Dispatch an event through the engine.
     *
     * @returns The number of listeners that received the event.
     */
    public override dispatch(event: Event) {
        this.currentMods.forEach((mod) => {
            if (
                mod.trigger?.event &&
                ensureArray(mod.trigger.event).some((eventTrigger) => {
                    return event instanceof eventTrigger;
                })
            ) {
                getOrSetFromMap(this.eventTriggeredMods, mod, () => []).push(event);
            }
        });
        return super.dispatch(event);
    }

    /** Used to determine if a mod should execute right now or not. */
    public shouldModExecute(
        mod: Readonly<AnthaMod>,
        lastExecution: Readonly<LastExecution> | undefined,
        eventTriggeredMods?: ReadonlyMap<AnthaMod, ReadonlyArray<Event>> | undefined,
    ): boolean {
        if ((!lastExecution && mod.trigger?.executeImmediately) || !mod.trigger) {
            return true;
        } else if (mod.trigger.event) {
            return (
                !!eventTriggeredMods?.has(mod) || (!lastExecution && mod.trigger.executeImmediately)
            );
        } else if (mod.trigger.tickCount) {
            const ticksSinceLastExecution = this.currentTick - (lastExecution?.tick || 0);

            return ticksSinceLastExecution >= mod.trigger.tickCount;
        } else if (mod.trigger.durationMs) {
            const msSinceLastExecution = performance.now() - (lastExecution?.timeMs || 0);

            return msSinceLastExecution >= mod.trigger.durationMs;
        } else {
            return true;
        }
    }
}
