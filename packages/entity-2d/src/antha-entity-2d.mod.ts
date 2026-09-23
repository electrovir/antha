import {type AnthaAssetModState, type Asset} from '@antha/asset';
import {defineAnthaMod, SkipExecution, type ModTrigger} from '@antha/engine';
import {type AnthaGraphics2dModState} from '@antha/graphics-2d';
import {assertWrap} from '@augment-vir/assert';
import {
    getObjectTypedEntries,
    mergeDefinedProperties,
    type AnyObject,
    type Constructor,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {html} from 'element-vir';
import {type Shape} from 'object-shape-tester';
import {
    BaseEntity2d,
    entityPositionParamsShape,
    EntityStore2d,
    reverseParamsMap,
    ViewEntity2d,
    type BaseEntityAssetDefinitions,
    type EntityCollisionDefinition,
    type EntityStore2dConstructorParams,
    type ParamsMap,
    type StaticEntity2dParts,
} from './entity.js';

/**
 * Params for both `defineEntity` and `defineLogicEntity`.
 *
 * @category Internal
 */
export type DefineEntity2dArgs<
    ParamsShape extends Shape | undefined,
    EntityAssets extends BaseEntityAssetDefinitions | undefined,
> = {
    /** Entity classes this entity observes collisions with. Omit to observe none. */
    collidesWith?: EntityCollisionDefinition | undefined;
    /**
     * This key is used for deserialization of entities to track which class needs to be
     * constructed. Do not use duplicate key strings across multiple entity classes.
     */
    key: string;
    /**
     * This should contain all parameters necessary to reconstruct this entity from scratch so it
     * can be serialized, sent across the network in JSON format, then reconstructed on another
     * device (for multiplayer support).
     *
     * Make sure to include {@link entityPositionParamsShape} as part of the shape if you want to
     * include entity position parameters.
     */
    paramsShape?: ParamsShape;
    /**
     * A mapping of the entity's params object (defined by {@link DefineEntity2dArgs.paramsShape})
     * keys to hitbox and/or view properties.
     *
     * Use `standardParamsMap` to automatically map the params `x` and `y` in `paramsShape` to both
     * the entity's hitbox x/y and the entity's view x/y.
     *
     * @example
     *
     * ```ts
     * const customMapping = {
     *     paramsShape: defineShape({
     *         left: -1,
     *         top: -1,
     *     }),
     *     paramsMap: {
     *         hitbox: {
     *             x: 'left', // maps `left` from `paramsShape` to the entity's hitbox.x
     *             y: 'top', // maps `top` from `paramsShape` to the entity's hitbox.y
     *         },
     *         view: {
     *             x: 'left', // maps `left` from `paramsShape` to the entity's view.x
     *             y: 'top', // maps `top` from `paramsShape` to the entity's view.y
     *         },
     *     },
     * };
     * ```
     *
     * @example
     *
     * ```ts
     * const standardMapping = {
     *     paramsShape: defineShape({
     *         left: -1,
     *         top: -1,
     *     }),
     *     paramsMap: standardParamsMap, // use the standard x/y mapping
     * };
     * ```
     *
     * @example
     *
     * ```ts
     * const undefinedMapping = {
     *     paramsShape: defineShape({
     *         left: -1,
     *         top: -1,
     *     }),
     *     paramsMap: undefined, // no mapping at all
     * };
     * ```
     *
     * @example
     *
     * ```ts
     * const omittedMapping = {
     *     paramsShape: defineShape({
     *         left: -1,
     *         top: -1,
     *     }),
     *     // no mapping at all
     * };
     * ```
     *
     * @default undefined // no mapping
     */
    paramsMap?:
        | ParamsMap<
              NoInfer<ParamsShape> extends Shape ? NoInfer<ParamsShape>['runtimeType'] : undefined
          >
        | undefined;
    assets?: EntityAssets;
};

/**
 * ========================
 *
 * # View Entity
 *
 * Types for entity definitions that have a view.
 *
 * ========================
 */

/**
 * The constructor output of {@link DefinedViewEntity2dConstructor}.
 *
 * @category Internal
 */
export type DefinedViewEntity2dInstance<
    State extends AnyObject,
    ParamsShape extends Shape<Record<string, any>> | undefined,
    EntityAssets extends BaseEntityAssetDefinitions | undefined,
> = ViewEntity2d<
    State,
    ParamsShape extends Shape ? ParamsShape['runtimeType'] : undefined,
    EntityAssets
>;

/**
 * Output of {@link DefineViewEntity2d}.
 *
 * @category Internal
 */
export type DefinedViewEntity2dConstructor<
    State extends AnyObject,
    ParamsShape extends Shape | undefined,
    EntityAssets extends BaseEntityAssetDefinitions | undefined,
> = Constructor<
    DefinedViewEntity2dInstance<State, ParamsShape, EntityAssets>,
    ConstructorParameters<
        typeof ViewEntity2d<
            State,
            ParamsShape extends Shape ? ParamsShape['runtimeType'] : undefined
        >
    >
> &
    StaticEntity2dParts<State, ParamsShape>;

/**
 * Type for `defineEntity`.
 *
 * @category Internal
 */
export type DefineViewEntity2d<State extends AnyObject> = <
    const ParamsShape extends Shape | undefined,
    const EntityAssets extends BaseEntityAssetDefinitions | undefined,
>(
    params: DefineEntity2dArgs<ParamsShape, EntityAssets>,
) => DefinedViewEntity2dConstructor<State, NoInfer<ParamsShape>, NoInfer<EntityAssets>> &
    StaticEntity2dParts<NoInfer<State>, NoInfer<ParamsShape>>;

/**
 * ========================
 *
 * # Logic Entity
 *
 * Types for entity definitions that don't have a view. The only difference between these types and
 * the view types are that this uses `BaseEntity2d` instead of `ViewEntity2d`.
 *
 * ========================
 */

/**
 * The constructor output of {@link DefinedLogicEntity2dConstructor}.
 *
 * @category Internal
 */
export type DefinedLogicEntity2dInstance<
    State extends AnyObject,
    ParamsShape extends Shape | undefined,
> = BaseEntity2d<State, ParamsShape extends Shape ? ParamsShape['runtimeType'] : undefined>;

/**
 * Output of {@link DefineLogicEntity2d}.
 *
 * @category Internal
 */
export type DefinedLogicEntity2dConstructor<
    State extends AnyObject,
    ParamsShape extends Shape | undefined,
> = Constructor<
    DefinedLogicEntity2dInstance<State, ParamsShape>,
    ConstructorParameters<
        typeof BaseEntity2d<
            State,
            ParamsShape extends Shape ? ParamsShape['runtimeType'] : undefined
        >
    >
> &
    StaticEntity2dParts<State, ParamsShape>;

/**
 * Type for `defineLogicEntity`.
 *
 * @category Internal
 */
export type DefineLogicEntity2d<State extends AnyObject> = <
    const ParamsShape extends Shape | undefined,
    const EntityAssets extends BaseEntityAssetDefinitions | undefined,
>(
    params: DefineEntity2dArgs<ParamsShape, EntityAssets>,
) => DefinedLogicEntity2dConstructor<NoInfer<State>, NoInfer<ParamsShape>>;

/**
 * State for {@link createAnthaEntity2dSuite}.
 *
 * @category Internal
 */
export type AnthaEntity2dModState<State extends AnyObject = AnyObject> = {
    entityStore: EntityStore2d<Partial<AnthaEntity2dModState<State>>>;
    /** If true, entity updates and collision checks are skipped. */
    disableEntityUpdate: boolean;
    /** If true, entity renders are skipped. */
    disableEntityRender: boolean;
    /** If `true`, hit boxes are visually rendered for debugging purposes. */
    showHitboxDebug: boolean;
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
         * The entity update mod's trigger. If left undefined, enabled entity updates will run on
         * every engine tick.
         */
        updateTrigger: ModTrigger;
        /**
         * If `true`, the `updateEntitiesMod` does not update entity data and collision state.
         *
         * @default false
         */
        disableEntityUpdate: boolean;
        /**
         * If `true`, the `updateEntitiesMod` does not update transient entity render state.
         *
         * @default false
         */
        disableEntityRender: boolean;
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
 * Creates an entity update mod and entity factories.
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

    const updateEntitiesMod = defineAnthaMod<AnthaEntity2dModState<ExtraState>>({
        modName: 'antha-entity-2d-update',
        initState: {
            showHitboxDebug: !!options.debug,
            disableEntityRender: !!options.disableEntityRender,
            disableEntityUpdate: !!options.disableEntityUpdate,
        } satisfies Partial<AnthaEntity2dModState> as Partial<AnthaEntity2dModState<ExtraState>>,
        cleanup({state}) {
            state.entityStore?.destroy();
        },
        trigger: options.updateTrigger,
        async execute(executeParams) {
            if (
                !ensureEntityStore({
                    options,
                    state: executeParams.state,
                })
            ) {
                return SkipExecution;
            } else if (executeParams.state.entityStore) {
                if (!executeParams.state.disableEntityUpdate) {
                    await executeParams.state.entityStore.updateAllEntities(executeParams);
                }

                if (!executeParams.state.disableEntityRender) {
                    await executeParams.state.entityStore.renderAllEntities(executeParams);
                }
            }

            return executeParams.state.showHitboxDebug
                ? html`
                      <canvas class="hitbox-debug-canvas"></canvas>
                  `
                : undefined;
        },
    });

    return {
        /**
         * Updates entity data an/or transient render state, depending on the options you provided
         * to `createAnthaEntity2dSuite`.
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
