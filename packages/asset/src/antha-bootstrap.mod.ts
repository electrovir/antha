import {defineAnthaMod, SkipExecution, type AnthaEngine, type AnthaMod} from '@antha/engine';
import {
    ensureErrorAndPrependMessage,
    type AnyObject,
    type MaybePromise,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {type AnthaAssetModState} from './antha-asset.mod.js';
import {type AssetLoader, type AssetLoadSession} from './asset-loader.js';

/**
 * State used internally by {@link createAnthaBootstrapMod}.
 *
 * @category Internal
 */
export type AnthaBootstrapModState = {
    hasStartedBootstrap: boolean;
};

/**
 * Parameters passed to the bootstrap callback.
 *
 * @category Internal
 */
export type AnthaBootstrapParams<State extends AnyObject, Module> = {
    assetLoader: AssetLoader;
    engine: AnthaEngine;
    loadSession: AssetLoadSession;
    module: Module;
    state: Partial<State & AnthaAssetModState & AnthaBootstrapModState>;
};

/**
 * Result returned by the bootstrap callback.
 *
 * @category Internal
 */
export type AnthaBootstrapResult = {
    /** Mods that Antha installs after bootstrapping finishes. */
    mods: ReadonlyArray<AnthaMod>;
};

/**
 * Options for {@link createAnthaBootstrapMod}.
 *
 * @category Internal
 */
export type AnthaBootstrapModOptions<State extends AnyObject, Module> = {
    /**
     * Bootstraps the loaded module and returns the mods that should be installed for it. Await any
     * initial asset loading here, using the provided load session, before returning.
     */
    bootstrap: (
        this: void,
        params: Readonly<AnthaBootstrapParams<State, Module>>,
    ) => MaybePromise<AnthaBootstrapResult>;
    /** Lazily imports the code required to bootstrap the game. */
    loadModule: (this: void) => MaybePromise<Module>;
} & PartialWithUndefined<{
    /** Label shown for the code-loading task. */
    assetName: string;
}>;

/**
 * Creates a mod that tracks a lazy game-module import on Antha's loading screen, then installs the
 * mods returned by the module's bootstrap callback.
 *
 * @category Pre-Built Mods
 */
export function createAnthaBootstrapMod<State extends AnyObject = AnyObject>() {
    return function createBootstrapMod<Module>(
        options: Readonly<AnthaBootstrapModOptions<NoInfer<State>, Module>>,
    ) {
        return defineAnthaMod<NoInfer<State> & AnthaAssetModState & AnthaBootstrapModState>({
            modName: 'antha-bootstrap',
            execute({engine, state}) {
                const assetLoader = state.assetLoader;

                if (!assetLoader || state.hasStartedBootstrap) {
                    return SkipExecution;
                }

                state.hasStartedBootstrap = true;
                const loadSession = assetLoader.createLoadSession();
                loadSession.reportProgress({
                    current: 0,
                    currentResourceName: options.assetName || 'Game code',
                    total: 0,
                });

                void Promise.resolve()
                    .then(() => {
                        return options.loadModule();
                    })
                    .then(async (module) => {
                        const bootstrapResult = await options.bootstrap({
                            assetLoader,
                            engine,
                            loadSession,
                            module,
                            state,
                        });
                        engine.currentMods.push(...bootstrapResult.mods);
                        loadSession.complete();
                    })
                    .catch((error: unknown) => {
                        loadSession.complete();
                        engine.log.error(
                            ensureErrorAndPrependMessage(error, 'Failed to bootstrap game.'),
                        );
                    });

                return SkipExecution;
            },
        });
    };
}
