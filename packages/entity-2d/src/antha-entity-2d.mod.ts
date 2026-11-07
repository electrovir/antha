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
import {type AnthaGraphics2dModState} from '@antha/graphics-2d';
import {type AnyObject, type Constructor, type PartialWithUndefined} from '@augment-vir/common';
import {type Shape} from 'object-shape-tester';
import {
    EntityStore2d,
    type EntityStore2dConstructorParams,
    type EntityStore2dPhysicsOptions,
} from './entity-store-2d.js';
import {BaseEntity2d, type Entity2dConstructor} from './entity.js';
import {PhysicsWorld2d} from './physics.js';

/**
 * Params for `defineLogicEntity`.
 *
 * @category Internal
 */
export type DefineLogicEntity2dArgs<
    ParamsShape extends Shape | undefined,
    EntityAssets extends BaseEntityAssetDefinitions | undefined,
> = DefineLogicEntityArgs<ParamsShape, EntityAssets>;

/**
 * Params for `defineEntity`.
 *
 * @category Internal
 */
export type DefineEntity2dArgs<
    ParamsShape extends Shape | undefined,
    EntityAssets extends BaseEntityAssetDefinitions | undefined,
> = DefineEntityArgs<ParamsShape, EntityAssets, PhysicsWorld2d, Entity2dConstructor>;

/**
 * The instance type of {@link DefinedEntity2dConstructor}.
 *
 * @category Internal
 */
export type DefinedEntity2dInstance<
    State extends AnyObject,
    ParamsShape extends Shape | undefined,
    EntityAssets extends BaseEntityAssetDefinitions | undefined,
> = BaseEntity2d<
    State,
    ParamsShape extends Shape ? ParamsShape['runtimeType'] : undefined,
    EntityAssets
>;

/**
 * Output of `defineEntity` and `defineLogicEntity`.
 *
 * @category Internal
 */
export type DefinedEntity2dConstructor<
    State extends AnyObject,
    ParamsShape extends Shape | undefined,
    EntityAssets extends BaseEntityAssetDefinitions | undefined,
> = Constructor<
    DefinedEntity2dInstance<State, ParamsShape, EntityAssets>,
    ConstructorParameters<
        typeof BaseEntity2d<
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
export type DefineEntity2d<State extends AnyObject> = <
    const ParamsShape extends Shape | undefined,
    const EntityAssets extends BaseEntityAssetDefinitions | undefined,
>(
    params: DefineEntity2dArgs<ParamsShape, EntityAssets>,
) => DefinedEntity2dConstructor<State, NoInfer<ParamsShape>, NoInfer<EntityAssets>>;

/**
 * Type for `defineLogicEntity`.
 *
 * @category Internal
 */
export type DefineLogicEntity2d<State extends AnyObject> = <
    const ParamsShape extends Shape | undefined,
    const EntityAssets extends BaseEntityAssetDefinitions | undefined,
>(
    params: DefineLogicEntity2dArgs<ParamsShape, EntityAssets>,
) => DefinedEntity2dConstructor<State, NoInfer<ParamsShape>, NoInfer<EntityAssets>>;

/**
 * State for {@link createAnthaEntity2dSuite}.
 *
 * @category Internal
 */
export type AnthaEntity2dModState<State extends AnyObject = AnyObject> = EntityModState<
    EntityStore2d<Partial<AnthaEntity2dModState<State>>>
> &
    State &
    AnthaGraphics2dModState &
    AnthaAssetModState;

/**
 * Options for {@link createAnthaEntity2dSuite}.
 *
 * @category Internal
 */
export type AnthaEntity2dModOptions = EntitySuiteOptions &
    PartialWithUndefined<{
        physics: EntityStore2dPhysicsOptions;
        /**
         * An array of all entity constructors that will be pre-registered with each entity store
         * this suite creates.
         */
        preregisteredEntities: ReadonlyArray<Entity2dConstructor>;
    }>;

/**
 * Creates an entity update mod and entity factories. Entities defined by one suite can only touch
 * each other, and a suite supports at most 64 entity classes that touch anything.
 *
 * @category Pre-built Mods
 */
export function createAnthaEntity2dSuite<ExtraState extends AnyObject>(
    options: Readonly<AnthaEntity2dModOptions> = {},
) {
    async function createEntityStore(
        params: Readonly<
            Pick<
                EntityStore2dConstructorParams<AnthaEntity2dModState<ExtraState>>,
                'pixi' | 'assetLoader'
            > & {
                state: Partial<AnthaEntity2dModState<ExtraState>>;
            }
        >,
    ) {
        return new EntityStore2d({
            ...params,
            physicsWorld: await PhysicsWorld2d.create(options.physics),
            stepDuration: options.physics?.stepDuration,
            preregisteredEntities: options.preregisteredEntities,
        });
    }

    const {defineEntity, updateEntitiesMod, entityKeys} = createEntitySuite<
        EntityStore2d<Partial<AnthaEntity2dModState<ExtraState>>>,
        AnthaEntity2dModState<ExtraState>
    >({
        modName: 'antha-entity-2d-update',
        baseEntityClass: BaseEntity2d,
        options,
        createEntityStore(state) {
            if (!state.pixi?.pixiApplication || !state.assetLoader) {
                return undefined;
            }
            return createEntityStore({
                pixi: state.pixi.pixiApplication,
                assetLoader: state.assetLoader,
                state,
            });
        },
    });

    return {
        /**
         * Steps entities and physics at a fixed rate and renders them every run, unless disabled by
         * the options given to `createAnthaEntity2dSuite`.
         */
        updateEntitiesMod,
        defineEntity: defineEntity as DefineEntity2d<AnthaEntity2dModState<ExtraState>>,
        /** Defines an entity with no physics shapes, for game logic that needs no body. */
        defineLogicEntity: defineEntity as DefineLogicEntity2d<AnthaEntity2dModState<ExtraState>>,
        /**
         * Creates an entity store, and its Box2D world, with this suite's physics options.
         * `updateEntitiesMod` creates one automatically if `state.entityStore` is empty.
         */
        createEntityStore,
        entityKeys,
    };
}
