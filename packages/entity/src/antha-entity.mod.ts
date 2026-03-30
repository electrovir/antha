import {anthaAssetModName, AssetLoader, type AnthaAssetModState} from '@antha/asset';
import {type AnthaPixiCanvasModState} from '@antha/pixi-canvas';
import {
    mergeDefinedProperties,
    type AnyObject,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {defineAnthaMod, html, SkipExecution} from 'antha';
import {defineEntitySuite} from './entity-suite.js';
import {type EntityStore, type EntityStoreConstructorParams} from './entity.js';

/**
 * State for {@link createAnthaEntityStoreMod}.
 *
 * @category Internal
 */
export type AnthaEntityStoreModState<State extends AnyObject> = {
    entityStore: EntityStore<Partial<AnthaEntityStoreModState<State>>>;
    debugHitboxes: boolean;
} & State &
    AnthaPixiCanvasModState &
    AnthaAssetModState;

/**
 * A mod for rendering entities and handling collisions between them.
 *
 * @category Pre-built Mods
 */
export function createAnthaEntityStoreMod<State extends AnyObject>(
    options: Readonly<
        PartialWithUndefined<
            EntityStoreConstructorParams & {
                debug: boolean;
            }
        >
    >,
) {
    const {EntityStore, ...entitySuite} = defineEntitySuite<AnthaEntityStoreModState<State>>();

    const mod = defineAnthaMod<AnthaEntityStoreModState<State>>({
        modName: 'antha-entity-store',
        cleanup({state}) {
            state.entityStore?.destroy();
        },
        async execute({state, engine}) {
            if (state.debugHitboxes == undefined) {
                state.debugHitboxes = !!options.debug;
            }

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
                await state.entityStore.updateAllEntities();
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
