import {anthaAssetModName, AssetLoader, type AnthaAssetModState} from '@antha/asset';
import {defineAnthaMod, html, SkipExecution, type AnthaMod} from '@antha/engine';
import {type AnthaPixiCanvasModState} from '@antha/pixi-canvas';
import {
    mergeDefinedProperties,
    type AnyObject,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {defineEntitySuite} from './entity-suite.js';
import {type EntityStore, type EntityStoreConstructorParams} from './entity.js';

/**
 * State for {@link createAnthaEntityMod}.
 *
 * @category Internal
 */
export type AnthaEntityModState<State extends AnyObject = any> = {
    entityStore: EntityStore<Partial<AnthaEntityModState<State>>>;
    debugHitboxes: boolean;
} & State &
    AnthaPixiCanvasModState &
    AnthaAssetModState;

/**
 * Options for {@link createAnthaEntityMod}.
 *
 * @category Internal
 */
export type AnthaEntityModOptions = PartialWithUndefined<
    EntityStoreConstructorParams & {
        debug: boolean;
    }
>;

/**
 * A mod for rendering entities and handling collisions between them.
 *
 * @category Pre-built Mods
 */
export function createAnthaEntityMod<ExtraState extends AnyObject>(
    options: Readonly<AnthaEntityModOptions> = {},
) {
    const {EntityStore, ...entitySuite} = defineEntitySuite<AnthaEntityModState<ExtraState>>();

    const mod = defineAnthaMod<AnthaEntityModState>({
        modName: 'antha-entity',
        initState: {
            debugHitboxes: !!options.debug,
        },
        cleanup({state}) {
            state.entityStore?.destroy();
        },
        async execute({state, engine, msSinceLastExecute}) {
            /**
             * If we don't have a mod that is expected to create the asset loader, then we create
             * one ourself.
             */
            if (
                !state.assetLoader &&
                !engine.currentMods.some((mod) => mod.modName === anthaAssetModName)
            ) {
                state.assetLoader = new AssetLoader();
            }

            const pixiApplication = state.pixi?.pixiApplication;

            if (!pixiApplication) {
                return SkipExecution;
            }

            if (state.entityStore) {
                await state.entityStore.updateAllEntities({
                    msSinceLastUpdate: msSinceLastExecute,
                });
            } else if (state.assetLoader) {
                state.entityStore = new EntityStore(
                    mergeDefinedProperties(
                        {
                            pixi: pixiApplication,
                            state,
                            assetLoader: state.assetLoader,
                        },
                        options,
                    ),
                );
            }

            if (state.debugHitboxes) {
                return html`
                    <canvas class="hitbox-debug-canvas"></canvas>
                `;
            } else {
                return undefined;
            }
        },
    });

    return {
        mod: mod as AnthaMod<AnthaEntityModState<ExtraState>>,
        ...entitySuite,
    };
}
