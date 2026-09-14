import {anthaAssetModName, AssetLoader, type AnthaAssetModState} from '@antha/asset';
import {defineAnthaMod, SkipExecution, type AnthaMod} from '@antha/engine';
import {type AnthaGraphics2dModState} from '@antha/graphics-2d';
import {
    mergeDefinedProperties,
    type AnyObject,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {html} from 'element-vir';
import {defineEntitySuite2d} from './entity-suite.js';
import {type EntityStore2d, type EntityStore2dConstructorParams} from './entity.js';

/**
 * State for {@link createAnthaEntityMod2d}.
 *
 * @category Internal
 */
export type AnthaEntity2dModState<State extends AnyObject = AnyObject> = {
    entityStore: EntityStore2d<Partial<AnthaEntity2dModState<State>>>;
    /** If true, entity updates and collision checks are skipped. */
    disableEntityUpdates: boolean;
    /** If `true`, hit boxes are visually rendered for debugging purposes. */
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

    const mod: AnthaMod<AnthaEntity2dModState<ExtraState>> = defineAnthaMod<AnthaEntity2dModState>({
        modName: 'antha-entity-2d',
        initState: {
            debugHitboxes: !!options.debug,
        },
        cleanup({state}) {
            state.entityStore?.destroy();
        },
        async execute(executeParams) {
            /**
             * If we don't have a mod that is expected to create the asset loader, then we create
             * one ourself.
             */
            if (
                !executeParams.state.assetLoader &&
                !executeParams.engine.currentMods.some((mod) => mod.modName === anthaAssetModName)
            ) {
                executeParams.state.assetLoader = new AssetLoader();
            }

            const pixiApplication = executeParams.state.pixi?.pixiApplication;

            if (!pixiApplication) {
                return SkipExecution;
            }

            if (executeParams.state.entityStore) {
                if (!executeParams.state.disableEntityUpdates) {
                    await executeParams.state.entityStore.updateAllEntities(executeParams);
                }
            } else if (executeParams.state.assetLoader) {
                executeParams.state.entityStore = new EntityStore(
                    mergeDefinedProperties(
                        {
                            pixi: pixiApplication,
                            state: executeParams.state,
                            assetLoader: executeParams.state.assetLoader,
                        },
                        options,
                    ),
                );
            }

            if (executeParams.state.debugHitboxes) {
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
