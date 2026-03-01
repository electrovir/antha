import {
    applyBrand,
    awaitedForEach,
    getOrSetFromMap,
    mergeDefinedProperties,
    type AnyObject,
    type Branded,
    type MaybePromise,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {createId} from '@paralleldrive/cuid2';
import {type HtmlInterpolation} from 'element-vir';
import {Observable} from 'observavir';
import {type RequireExactlyOne} from 'type-fest';

/**
 * A string type used for mod instances. In reality these are just strings, but this branded type
 * helps keep track of them. Under the hood, these are CUID2 ids.
 *
 * @category Internal
 */
export type ModInstanceId = Branded<string, 'antha-mod-instance-id'>;

/**
 * Parameters passed to the execute callback in {@link AnthaMod}.
 *
 * @category Internal
 */
export type ModExecuteParams<State extends AnyObject> = {
    state: Partial<State>;
    engine: AnthaEngine;
    ticksSinceLastExecute: number;
    msSinceLastExecute: DOMHighResTimeStamp;
    lastExecution: Readonly<LastExecution> | undefined;
    currentTick: number;
    hostElement: HTMLElement;
    modInstanceId: ModInstanceId;
} & ModOptions;

/**
 * Allowed output from the execute callback in {@link AnthaMod}.
 *
 * @category Internal
 */
export type ModExecuteResult = MaybePromise<HtmlInterpolation | void>;

/**
 * Possible options to use when defining {@link AnthaMod}.
 *
 * @category Internal
 */
export type ModOptions = {
    /**
     * The frequency at which this mod should execute.
     *
     * - `undefined`: execute on every tick
     * - `duration`: execute on each duration. This will be converted to a tick count based on what
     *   tick speed the engine is running at.
     * - `ticks`: execute every `ticks` ticks.
     *
     * @default undefined
     */
    frequency:
        | RequireExactlyOne<{
              durationMs: number;
              ticks: number;
          }>
        | undefined;
    /**
     * If `true`, this mod will execute immediately on game engine init instead of waiting for its
     * first tick to hit based on the given frequency configuration. If frequency is omitted or
     * `undefined`, this option is not necessary.
     *
     * @default false
     */
    executeImmediately: boolean;
};

/**
 * A mod for {@link AnthaEngine}. This is the core of getting anything done in the engine, everything
 * runs in a mod.
 *
 * @category Mod
 * @example
 *
 * ```ts
 * import {AnthaMod, html} from 'antha';
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
export type AnthaMod<State extends AnyObject = AnyObject> = {
    /**
     * The execute callback. This is where the mod's functionality lives. This will be called in
     * each tick based on the provided frequency. Any non-nullish output will be rendered as HTML to
     * the DOM.
     */
    execute: (this: void, params: Readonly<ModExecuteParams<NoInfer<State>>>) => ModExecuteResult;
} & PartialWithUndefined<ModOptions>;

/**
 * A helper for defining {@link AnthaMod} inline. This is _not_ required in order to define an
 * {@link AnthaMod}. It simply helps with type inference.
 *
 * @category Mod
 * @example
 *
 * ```ts
 * import {defineAnthaMod, html} from 'antha';
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
export type AnthaEngineOptions = {
    /** The minimum milliseconds between each tick. */
    tickDurationMs: number;
};

/**
 * Default values for {@link AnthaEngineOptions}.
 *
 * @category Internal
 */
