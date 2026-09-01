import {
    createEngineTime,
    defineAnthaMod,
    type AnthaEngine,
    type AnthaMod,
    type EngineTime,
} from '@antha/engine';
import {check} from '@augment-vir/assert';
import {
    ensureError,
    ensureErrorAndPrependMessage,
    log,
    type MaybePromise,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {convertDuration, type AnyDuration} from 'date-vir';
import {LocalDbClient} from 'local-db-client';
import {type Shape} from 'object-shape-tester';
import {defineAsset, type Asset} from './asset-loader.js';

/**
 * A fresh save state factory or a reusable state value that will be copied before use.
 *
 * @category Internal
 */
export type SaveGameFallbackState<SaveState> =
    | Readonly<SaveState>
    | (() => MaybePromise<SaveState>);

/**
 * The result of loading a save game.
 *
 * @category Internal
 */
export type SaveGameLoadResult<SaveState> = {
    loadError: Error | undefined;
    saveState: SaveState;
};

/**
 * Configuration for {@link createSaveGameSuite}.
 *
 * @category Internal
 */
export type SaveGameSuiteOptions<RuntimeGameState, StoredSaveStateShape extends Shape> = {
    /** Validates the state persisted by this suite. */
    storedSaveStateShape: StoredSaveStateShape;
    /** Used when saved data does not exist yet. */
    fallbackState: SaveGameFallbackState<RuntimeGameState>;
} & PartialWithUndefined<{
    /**
     * Converts saved game state into runtime game state. When omitted or `undefined`, the saved
     * state is returned directly with no transform.
     */
    deserialize: (
        this: void,
        storedSaveState: StoredSaveStateShape['runtimeType'],
    ) => MaybePromise<RuntimeGameState>;
    /**
     * Converts runtime game state into saved game state. When omitted or `undefined`, the runtime
     * save state is saved directly with no transform.
     */
    serialize: (
        this: void,
        saveState: RuntimeGameState,
    ) => MaybePromise<StoredSaveStateShape['runtimeType']>;
}>;

/**
 * State for `autosaveMod` from {@link SaveGameSuite}.
 *
 * @category Internal
 */
export type AutosaveModState<RuntimeSaveState> = {
    /** Put everything in here that you want to save. */
    saveState: RuntimeSaveState;
    /**
     * The duration between auto saves. If you explicitly set this to `undefined`, auto saving will
     * be disabled.
     *
     * @default {seconds: 5}
     */
    autosaveInterval: AnyDuration;
    savingStaredAt: EngineTime | undefined;
    lastAutosaveFailure:
        | {
              error: Error;
              at: EngineTime;
              duration: EngineTime;
          }
        | undefined;
    lastAutosaveSuccess: {duration: EngineTime; at: EngineTime} | undefined;
};

export type PersistSaveStateParams<RuntimeSaveState> = {
    engine: AnthaEngine;
    saveState: RuntimeSaveState;
};

/**
 * The matching asset loader and autosave-mod factory created by {@link createSaveGameSuite}.
 *
 * @category Internal
 */
export type SaveGameSuite<RuntimeSaveState> = {
    anthaAutosaveMod: AnthaMod<AutosaveModState<RuntimeSaveState>>;
    loadSaveDataAsset: Asset<SaveGameLoadResult<RuntimeSaveState>>;
    persistSaveState: (
        this: void,
        params: Readonly<PersistSaveStateParams<RuntimeSaveState>>,
    ) => Promise<boolean>;
};

/**
 * Creates a matching asset loader and autosave mod around LocalDbClient. Both use the same fallback
 * state when no saved data is available.
 *
 * @category Pre-Built Mods
 */
export function createSaveGameSuite<RuntimeSaveState, StoredSaveStateShape extends Shape>({
    fallbackState: userInputFallbackState,
    storedSaveStateShape,
    deserialize,
    serialize,
}: Readonly<
    SaveGameSuiteOptions<RuntimeSaveState, StoredSaveStateShape>
>): SaveGameSuite<RuntimeSaveState> {
    const localDbClientShapes = {
        saveState: {
            shape: storedSaveStateShape,
        },
    };

    let cachedLocalDbClient: LocalDbClient<typeof localDbClientShapes> | undefined;

    async function getLoadDbClient(): Promise<LocalDbClient<typeof localDbClientShapes>> {
        if (!cachedLocalDbClient) {
            cachedLocalDbClient = await LocalDbClient.createClient(localDbClientShapes, {
                storeName: 'Game Save',
            });
        }
        return cachedLocalDbClient;
    }

    async function persistSaveState({
        engine,
        saveState,
    }: Readonly<PersistSaveStateParams<RuntimeSaveState>>): Promise<boolean> {
        try {
            const serialized = serialize ? await serialize(saveState) : saveState;
            await (await getLoadDbClient()).set.saveState(serialized);
            return true;
        } catch (error) {
            engine.log.error(ensureErrorAndPrependMessage(error, 'Failed to game save data.'));
            return false;
        }
    }

    const loadSaveDataAsset = defineAsset<SaveGameLoadResult<RuntimeSaveState>>({
        assetName: 'Save Data',
        maxProgress: 1,
        async load({incrementProgressCallback}) {
            try {
                const storedSaveState = (await (await getLoadDbClient()).loadAllValues()).saveState;

                incrementProgressCallback();

                return {
                    value: {
                        loadError: undefined,
                        saveState: storedSaveState
                            ? deserialize
                                ? await deserialize(storedSaveState)
                                : storedSaveState
                            : check.isFunction(userInputFallbackState)
                              ? await userInputFallbackState()
                              : userInputFallbackState,
                    },
                };
            } catch (error) {
                log.error(ensureErrorAndPrependMessage(error, 'Failed to load game save data.'));

                throw error;
            }
        },
    });

    const anthaAutosaveMod = defineAnthaMod<AutosaveModState<RuntimeSaveState>>({
        executeImmediately: true,
        modName: 'Antha Autosave',
        async cleanup({engine, state}) {
            if (!('saveState' in state) || state.savingStaredAt) {
                return;
            }

            await persistSaveState({
                engine,
                saveState: state.saveState,
            });
        },
        execute({engine, state}) {
            if (!('saveState' in state) || state.savingStaredAt) {
                return;
            }

            const startEngineTime = engine.engineTime;

            const shouldAutosave: boolean = state.lastAutosaveSuccess
                ? convertDuration(
                      state.autosaveInterval || {
                          seconds: 5,
                      },
                      {
                          milliseconds: true,
                      },
                  ).milliseconds <=
                  startEngineTime - state.lastAutosaveSuccess.at
                : true;

            if (!shouldAutosave) {
                return;
            }

            state.savingStaredAt = startEngineTime;

            void persistSaveState({
                engine,
                saveState: state.saveState,
            })
                .then(() => {
                    const finishTime = engine.engineTime;
                    state.lastAutosaveSuccess = {
                        at: finishTime,
                        duration: createEngineTime(finishTime - startEngineTime),
                    };
                })
                .catch((error: unknown) => {
                    const errorTime = engine.engineTime;
                    state.lastAutosaveFailure = {
                        at: errorTime,
                        duration: createEngineTime(errorTime - startEngineTime),
                        error: ensureError(error),
                    };
                })
                .finally(() => {
                    state.savingStaredAt = undefined;
                });
        },
    });

    return {
        anthaAutosaveMod,
        loadSaveDataAsset,
        persistSaveState,
    };
}
