import {anthaAssetModName, AssetLoader, type AnthaAssetModState} from '@antha/asset';
import {defineAnthaMod, html, SkipExecution} from '@antha/engine';
import {type AnthaGraphics2dModState} from '@antha/graphics-2d';
import {
    mergeDefinedProperties,
    type AnyObject,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {defineEntitySuite2d} from './entity-suite.js';
import {type EntityStore2d, type EntityStore2dConstructorParams} from './entity.js';

/**
 * State for {@link createAnthaEntityMod2d}.
 *
 * @category Internal
 */
export type AnthaEntity2dModState<State extends AnyObject = any> = {
    entityStore: EntityStore2d<Partial<AnthaEntity2dModState<State>>>;
    debugHitboxes: boolean;
} & State &
    AnthaGraphics2dModState &
    AnthaAssetModState;

/**
 * Options for {@link createAnthaEntityMod2d}.
 *
 * @category Internal
 */
export type AnthaEntity2dModOptions = PartialWithUndefined<
    EntityStore2dConstructorParams & {
        debug: boolean;
    }
>;

/**
 * A mod for rendering entities and handling collisions between them.
 *
 * @category Pre-built Mods
 */
export function createAnthaEntityMod2d<ExtraState extends AnyObject>(
    options: Readonly<AnthaEntity2dModOptions> = {},
) {
    const {EntityStore, ...entitySuite} = defineEntitySuite2d<AnthaEntity2dModState<ExtraState>>();

    const mod = defineAnthaMod<AnthaEntity2dModState>({
        modName: 'antha-entity-2d',
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
        mod,
        ...entitySuite,
    };
}
