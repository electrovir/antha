import {type AnthaAssetModState} from '@antha/asset';
import {
    createEntitySuite,
    type BaseEntityAssetDefinitions,
    type DefineEntityArgs,
    type DefineLogicEntityArgs,
    type EntityModState,
    type EntitySuiteOptions,
    type StaticEntityParts,
} from '@antha/entity-core';
import {type AnthaGraphics3dModState} from '@antha/graphics-3d';
import {type AnyObject, type Constructor, type PartialWithUndefined} from '@augment-vir/common';
import {type Shape} from 'object-shape-tester';
import {
    EntityStore3d,
    type EntityStore3dConstructorParams,
    type EntityStore3dPhysicsOptions,
} from './entity-store-3d.js';
import {BaseEntity3d, type Entity3dConstructor} from './entity.js';
import {PhysicsWorld3d} from './physics.js';

/**
 * Params for `defineLogicEntity`.
 *
 * @category Internal
 */
export type DefineLogicEntity3dArgs<
    ParamsShape extends Shape | undefined,
    EntityAssets extends BaseEntityAssetDefinitions | undefined,
> = DefineLogicEntityArgs<ParamsShape, EntityAssets>;

/**
 * Params for `defineEntity`.
 *
 * @category Internal
 */
export type DefineEntity3dArgs<
    ParamsShape extends Shape | undefined,
    EntityAssets extends BaseEntityAssetDefinitions | undefined,
> = DefineEntityArgs<ParamsShape, EntityAssets, PhysicsWorld3d, Entity3dConstructor>;

/**
 * The instance type of {@link DefinedEntity3dConstructor}.
 *
 * @category Internal
 */
export type DefinedEntity3dInstance<
    State extends AnyObject,
    ParamsShape extends Shape | undefined,
    EntityAssets extends BaseEntityAssetDefinitions | undefined,
> = BaseEntity3d<
    State,
    ParamsShape extends Shape ? ParamsShape['runtimeType'] : undefined,
    EntityAssets
>;

/**
 * Output of `defineEntity` and `defineLogicEntity`.
 *
 * @category Internal
 */
export type DefinedEntity3dConstructor<
    State extends AnyObject,
    ParamsShape extends Shape | undefined,
    EntityAssets extends BaseEntityAssetDefinitions | undefined,
> = Constructor<
    DefinedEntity3dInstance<State, ParamsShape, EntityAssets>,
    ConstructorParameters<
        typeof BaseEntity3d<
            State,
            ParamsShape extends Shape ? ParamsShape['runtimeType'] : undefined
        >
    >
> &
    StaticEntityParts<State, ParamsShape>;

/**
 * Type for `defineEntity`.
 *
 * @category Internal
 */
export type DefineEntity3d<State extends AnyObject> = <
    const ParamsShape extends Shape | undefined,
    const EntityAssets extends BaseEntityAssetDefinitions | undefined,
>(
    params: DefineEntity3dArgs<ParamsShape, EntityAssets>,
) => DefinedEntity3dConstructor<State, NoInfer<ParamsShape>, NoInfer<EntityAssets>>;

/**
 * Type for `defineLogicEntity`.
 *
 * @category Internal
 */
export type DefineLogicEntity3d<State extends AnyObject> = <
    const ParamsShape extends Shape | undefined,
    const EntityAssets extends BaseEntityAssetDefinitions | undefined,
>(
    params: DefineLogicEntity3dArgs<ParamsShape, EntityAssets>,
) => DefinedEntity3dConstructor<State, NoInfer<ParamsShape>, NoInfer<EntityAssets>>;

/**
 * State for {@link createAnthaEntity3dSuite}.
 *
 * @category Internal
 */
export type AnthaEntity3dModState<State extends AnyObject = AnyObject> = EntityModState<
    EntityStore3d<Partial<AnthaEntity3dModState<State>>>
> &
    State &
    AnthaGraphics3dModState &
    AnthaAssetModState;

/**
 * Options for {@link createAnthaEntity3dSuite}.
 *
 * @category Internal
 */
export type AnthaEntity3dModOptions = EntitySuiteOptions &
    PartialWithUndefined<{
        physics: EntityStore3dPhysicsOptions;
        /**
         * An array of all entity constructors that will be pre-registered with each entity store
         * this suite creates.
         */
        preregisteredEntities: ReadonlyArray<Entity3dConstructor>;
    }>;

/**
 * Creates an entity update mod and entity factories. Entities defined by one suite can only touch
 * each other, and a suite supports at most `maxCollisionCategories` entity classes that touch
 * anything.
 *
 * @category Pre-Built Mods
 */
export function createAnthaEntity3dSuite<ExtraState extends AnyObject>(
    options: Readonly<AnthaEntity3dModOptions> = {},
) {
    async function createEntityStore(
        params: Readonly<
            Pick<
                EntityStore3dConstructorParams<AnthaEntity3dModState<ExtraState>>,
                'view3d' | 'assetLoader'
            > & {
                state: Partial<AnthaEntity3dModState<ExtraState>>;
            }
        >,
    ) {
        return new EntityStore3d({
            ...params,
            physicsWorld: await PhysicsWorld3d.create(),
            stepDuration: options.physics?.stepDuration,
            preregisteredEntities: options.preregisteredEntities,
        });
    }

    const {defineEntity, updateEntitiesMod, entityKeys} = createEntitySuite<
        EntityStore3d<Partial<AnthaEntity3dModState<ExtraState>>>,
        AnthaEntity3dModState<ExtraState>
    >({
        modName: 'antha-entity-3d-update',
        baseEntityClass: BaseEntity3d,
        options,
        createEntityStore(state) {
            if (!state.graphics3d?.view || !state.assetLoader) {
                return undefined;
            }
            return createEntityStore({
                view3d: state.graphics3d.view,
                assetLoader: state.assetLoader,
                state,
            });
        },
    });

    return {
        /**
         * Steps entities and physics at a fixed rate and renders them every run, unless disabled by
         * the options given to `createAnthaEntity3dSuite`.
         */
        updateEntitiesMod,
        defineEntity: defineEntity satisfies (
            args: DefineEntity3dArgs<any, any>,
        ) => unknown as DefineEntity3d<AnthaEntity3dModState<ExtraState>>,
        /** Defines an entity with no physics shapes, for game logic that needs no body. */
        defineLogicEntity: defineEntity satisfies (
            args: DefineLogicEntity3dArgs<any, any>,
        ) => unknown as DefineLogicEntity3d<AnthaEntity3dModState<ExtraState>>,
        /**
         * Creates an entity store, and its Box3D world, with this suite's physics options.
         * `updateEntitiesMod` creates one automatically if `state.entityStore` is empty.
         */
        createEntityStore,
        entityKeys,
    };
}
