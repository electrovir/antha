import {defineAnthaMod, SkipExecution, type AnthaEngine, type AnthaMod} from '@antha/engine';
import {
    ensureErrorAndPrependMessage,
    type AnyObject,
    type MaybePromise,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {type AnthaAssetModState} from './antha-asset.mod.js';
import {defineAsset, type AssetLoader, type AssetLoadSession} from './asset-loader.js';

/** State used internally by {@link createAnthaBootstrapMod}. */
export type AnthaBootstrapModState = {
    hasStartedBootstrap: boolean;
};

/** Parameters passed to {@link AnthaBootstrapModOptions.bootstrap}. */
export type AnthaBootstrapParams<Module, State extends AnyObject> = {
    assetLoader: AssetLoader;
    engine: AnthaEngine;
    loadSession: AssetLoadSession;
    module: Module;
    state: Partial<State & AnthaAssetModState & AnthaBootstrapModState>;
};

/** Result returned by {@link AnthaBootstrapModOptions.bootstrap}. */
export type AnthaBootstrapResult = {
    /** Mods that Antha installs after bootstrapping finishes. */
    mods: ReadonlyArray<AnthaMod>;
};

/** Options for {@link createAnthaBootstrapMod}. */
export type AnthaBootstrapModOptions<Module, State extends AnyObject> = {
    /**
     * Bootstraps the loaded module and returns the mods that should be installed for it. Await any
     * initial asset loading here, using the provided load session, before returning.
     */
    bootstrap: (
        this: void,
        params: Readonly<AnthaBootstrapParams<Module, State>>,
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
export function createAnthaBootstrapMod<Module, State extends AnyObject = AnyObject>(
    options: Readonly<AnthaBootstrapModOptions<Module, State>>,
) {
    const moduleAsset = defineAsset({
        assetName: options.assetName || 'Game code',
        maxProgress: 1,
        async load({incrementProgressCallback}) {
            const module = await options.loadModule();
            incrementProgressCallback();

            return {
                value: module,
            };
        },
    });

    return defineAnthaMod<State & AnthaAssetModState & AnthaBootstrapModState>({
        modName: 'antha-bootstrap',
        execute({engine, state}) {
            const assetLoader = state.assetLoader;

            if (!assetLoader || state.hasStartedBootstrap) {
                return SkipExecution;
            }

            state.hasStartedBootstrap = true;
            const loadSession = assetLoader.createLoadSession();

            void assetLoader
                .loadIndividualAsset({
                    asset: moduleAsset,
                    loadSession,
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
}
