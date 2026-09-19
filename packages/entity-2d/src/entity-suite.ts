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
    type BaseEntity2d,
    type BaseEntityAssetDefinitions,
    type Entity2dConstructor,
    type Entity2dConstructorParams,
    type EntityCollisionDefinition,
    entityPositionParamsShape,
    type MappedEntityAssets,
    type ParamsMap,
    type ReverseParamsMap,
    type ViewEntity2d,
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
 * Static members of both view and logic entity constructors.
 *
 * @category Internal
 */
export type StaticEntity2dParts<
    State extends AnyObject = any,
    ParamsShape extends Shape | undefined = any,
    EntityAssets extends BaseEntityAssetDefinitions | undefined = any,
> = {
    /** Entity classes this entity observes collisions with. Omit to observe none. */
    collidesWith: EntityCollisionDefinition | undefined;
    /** Cached entity classes this entity observes collisions with. */
    collidesWithSet: ReadonlySet<Entity2dConstructor>;
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
        : ParamsMap<ParamsShape extends Shape ? ParamsShape['runtimeType'] : undefined>;
    /** Parses the serialized params generated by {@link BaseEntity2d.serialize}. */
    deserialize(serialized: string | undefined): AnyObject | undefined;
    assets: MappedEntityAssets<EntityAssets>;
    ConstructorArgsType: Entity2dConstructorParams<
        State,
        ParamsShape extends Shape ? ParamsShape['runtimeType'] : undefined
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
 * Type for `EntitySuite.defineEntity`.
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
 * ========================
 *
 * # Entity Suite
 *
 * ========================
 */

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
