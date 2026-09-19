import {type AnthaAssetModState, type Asset} from '@antha/asset';
import {defineAnthaMod, SkipExecution, type AnthaMod, type ModTrigger} from '@antha/engine';
import {type AnthaGraphics2dModState} from '@antha/graphics-2d';
import {assertWrap} from '@augment-vir/assert';
import {
    getObjectTypedEntries,
    mergeDefinedProperties,
    type AnyObject,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {html} from 'element-vir';
import {
    reverseParamsMap,
    type DefineEntity2dArgs,
    type DefineLogicEntity2d,
    type DefineViewEntity2d,
} from './entity-suite.js';
import {
    BaseEntity2d,
    EntityStore2d,
    ViewEntity2d,
    type BaseEntityAssetDefinitions,
    type EntityStore2dConstructorParams,
} from './entity.js';

/**
 * State for {@link createAnthaEntity2dSuite}.
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
 * Options for {@link createAnthaEntity2dSuite}.
 *
 * @category Internal
 */
export type AnthaEntity2dModOptions = PartialWithUndefined<
    EntityStore2dConstructorParams & {
        debug: boolean;
        /**
         * The entity update mod's trigger. If left undefined, entity logic will update on every
         * engine tick.
         */
        updateTrigger: ModTrigger;
    }
>;

function ensureEntityStore({
    state,
    options,
}: Readonly<{
    options: Readonly<AnthaEntity2dModOptions>;
    state: Partial<AnthaEntity2dModState>;
}>) {
    if (!state.pixi?.pixiApplication || !state.assetLoader) {
        return false;
    }

    if (!state.entityStore) {
        state.entityStore = new EntityStore2d(
            mergeDefinedProperties(
                {
                    pixi: state.pixi.pixiApplication,
                    state,
                    assetLoader: state.assetLoader,
                },
                options,
            ),
        );
    }

    return true;
}

/**
 * Creates entity update mods and entity factories.
 *
 * @category Pre-built Mods
 */
export function createAnthaEntity2dSuite<ExtraState extends AnyObject>(
    options: Readonly<AnthaEntity2dModOptions> = {},
) {
    const entityKeys = new Set<string>();

    function createDefiner<ParentClass extends typeof BaseEntity2d>(entityParent: ParentClass) {
        return (params: DefineEntity2dArgs<any, BaseEntityAssetDefinitions>): AnyObject => {
            if (params.assets) {
                getObjectTypedEntries(params.assets).forEach(
                    ([
                        key,
                        rawAsset,
                    ]) => {
                        (rawAsset as typeof rawAsset & Pick<Asset, 'assetName'>).assetName = [
                            params.key,
                            key,
                        ].join(':');
                    },
                );
            }

            return defineEntity(entityParent, params);
        };
    }

    function defineEntity(
        entityParent: typeof BaseEntity2d,
        {collidesWith, key, paramsShape, paramsMap, assets}: DefineEntity2dArgs<any, any>,
    ) {
        if (entityKeys.has(key)) {
            throw new Error(`Entity key '${key}' has already been attached to an entity class.`);
        }
        entityKeys.add(key);

        const classWrapper = {
            // @ts-expect-error: abstract methods are intentionally not implemented here
            [key]: class extends entityParent {
                public static override readonly collidesWith = collidesWith;
                public static override readonly collidesWithSet = new Set(
                    collidesWith?.collidesWithOtherEntities,
                );
                public static override readonly entityKey = key;
                public static override readonly paramsShape = paramsShape;
                public static override readonly assets = assets || {};

                public static override readonly paramsMap = paramsMap;
                public static override readonly reverseParamsMap = reverseParamsMap(paramsMap);
            },
        };

        return assertWrap.isDefined(classWrapper[key]);
    }

    const renderEntitiesMod: AnthaMod<AnthaEntity2dModState<ExtraState>> =
        defineAnthaMod<AnthaEntity2dModState>({
            modName: 'antha-entity-2d-render',
            initState: {
                debugHitboxes: !!options.debug,
            },
            cleanup({state}) {
                state.entityStore?.destroy();
            },
            async execute(executeParams) {
                if (
                    !ensureEntityStore({
                        options,
                        state: executeParams.state,
                    })
                ) {
                    return SkipExecution;
                }

                await executeParams.state.entityStore?.renderAllEntities(executeParams);

                return executeParams.state.debugHitboxes
                    ? html`
                          <canvas class="hitbox-debug-canvas"></canvas>
                      `
                    : undefined;
            },
        });

    const updateEntitiesMod = defineAnthaMod<AnthaEntity2dModState<ExtraState>>({
        modName: 'antha-entity-2d-update',
        trigger: options.updateTrigger,
        async execute(executeParams) {
            if (
                !ensureEntityStore({
                    options,
                    state: executeParams.state,
                })
            ) {
                return SkipExecution;
            }

            if (executeParams.state.entityStore && !executeParams.state.disableEntityUpdates) {
                await executeParams.state.entityStore.updateAllEntities(executeParams);
            }

            return undefined;
        },
    });

    return {
        /**
         * This mod renders each entity by calling its `render` method.
         *
         * - If you want to split logic updates from render updates, make sure to include this mod
         *   _and_ the `updateEntitiesMod` and implement the `update` and `render` methods in each
         *   entity.
         * - If you do _not_ want to split logic updates from render updates, do not use this mod, use
         *   the `updateEntitiesMod` mod exclusively and do _not_ implement the `render` method in
         *   each entity. (You must still implement the `update` method in each entity.)
         */
        renderEntitiesMod,
        /**
         * This mod updates all logic for each entity by calling its `update` method.
         *
         * - If you want to split logic updates from render updates, make sure to include this mod
         *   _and_ the `renderEntitiesMod` and implement the `update` and `render` methods in each
         *   entity.
         * - If you do _not_ want to split logic updates from render updates, use this mod exclusively
         *   and do _not_ implement the `render` method in each entity. (You must still implement
         *   the `update` method in each entity.)
         */
        updateEntitiesMod,
        defineEntity: createDefiner(ViewEntity2d) as DefineViewEntity2d<
            AnthaEntity2dModState<ExtraState>
        >,
        defineLogicEntity: createDefiner(BaseEntity2d) as DefineLogicEntity2d<
            AnthaEntity2dModState<ExtraState>
        >,
        entityKeys,
    };
}
