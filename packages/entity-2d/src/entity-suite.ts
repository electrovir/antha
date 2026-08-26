import {type Asset} from '@antha/asset';
import {check} from '@augment-vir/assert';
import {
    type AnyObject,
    type Constructor,
    getObjectTypedEntries,
    getOrSet,
    type IsAny,
} from '@augment-vir/common';
import {type Shape} from 'object-shape-tester';
import {
    BaseEntity2d,
    type BaseEntityAssetDefinitions,
    type Entity2dConstructor,
    type Entity2dConstructorParams,
    entityPositionParamsShape,
    EntityStore2d,
    type EntityStore2dConstructorParams,
    type MappedEntityAssets,
    type ParamsMap,
    type ReverseParamsMap,
    ViewEntity2d,
} from './entity.js';

/**
 * Params for both {@link EntitySuite2d.defineEntity} and {@link EntitySuite2d.defineLogicEntity}.
 *
 * @category Internal
 */
export type DefineEntity2dArgs<
    ParamsShape extends Shape<AnyObject> | undefined,
    EntityAssets extends BaseEntityAssetDefinitions | undefined,
> = {
    /** Entity classes this entity observes collisions with. Omit to observe none. */
    collidesWith?: ReadonlyArray<Entity2dConstructor> | undefined;
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
              NoInfer<ParamsShape> extends Shape<AnyObject>
                  ? NoInfer<ParamsShape>['runtimeType']
                  : undefined
          >
        | undefined;
    assets?: EntityAssets;
};

/**
 * Static members of both view and logic entity constructors.
 *
 * @category Internal
 */
export type StaticEntity2dParts<
    State extends AnyObject = any,
    ParamsShape extends Shape<AnyObject> | undefined = any,
    EntityAssets extends BaseEntityAssetDefinitions | undefined = any,