export const defaultAnthaEngineOptions: AnthaEngineOptions = {
    tickDurationMs: 16,
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
export type AnthaEngineInit = PartialWithUndefined<{
    /** The Antha mods to start the Antha engine with. */
    mods: AnthaMod[];
    /**
     * Various options to start the Antha engine with.
     *
     * @default defaultAnthaEngineOptions
     */
    options: PartialWithUndefined<AnthaEngineOptions>;
    /**
     * The host element to start the Antha engine with.
     *
     * @default globalThis.document.documentElement
     */
    hostElement: HTMLElement;
}>;

/**
 * The Antha Engine. This keeps track of when to execute each mod, the mod's template outputs, and
 * the state passed to and mutated by each mod.
 *
 * @category Engine
 * @example
 *
 * ```ts
 * import {AnthaEngine, defineAnthaMod, html} from 'antha';
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
export class AnthaEngine {
    constructor(init?: AnthaEngineInit | undefined) {
        this.options = mergeDefinedProperties(defaultAnthaEngineOptions, init?.options);
        this.currentMods = init?.mods || [];
        this.hostElement = init?.hostElement || globalThis.document.documentElement;
    }

    /** The element that this engine considers itself to be "hosted" in. */
    public hostElement: HTMLElement;
    /**
     * Hook into this observable for updating event-based code, like UI elements. This is used
     * directly in AnthaUi to update the UI.
     */
    public readonly observable = new Observable<HtmlInterpolation[]>({
        defaultValue: [],
        equalityCheck: undefined,
    });
    /** The current engine options. This can be modified at any time. */
    public readonly options: AnthaEngineOptions;
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
    public readonly state: AnyObject = {};
    /** When the engine started running its loop. */
    public engineStartTime: DOMHighResTimeStamp = performance.now();
    /**
     * Indicates whether the loop is running or not. This can be freely modified at any time to stop
     * the next tick.
     */
    public isLoopRunning = false;

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

    /** Reset the engine back to its initial state. */
    public reset() {
        this.stopLoop();

        this.currentTick = 0;
        this.nextTickTarget = 0;

        /** Clear all per-mod tracking for current mods. */
        this.currentMods.forEach((mod) => {
            this.lastModExecution.delete(mod);
            this.currentTemplateMap.delete(mod);
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
        this.nextTickTarget = this.engineStartTime;
        this.isLoopRunning = true;

        void this.runTickInLoop();
        return true;
    }

    /** When the next tick should execute. */
    protected nextTickTarget: DOMHighResTimeStamp = 0;

    /** Execute ticks in a loop. */
    protected async runTickInLoop() {
        if (!this.isLoopRunning) {
            return;
        }

        await this.runSingleTick();

        this.nextTickTarget += this.options.tickDurationMs;

        const now = performance.now();

        if (this.nextTickTarget < now - this.options.tickDurationMs) {
            /** Prevent burst catch-up after the browser throttles the engine in the background. */
            this.nextTickTarget = now;
        }

        const nextDelay = Math.max(0, this.nextTickTarget - now);

        setTimeout(() => this.runTickInLoop(), nextDelay);
    }

    /**
     * Run a single tick. This happens automatically in a loop if `startLoop` is called or
     * `isLoopRunning` is set to `true`.
     */
    public async runSingleTick(): Promise<void> {
        /** Clear the array as we're about to populate it. */
        this.currentTemplateArray.length = 0;
        const executionStart = performance.now();

        await awaitedForEach(this.currentMods, async (mod, index) => {
            const lastExecution = this.lastModExecution.get(mod);
            const shouldExecute = this.shouldModExecute(mod, lastExecution);

            const modTemplate = shouldExecute
                ? (await mod.execute({
                      engine: this,
                      modInstanceId: getOrSetFromMap(this.modInstanceIdMap, mod, () =>
                          applyBrand<ModInstanceId>(createId()),
                      ),
                      currentTick: this.currentTick,
                      state: this.state,
                      ticksSinceLastExecute: this.currentTick - (lastExecution?.tick ?? 0),
                      executeImmediately: mod.executeImmediately || false,
                      frequency: mod.frequency || undefined,
                      lastExecution,
                      hostElement: this.hostElement,
                      msSinceLastExecute:
                          executionStart - (lastExecution?.timeMs ?? this.engineStartTime),
                  })) || undefined
                : this.currentTemplateMap.get(mod);

            this.currentTemplateArray[index] = modTemplate;

            if (shouldExecute) {
                this.currentTemplateMap.set(mod, modTemplate);
                this.lastModExecution.set(mod, {
                    tick: this.currentTick,
                    timeMs: executionStart,
                });
            }
        });

        this.currentTick++;
        this.observable.setValue(this.currentTemplateArray);
    }

    /** Used to determine if a mod should execute right now or not. */
    public shouldModExecute(
        mod: Readonly<AnthaMod>,
        lastExecution: Readonly<LastExecution> | undefined,
    ): boolean {
        if (!mod.frequency || (!lastExecution && mod.executeImmediately)) {
            return true;
        }

        const ticksBetweenExecutions =
            mod.frequency.ticks ?? mod.frequency.durationMs / this.options.tickDurationMs;

        if (!ticksBetweenExecutions) {
            return true;
        }

        const ticksSinceLastExecution = this.currentTick - (lastExecution?.tick || 0);

        return ticksSinceLastExecution >= ticksBetweenExecutions;
    }
}
