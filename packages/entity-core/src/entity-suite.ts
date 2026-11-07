import {type Asset} from '@antha/asset';
import {defineAnthaMod, SkipExecution, type ModTrigger} from '@antha/engine';
import {assertWrap} from '@augment-vir/assert';
import {
    getObjectTypedEntries,
    type MaybePromise,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {convertDuration, type AnyDuration} from 'date-vir';
import {type Shape} from 'object-shape-tester';
import {type EntityStore} from './entity-store.js';
import {
    type BaseEntity,
    type BaseEntityAssetDefinitions,
    type EntityCollision,
    type EntityConstructor,
    type EntityPhysicsSource,
} from './entity.js';
import {
    maxCollisionCategories,
    type AnyPhysicsWorld,
    type PhysicsDefinitionOf,
} from './physics-world.js';

/**
 * Params for defining an entity without a physics body.
 *
 * @category Internal
 */
export type DefineLogicEntityArgs<
    ParamsShape extends Shape | undefined,
    EntityAssets extends BaseEntityAssetDefinitions | undefined,
> = {
    /**
     * This key is used for deserialization of entities to track which class needs to be
     * constructed. Do not use duplicate key strings across multiple entity classes.
     */
    key: string;
} & PartialWithUndefined<{
    /**
     * This should contain all parameters necessary to reconstruct this entity from scratch so it
     * can be serialized, sent across the network in JSON format, then reconstructed on another
     * device (for multiplayer support). The physics body's position and velocity are saved
     * separately, so leave them out.
     */
    paramsShape: ParamsShape;
    assets: EntityAssets;
}>;

/**
 * Params for defining an entity.
 *
 * @category Internal
 */
export type DefineEntityArgs<
    ParamsShape extends Shape | undefined,
    EntityAssets extends BaseEntityAssetDefinitions | undefined,
    World extends AnyPhysicsWorld,
    Constructor extends EntityConstructor,
> = DefineLogicEntityArgs<ParamsShape, EntityAssets> &
    PartialWithUndefined<{
        /**
         * The entity's physics body, or a function that builds it from the entity's params. Without
         * this, the entity gets a body with no shapes, which only holds a position.
         */
        physics: EntityPhysicsSource<
            PhysicsDefinitionOf<World>,
            ParamsShape extends Shape ? ParamsShape['runtimeType'] : undefined
        >;
        /** Whether bodies of this class collide with each other. */
        touchesSelf: boolean;
        /**
         * Entity classes whose bodies collide with this one's. Either class listing the other is
         * enough. Bodies whose classes don't list each other pass through each other.
         */
        touches: ReadonlyArray<Constructor>;
    }>;

/**
 * State shared by every entity suite's update mod.
 *
 * @category Internal
 */
export type EntityModState<Store extends EntityStore = EntityStore> = {
    entityStore: Store;
    /** If true, entity updates and physics steps are skipped. */
    disableEntityUpdate: boolean;
    /** If true, entity renders are skipped. */
    disableEntityRender: boolean;
};

/**
 * Options shared by every entity suite.
 *
 * @category Internal
 */
export type EntitySuiteOptions = PartialWithUndefined<{
    /**
     * The entity update mod's trigger. If left undefined, enabled entity updates will run on every
     * engine tick.
     */
    updateTrigger: ModTrigger;
    /**
     * If `true`, the `updateEntitiesMod` does not update entities or step physics. Use this when
     * something else owns the game clock (like a lock-step multiplayer mod) and calls
     * `entityStore.updateAllEntities()` itself.
     *
     * @default false
     */
    disableEntityUpdate: boolean;
    /**
     * If `true`, the `updateEntitiesMod` does not move views or update transient entity render
     * state.
     *
     * @default false
     */
    disableEntityRender: boolean;
}>;

/**
 * The most time one `updateEntitiesMod` run catches up on. Longer gaps (like a tab in the
 * background) are dropped instead of being simulated all at once.
 */
const maxCatchUpDuration: AnyDuration = {
    milliseconds: 250,
};

/**
 * Creates an entity update mod and entity definer for one physics engine and renderer. Entity
 * packages (like `@antha/entity-2d`) wrap this with their own types. Entities defined by one suite
 * can only touch each other, and a suite supports at most 64 entity classes that touch anything.
 *
 * @category Internal
 */
export function createEntitySuite<Store extends EntityStore, State extends EntityModState<Store>>({
    modName,
    baseEntityClass,
    options,
    createEntityStore,
}: Readonly<{
    modName: string;
    /** Every defined entity class extends this. */
    baseEntityClass: typeof BaseEntity<any, any, any, any>;
    options: Readonly<EntitySuiteOptions>;
    /**
     * Creates the store that `updateEntitiesMod` puts in `state.entityStore`. Return `undefined`
     * while something the store needs is missing from state, and the mod skips until it exists.
     */
    createEntityStore: (state: Readonly<Partial<State>>) => MaybePromise<Store> | undefined;
}>) {
    const entityKeys = new Set<string>();
    const collisionClasses: EntityConstructor[] = [];
    /** Simulated time each store still owes, carried between `updateEntitiesMod` runs. */
    const owedSimulationMs = new WeakMap<EntityStore, number>();

    function assignCollisionCategory(entityClass: EntityConstructor) {
        if (entityClass.collision.category) {
            return;
        } else if (collisionClasses.length >= maxCollisionCategories) {
            throw new Error(
                `Entity class '${entityClass.entityKey}' cannot touch anything: an entity suite supports at most ${maxCollisionCategories} classes that touch other classes.`,
            );
        }

        entityClass.collision.category = 1n << BigInt(collisionClasses.length);
        collisionClasses.push(entityClass);
    }

    function defineEntity({
        key,
        paramsShape,
        assets,
        physics,
        touchesSelf,
        touches,
    }: DefineEntityArgs<any, BaseEntityAssetDefinitions, AnyPhysicsWorld, EntityConstructor>) {
        if (entityKeys.has(key)) {
            throw new Error(`Entity key '${key}' has already been attached to an entity class.`);
        }
        entityKeys.add(key);

        if (assets) {
            getObjectTypedEntries(assets).forEach(
                ([
                    assetKey,
                    rawAsset,
                ]) => {
                    (rawAsset as typeof rawAsset & Pick<Asset, 'assetName'>).assetName = [
                        key,
                        assetKey,
                    ].join(':');
                },
            );
        }

        const classWrapper = {
            [key]: class extends baseEntityClass {
                public static override readonly entityKey = key;
                public static override readonly paramsShape = paramsShape;
                public static override readonly assets = assets || {};
                public static override readonly physicsDefinition = physics;
                public static override readonly collision: EntityCollision = {
                    category: 0n,
                    touching: new Set(),
                };
            },
        };
        const entityClass = assertWrap.isDefined(classWrapper[key]) as unknown as EntityConstructor;

        const touchedClasses = [
            ...(touchesSelf
                ? [
                      entityClass,
                  ]
                : []),
            ...(touches || []),
        ];

        touchedClasses.forEach((touchedClass) => {
            assignCollisionCategory(entityClass);
            assignCollisionCategory(touchedClass);
            entityClass.collision.touching.add(touchedClass);
            touchedClass.collision.touching.add(entityClass);
        });

        return entityClass;
    }

    const updateEntitiesMod = defineAnthaMod<State>({
        modName,
        initState: {
            disableEntityRender: !!options.disableEntityRender,
            disableEntityUpdate: !!options.disableEntityUpdate,
        } satisfies Partial<EntityModState> as Partial<State>,
        cleanup({state}) {
            state.entityStore?.destroy();
        },
        trigger: options.updateTrigger,
        async execute(executeParams) {
            const {state} = executeParams;

            const entityStore = state.entityStore || (await createEntityStore(state));
            if (!entityStore) {
                return SkipExecution;
            }
            state.entityStore = entityStore satisfies Store as State['entityStore'];

            if (!state.disableEntityUpdate) {
                /** Runs as many fixed steps as fit in the time since the last run. */
                const owedMs =
                    (owedSimulationMs.get(entityStore) ?? 0) +
                    Math.min(
                        executeParams.msSinceLastExecute,
                        convertDuration(maxCatchUpDuration, {
                            milliseconds: true,
                        }).milliseconds,
                    );
                const stepCount = Math.floor(owedMs / entityStore.stepMs);

                for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
                    await entityStore.updateAllEntities(executeParams);
                }

                const leftoverMs = owedMs - stepCount * entityStore.stepMs;
                owedSimulationMs.set(entityStore, leftoverMs);
                if (stepCount) {
                    entityStore.lastStepTime = performance.now() - leftoverMs;
                }
            }

            if (!state.disableEntityRender) {
                await entityStore.renderAllEntities(executeParams);
            }

            return undefined;
        },
    });

    return {
        /**
         * Steps entities and physics at a fixed rate and renders them every run, unless disabled by
         * the suite's options.
         */
        updateEntitiesMod,
        /**
         * Defines an entity class that extends `baseEntityClass`. Entity packages wrap this with
         * types for their own base entity class.
         */
        defineEntity,
        /** Every entity key defined by this suite. */
        entityKeys,
    };
}