> = {
    /** Entity classes this entity observes collisions with. Omit to observe none. */
    collidesWith: ReadonlyArray<Entity2dConstructor> | undefined;
    /** Cached entity classes this entity observes collisions with. */
    collidesWithSet: ReadonlySet<Entity2dConstructor> | undefined;
    /**
     * This key is used for deserialization of entities to track which class needs to be
     * constructed. You cannot have duplicate keys loaded at the same time.
     *
     * This is used instead of inferring the entity key from the class name so that you can still
     * minify your class names without making debugging nigh impossible (you'll still know which
     * entities are being serialized and deserialized even if your class names are minified).
     */
    entityKey: string;
    /** Shape definition of this entity's parameters. */
    paramsShape: ParamsShape;
    /**
     * Defines which properties from {@link BaseEntity2d.params} will be mapped to hitbox and/or view
     * properties.
     */
    paramsMap: IsAny<ParamsShape> extends true
        ? any
        : ParamsMap<ParamsShape extends Shape<AnyObject> ? ParamsShape['runtimeType'] : undefined>;
    /** Parses the serialized params generated by {@link BaseEntity2d.serialize}. */
    deserialize(serialized: string | undefined): AnyObject | undefined;
    assets: MappedEntityAssets<EntityAssets>;
    ConstructorArgsType: Entity2dConstructorParams<
        State,
        ParamsShape extends Shape<AnyObject> ? ParamsShape['runtimeType'] : undefined
    >;
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
    ParamsShape extends Shape<AnyObject> | undefined,
    EntityAssets extends BaseEntityAssetDefinitions | undefined,
> = Constructor<
    DefinedViewEntity2dInstance<State, ParamsShape, EntityAssets>,
    ConstructorParameters<
        typeof ViewEntity2d<
            State,
            ParamsShape extends Shape<AnyObject> ? ParamsShape['runtimeType'] : undefined
        >
    >
> &
    StaticEntity2dParts<State, ParamsShape>;

/**
 * Type for {@link EntitySuite2d.defineEntity}.
 *
 * @category Internal
 */
export type DefineViewEntity2d<State extends AnyObject> = <
    const ParamsShape extends Shape<AnyObject> | undefined,
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
    ParamsShape extends Shape<AnyObject> | undefined,
> = BaseEntity2d<
    State,
    ParamsShape extends Shape<AnyObject> ? ParamsShape['runtimeType'] : undefined
>;

/**
 * Output of {@link DefineLogicEntity2d}.
 *
 * @category Internal
 */
export type DefinedLogicEntity2dConstructor<
    State extends AnyObject,
    ParamsShape extends Shape<AnyObject> | undefined,
> = Constructor<
    DefinedLogicEntity2dInstance<State, ParamsShape>,
    ConstructorParameters<
        typeof BaseEntity2d<
            State,
            ParamsShape extends Shape<AnyObject> ? ParamsShape['runtimeType'] : undefined
        >
    >
> &
    StaticEntity2dParts<State, ParamsShape>;

/**
 * Type for `EntitySuite.defineEntity`.
 *
 * @category Internal
 */
export type DefineLogicEntity2d<State extends AnyObject> = <
    const ParamsShape extends Shape<AnyObject> | undefined,
    const EntityAssets extends BaseEntityAssetDefinitions | undefined,
>(
    params: DefineEntity2dArgs<ParamsShape, EntityAssets>,
) => DefinedLogicEntity2dConstructor<NoInfer<State>, NoInfer<ParamsShape>>;

/**
 * ========================
 *
 * # Entity Suite
 *
 * ========================
 */

/**
 * Output of {@link defineEntitySuite2d}, used to defining and creating entities.
 *
 * @category Internal
 */
export type EntitySuite2d<State extends AnyObject> = {
    /**
     * The suite's entity store constructor. Instantiate this and to add your first entities.
     *
     * All defined entities will also have a reference to this store so they can add additional
     * entities by themselves.
     */
    EntityStore: new (params: Readonly<EntityStore2dConstructorParams>) => EntityStore2d<State>;

    /**
     * Define a standard entity (with a view). This is intended to be extended from your entity
     * class.
     */
    defineEntity: DefineViewEntity2d<State>;
    /** Define an entity that doesn't have an attached view. These are likely to be rare. */
    defineLogicEntity: DefineLogicEntity2d<State>;
    /**
     * A set of entity keys used within this entity suite. This will only be populated by all
     * classes that are defined with `defineEntity` or `defineLogicEntity` (so this will miss any
     * not-yet-resolved dynamic imports). This will be populated even before the classes are ever
     * instantiated.
     */
    entityKeys: Set<string>;
};

/**
 * This is the starting point of the @game-vir/entity package. Call this to produce the function
 * needed to define new entities and the store needed to add entity instances.
 *
 * @category Main
 */
export function defineEntitySuite2d<State extends AnyObject>(): EntitySuite2d<State> {
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
                public static override readonly collidesWithSet = new Set(collidesWith);
                public static override readonly entityKey = key;
                public static override readonly paramsShape = paramsShape;
                public static override readonly assets = assets;

                public static override readonly paramsMap = paramsMap;
                public static override readonly reverseParamsMap = reverseParamsMap(paramsMap);
            },
        };

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return classWrapper[key]!;
    }

    return {
        EntityStore: EntityStore2d,
        defineEntity: createDefiner(ViewEntity2d) as DefineViewEntity2d<State>,
        defineLogicEntity: createDefiner(BaseEntity2d) as DefineLogicEntity2d<State>,
        entityKeys,
    };
}

/**
 * Converts {@link ParamsMap} to {@link ReverseParamsMap}.
 *
 * @category Internal
 */
export function reverseParamsMap(paramsMap: ParamsMap | undefined): ReverseParamsMap | undefined {
    if (!paramsMap) {
        return undefined;
    }

    const reverseParamsMap: ReverseParamsMap = {};

    getObjectTypedEntries(paramsMap).forEach(
        ([
            topKey,
            mappings,
        ]) => {
            getObjectTypedEntries(mappings as Record<string, boolean | string>).forEach(
                ([
                    mapToKey,
                    mapFromKey,
                ]) => {
                    if (!mapFromKey) {
                        return;
                    }

                    const paramMapping = getOrSet(
                        reverseParamsMap,
                        check.isString(mapFromKey) ? mapFromKey : mapToKey,
                        () => {
                            return {};
                        },
                    );

                    const mapToArray = getOrSet(paramMapping, topKey, () => {
                        return [];
                    });

                    if (!mapToArray.includes(mapToKey)) {
                        mapToArray.push(mapToKey);
                    }
                },
            );
        },
    );

    return reverseParamsMap;
}
