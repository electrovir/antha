import {
    awaitedForEach,
    mergeDefinedProperties,
    type AnyObject,
    type MaybePromise,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {type HtmlInterpolation} from 'element-vir';
import {Observable} from 'observavir';
import {type RequireExactlyOne} from 'type-fest';

export type ModExecuteParams<State extends AnyObject> = {
    state: State;
    engine: AnthaEngine;
    ticksSinceLastExecute: number;
    msSinceLastExecute: DOMHighResTimeStamp;
    currentTick: number;
} & ModOptions;

export type ModExecuteResult = MaybePromise<HtmlInterpolation | void>;

export type ModOptions = {
    /**
     * The frequency at which this mode should execute.
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

export type AnthaMod<State extends AnyObject = any> = {
    /**
     * The execute callback. This is where the mod's functionality lives. This will be called in
     * each tick based on the provided frequency. Any non-nullish output will be rendered as HTML to
     * the DOM.
     */
    execute: (this: void, params: Readonly<ModExecuteParams<State>>) => ModExecuteResult;
} & PartialWithUndefined<ModOptions>;

export type AnthaEngineConfig = {
    /** The minimum milliseconds between each tick. */
    tickDurationMs: number;
};

export type LastExecution = {
    tick: number;
    timeMs: DOMHighResTimeStamp;
};

export const defaultAnthaEngineConfig: AnthaEngineConfig = {
    tickDurationMs: 16,
};

export class AnthaEngine {
    constructor(
        init?:
            | PartialWithUndefined<{
                  mods: AnthaMod[];
                  config: PartialWithUndefined<AnthaEngineConfig>;
              }>
            | undefined,
    ) {
        this.config = mergeDefinedProperties(defaultAnthaEngineConfig, init?.config);
        this.currentMods = init?.mods || [];
    }

    public readonly observable = new Observable<HtmlInterpolation[]>({
        defaultValue: [],
        equalityCheck: undefined,
    });
    public readonly config: AnthaEngineConfig;
    public readonly currentMods: AnthaMod[];
    /**
     * Use to store each template by its mod so that mod-to-template tracking remains stable even if
     * mods are inserted, removed, or moved around.
     */
    public readonly currentTemplateMap = new WeakMap<AnthaMod, HtmlInterpolation>();
    /** The current array of templates. This array is mutated and passed to the UI. */
    public readonly currentTemplateArray: HtmlInterpolation[] = [];
    public readonly lastModExecution = new WeakMap<AnthaMod, Readonly<LastExecution>>();
    public currentTick = 0;
    public readonly state: AnyObject = {};
    public engineStartTime: DOMHighResTimeStamp = performance.now();
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

    protected nextTickTarget: DOMHighResTimeStamp = 0;

    protected async runTickInLoop() {
        if (!this.isLoopRunning) {
            return;
        }

        await this.runSingleTick();

        this.nextTickTarget += this.config.tickDurationMs;
        const nextDelay = Math.max(0, this.nextTickTarget - performance.now());

        setTimeout(() => this.runTickInLoop(), nextDelay);
    }

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
                      currentTick: this.currentTick,
                      state: this.state,
                      ticksSinceLastExecute: this.currentTick - (lastExecution?.tick ?? 0),
                      executeImmediately: mod.executeImmediately || false,
                      frequency: mod.frequency || undefined,
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

    public shouldModExecute(
        mod: Readonly<AnthaMod>,
        lastExecution: Readonly<LastExecution> | undefined,
    ): boolean {
        if (!mod.frequency || (!lastExecution && mod.executeImmediately)) {
            return true;
        }

        const ticksBetweenExecutions =
            mod.frequency.ticks ?? mod.frequency.durationMs / this.config.tickDurationMs;

        if (!ticksBetweenExecutions) {
            return true;
        }

        const ticksSinceLastExecution = this.currentTick - (lastExecution?.tick || 0);

        return ticksSinceLastExecution >= ticksBetweenExecutions;
    }
}
