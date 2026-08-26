import {
    type Asset,
    type AssetBulkLoaderLoadOptions,
    type AssetLoader,
    type AssetValue,
} from '@antha/asset';
import {type PixiApplication} from '@antha/graphics-2d';
import {assert, check} from '@augment-vir/assert';
import {
    ConstructorInstanceMap,
    getObjectTypedEntries,
    makeWritable,
    mapObjectValues,
    type AbstractConstructor,
    type AnyObject,
    type Constructor,
    type Coords,
    type EmptyObject,
    type ExtractKeysWithMatchingValues,
    type IsEqual,
    type IsNever,
    type MaybePromise,
    type PartialWithUndefined,
    type Writable,
    type WritableKeysOf,
} from '@augment-vir/common';
import {
    System as HitboxSystem,
    Response,
    type Response as Collision,
    type Body as Hitbox,
} from 'detect-collisions';
import {assertValidShape, defineShape, type Shape} from 'object-shape-tester';
import {ParticleContainer, type Container, type ViewContainer} from 'pixi.js';
import {defineTypedCustomEvent, GenericListenTarget} from 'typed-event-target';
import {type StaticEntity2dParts} from './entity-suite.js';

export {System as HitboxSystem, type Response as Collision} from 'detect-collisions';

/**
 * Definition of entity assets used when defining an entity.
 *
 * @category Internal
 */
export type BaseEntityAssetDefinitions = Record<
    string,
    Omit<
        Asset,
        /** Asset names are derived from the entity and asset keys. */
        'assetName'
    >
>;

/**
 * A record of `Asset` entries.
 *
 * @category Internal
 */
export type BaseEntityAssets = Record<string, Asset>;

/**
 * Maps {@link BaseEntityAssetDefinitions} into full `Asset` instances.
 *
 * @category Internal
 */
export type MappedEntityAssets<Definitions extends BaseEntityAssetDefinitions | undefined> =
    Definitions extends undefined
        ? EmptyObject
        : {
              [Key in keyof Definitions]: Definitions[Key] & {assetName: string};
          };

/**
 * Parameters for {@link EntityStore2d.addEntity}. Flattens itself to an empty array if there are no
 * entity constructor params.
 *
 * @category Internal
 */
export type AddEntity2dParams<ThisConstructor extends Entity2dConstructor> =
    ThisConstructor extends {
        ConstructorArgsType: infer Args extends Entity2dConstructorParams<any, any>;
    }
        ? Args['params'] extends undefined
            ? []
            : [Args['params']]
        : ['ERROR: invalid entity constructor'];

/**
 * Parameters for the constructor of {@link EntityStore2d}.
 *
 * @category Internal
 */
export type EntityStore2dConstructorParams<State extends AnyObject = any> = {
    /**
     * A PixiJS [`Application`](https://pixijs.download/release/docs/app.Application.html) instance
     * from the [`pixi.js`](https://www.npmjs.com/package/pixi.js) package.
     */
    pixi: PixiApplication;
    state: State;
    assetLoader: AssetLoader;
} & PartialWithUndefined<{
    /**
     * A `System` instance from the
     * [`detect-collisions`](https://www.npmjs.com/package/detect-collisions) package. If this
     * property is omitted or `undefined`, the {@link EntityStore2d} instance will create its own.
     */
    customHitboxSystem?: HitboxSystem | undefined;
    /**
     * An array of all entity constructors that will be pre-registered with this
     * {@link EntityStore2d} instance.
     */
    preregisteredEntities: ReadonlyArray<Entity2dConstructor>;
}>;

/**
 * A constructor that creates an Entity, as well as the static entity data that should be attached
 * to it.
 *
 * @category Internal
 */
export type Entity2dConstructor = Constructor<BaseEntity2d> & StaticEntity2dParts;

function extractEntityFromHitbox(hitbox: Hitbox) {
    return hitbox.userData instanceof BaseEntity2d ? hitbox.userData : undefined;
}

function hasCollisionTargets(entity: BaseEntity2d) {
    return (
        (entity.entityDefinition.collidesWithSet?.size ??
            entity.entityDefinition.collidesWith?.length ??
            0) > 0
    );
}

function doesEntityCollideWith({
    entity,
    otherEntity,
}: Readonly<{
    entity: BaseEntity2d;
    otherEntity: BaseEntity2d;
}>) {
    return (
        entity.entityDefinition.collidesWithSet?.has(otherEntity.entityDefinition) ??
        entity.entityDefinition.collidesWith?.includes(otherEntity.entityDefinition) ??
        false
    );
}

function shouldCheckEntityCollision({
    firstEntity,
    secondEntity,
}: Readonly<{
    firstEntity: BaseEntity2d;
    secondEntity: BaseEntity2d;
}>) {
    return (
        doesEntityCollideWith({
            entity: firstEntity,
            otherEntity: secondEntity,
        }) ||
        doesEntityCollideWith({
            entity: secondEntity,
            otherEntity: firstEntity,
        })
    );
}

function shouldNotifyEntityOfCollision({
    entity,
    otherEntity,
}: Readonly<{
    entity: BaseEntity2d;
    otherEntity: BaseEntity2d;
}>) {
    return doesEntityCollideWith({
        entity,
        otherEntity,
    });
}

function createReversedCollision(collision: Readonly<Collision>) {
    const reversedCollision = new Response();
    reversedCollision.a = collision.b;
    reversedCollision.aInB = collision.bInA;
    reversedCollision.b = collision.a;
    reversedCollision.bInA = collision.aInB;
    reversedCollision.overlap = collision.overlap;
    reversedCollision.overlapN.x = -collision.overlapN.x;
    reversedCollision.overlapN.y = -collision.overlapN.y;
    reversedCollision.overlapV.x = -collision.overlapV.x;
    reversedCollision.overlapV.y = -collision.overlapV.y;

    return reversedCollision;
}

function hasAlreadyCheckedHitboxPair({
    checkedHitboxPairs,
    firstHitbox,
    secondHitbox,
}: Readonly<{
    checkedHitboxPairs: WeakMap<Hitbox, WeakSet<Hitbox>>;
    firstHitbox: Hitbox;
    secondHitbox: Hitbox;
}>) {
    return (
        checkedHitboxPairs.get(firstHitbox)?.has(secondHitbox) ||
        checkedHitboxPairs.get(secondHitbox)?.has(firstHitbox)
    );
}

function markHitboxPairAsChecked({
    checkedHitboxPairs,
    firstHitbox,
    secondHitbox,
}: Readonly<{
    checkedHitboxPairs: WeakMap<Hitbox, WeakSet<Hitbox>>;
    firstHitbox: Hitbox;
    secondHitbox: Hitbox;
}>) {
    const firstHitboxPairs = checkedHitboxPairs.get(firstHitbox);

    if (firstHitboxPairs) {
        firstHitboxPairs.add(secondHitbox);
    } else {
        checkedHitboxPairs.set(firstHitbox, new WeakSet([secondHitbox]));
    }
}

/** A collision system that skips pairs no entity observes before running SAT collision checks. */
export class EntityHitboxSystem extends HitboxSystem {
    protected checkedHitboxPairs: WeakMap<Hitbox, WeakSet<Hitbox>> | undefined;

    public override checkAll(
        ...[
            callback,
            response,
        ]: Parameters<HitboxSystem['checkAll']>
    ) {
        const previousCheckedHitboxPairs = this.checkedHitboxPairs;
        this.checkedHitboxPairs = new WeakMap();

        try {
            return this.all().some((hitbox: Hitbox) => {
                const entity = extractEntityFromHitbox(hitbox);

                return (
                    (!entity || hasCollisionTargets(entity)) &&
                    this.checkOne(hitbox, callback, response)
                );
            });
        } finally {
            this.checkedHitboxPairs = previousCheckedHitboxPairs;
        }
    }

    public override checkOne(
        ...[
            hitbox,
            callback,
            response,
        ]: Parameters<HitboxSystem['checkOne']>
    ) {
        const entity = extractEntityFromHitbox(hitbox);

        if (entity && !hasCollisionTargets(entity)) {
            return false;
        }

        return super.checkOne(hitbox, callback, response);
    }

    public override checkCollision(...hitboxes: Parameters<HitboxSystem['checkCollision']>) {
        const [
            firstHitbox,
            secondHitbox,
        ] = hitboxes;
        const checkedHitboxPairs = this.checkedHitboxPairs;

        if (
            checkedHitboxPairs &&
            hasAlreadyCheckedHitboxPair({
                checkedHitboxPairs,
                firstHitbox,
                secondHitbox,
            })
        ) {
            return false;
        }

        if (checkedHitboxPairs) {
            markHitboxPairAsChecked({
                checkedHitboxPairs,
                firstHitbox,
                secondHitbox,
            });
        }

        const firstEntity = extractEntityFromHitbox(firstHitbox);
        const secondEntity = extractEntityFromHitbox(secondHitbox);

        if (
            firstEntity &&
            secondEntity &&
            !shouldCheckEntityCollision({
                firstEntity,
                secondEntity,
            })
        ) {
            return false;
        }

        return super.checkCollision(...hitboxes);
    }
}

/**
 * The top level storage class of all entities. Add entities with {@link EntityStore2d.addEntity}.
 *
 * @category Internal
 */
export class EntityStore2d<State extends AnyObject = any> {
    /**
     * All current child entities.
     *
     * Instead of modifying this set, use {@link EntityStore2d.addEntity} or
     * {@link EntityStore2d.removeEntity}. If you must manually modify this set directly, you'll also
     * need to modify {@link EntityStore2d.entityInstanceMap}.
     */
    public readonly currentEntityInstances = new Set<BaseEntity2d>();
    /** If true, this entity store should no longer be used or operated upon. */
    public readonly isDestroyed: boolean = false;
    /** An internal mapping of all entity constructors to their current instances. */
    public readonly entityInstanceMap = new ConstructorInstanceMap();
    /** Original pixi app. */
    public readonly pixi: PixiApplication;
    /** Collision detection system. */
    public readonly hitboxSystem: HitboxSystem;
    /** A map of all entity keys to their registered Entity constructors. */
    public entityKeyConstructorMap: Record<string, Entity2dConstructor> = {};
    /** Listen target for events emitted from any child entities. */
    public listenTarget = new GenericListenTarget();
    public readonly state: State;
    public readonly assetLoader: AssetLoader;

    constructor(args: Readonly<EntityStore2dConstructorParams>) {
        this.pixi = args.pixi;
        this.assetLoader = args.assetLoader;
        this.hitboxSystem = args.customHitboxSystem || new EntityHitboxSystem();
        this.state = args.state;
        if (args.preregisteredEntities) {
            this.registerEntities({
                entities: args.preregisteredEntities,
                clearPreviousRegistrations: true,
            });
        }
    }

    /**
     * Load all the assets for all the given entities. Without this, assets will be loaded on demand
     * only.
     */
    public async loadEntityAssets(
        {
            entities,
            otherAssets,
        }: Readonly<{
            entities: ReadonlyArray<Entity2dConstructor>;
            otherAssets?: ReadonlyArray<Readonly<Asset>> | undefined;
        }>,
        options?: Readonly<AssetBulkLoaderLoadOptions> | undefined,
    ) {
        const assets: ReadonlyArray<Readonly<Asset>> = [
            ...(otherAssets || []),
            ...entities.flatMap((entity) => {
                return Object.values(entity.assets).map((asset) => {
                    return asset;
                });
            }),
        ];
        return await this.assetLoader.bulkLoadAssets(assets, options);
    }

    /**
     * Register a set of entities so that they can be deserialized (for example, when transferring
     * game state in across the network for multilayer).
     */
    public registerEntities({
        clearPreviousRegistrations,
        entities,
    }: Readonly<
        {
            entities: ReadonlyArray<Entity2dConstructor>;
        } & PartialWithUndefined<{
            /** If set to true, all previous registrations will be removed. */
            clearPreviousRegistrations: boolean;
        }>
    >) {
        if (clearPreviousRegistrations) {
            this.entityKeyConstructorMap = {};
        }
        entities.forEach((entity) => {
            this.entityKeyConstructorMap[entity.entityKey] = entity;
        });
    }

    /**
     * Runs `.update()` on all current entities and runs collision detection for all hitboxes. If
     * any entities get marked as destroyed during their update, then they will be removed from the
     * set of entities.
     *
     * @returns All detected hitbox collisions (if any).
     */
    public async updateAllEntities(updateParams: Readonly<EntityUpdateParams>): Promise<void> {
        if (this.isDestroyed) {
            throw new Error('Cannot operate on a destroyed entity store.');
        }
        for (const entity of this.currentEntityInstances) {
            /** Check if the entity was destroyed outside of an update cycle. */
            if (entity.isDestroyed) {
                entity.immediatelyDestroy();
                return;
            }
            await entity.update(updateParams);
            /** Check if the entity was destroyed while updating. */
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (entity.isDestroyed) {
                entity.immediatelyDestroy();
            }
        }

        this.hitboxSystem.update();

        const collisionPromises: Promise<void>[] = [];

        /**
         * This `checkAll` method is synchronous, so even though its using a callback it'll still
         * finish before this `updateAllEntities` method exits.
         */
        this.hitboxSystem.checkAll((response) => {
            const primaryEntity: BaseEntity2d | undefined =
                response.a.userData instanceof BaseEntity2d ? response.a.userData : undefined;
            const secondaryEntity: BaseEntity2d | undefined =
                response.b.userData instanceof BaseEntity2d ? response.b.userData : undefined;

            if (
                !primaryEntity ||
                !secondaryEntity ||
                primaryEntity.isDestroyed ||
                secondaryEntity.isDestroyed
            ) {
                return;
            }
            function trackCollisionResult(result: MaybePromise<void>) {
                if (result instanceof Promise) {
                    collisionPromises.push(result);
                }
            }

            if (
                shouldNotifyEntityOfCollision({
                    entity: primaryEntity,
                    otherEntity: secondaryEntity,
                })
            ) {
                trackCollisionResult(primaryEntity.collide(secondaryEntity, response));
            }

            if (
                shouldNotifyEntityOfCollision({
                    entity: secondaryEntity,
                    otherEntity: primaryEntity,
                })
            ) {
                trackCollisionResult(
                    secondaryEntity.collide(primaryEntity, createReversedCollision(response)),
                );
            }
        });
        await Promise.all(collisionPromises);
    }

    /** Get all current instances of the given entity class constructor. */
    public getEntities<T>(entityClassConstructor: AbstractConstructor<T> | Constructor<T>): Set<T> {
        return this.entityInstanceMap.getInstances(entityClassConstructor);
    }

    /** Remove an entity from the store. */
    public removeEntity(entity: BaseEntity2d) {
        if (this.isDestroyed) {
            throw new Error('Cannot operate on a destroyed entity store.');
        }
        this.currentEntityInstances.delete(entity);
        this.entityInstanceMap.remove(entity);
        if (entity instanceof ViewEntity2d && !entity.isDestroyed) {
            // eslint-disable-next-line unicorn/prefer-dom-node-remove
            this.pixi.stage.removeChild(entity.view);
            if (entity.hitbox) {
                this.hitboxSystem.remove(entity.hitbox);
            }
        }
    }

    /**
     * Create an entity instance by finding the registered constructor with the given `entityKey`
     * and then deserializing and passing the given `serializedParams` to that constructor.
     */
    public async deserializeEntity(
        entityKey: string,
        serializedParams: string | undefined,
    ): Promise<BaseEntity2d> {
        if (this.isDestroyed) {
            throw new Error('Cannot operate on a destroyed entity store.');
        }
        const entityConstructor = this.entityKeyConstructorMap[entityKey];
        if (!entityConstructor) {
            throw new Error(`No entity registered for key '${entityKey}'`);
        }

        return await this.addEntity(
            entityConstructor,
            entityConstructor.deserialize(serializedParams),
        );
    }

    /** Create a new instance of the given entity class and add it to this entity store. */
    public async addEntity<const NewEntityConstructor extends Entity2dConstructor>(
        entityClass: NewEntityConstructor,
        ...params: AddEntity2dParams<NoInfer<NewEntityConstructor>>
    ): Promise<InstanceType<NewEntityConstructor>> {
        if (this.isDestroyed) {
            throw new Error('Cannot operate on a destroyed entity store.');
        }

        if (!(entityClass.entityKey in this.entityKeyConstructorMap)) {
            this.entityKeyConstructorMap[entityClass.entityKey] = entityClass;
        }

        const child = new entityClass({
            entityStore: this,
            pixi: this.pixi,
            state: this.state,
            params: params[0],
            hitboxSystem: this.hitboxSystem,
        } satisfies Entity2dConstructorParams<any, any>);
        await child.initInstance();
        this.currentEntityInstances.add(child);
        this.entityInstanceMap.add(child);
        return child as InstanceType<NewEntityConstructor>;
    }

    /** Destroys the entity store and all entities contained inside it. */
    public destroy() {
        if (this.isDestroyed) {
            throw new Error('Entity store is already destroyed.');
        }
        this.currentEntityInstances.forEach((entity) => entity.destroy());
        makeWritable(this).isDestroyed = true;
        this.listenTarget.destroy();
        this.currentEntityInstances.clear();
        this.entityInstanceMap.destroy();
        delete (this as Writable<Partial<EntityStore2d>>).pixi;
        delete (this as Writable<Partial<EntityStore2d>>).hitboxSystem;
        delete (this as Writable<Partial<EntityStore2d>>).listenTarget;
    }
}

/**
 * Shape definition for {@link EntityPositionParams}.
 *
 * @category Util
 */
export const entityPositionParamsShape = defineShape({
    x: -1,
    y: -1,
});

/**
 * Base entity serialization. All entities should at least include these properties.
 *
 * @category Internal
 */
export type EntityPositionParams = typeof entityPositionParamsShape.runtimeType;

/**
 * Parameters for an entity's constructor.
 *
 * @category Internal
 */
export type Entity2dConstructorParams<
    State extends AnyObject = any,
    Params extends Record<string, any> | undefined = undefined,
> = (IsNever<Extract<Params, undefined | null>> extends true
    ? {
          params: Params;
      }
    : {
          params?: Params;
      }) & {
    state: State;
    paramsMap?: ParamsMap<NoInfer<Params>> | undefined;
    entityStore: EntityStore2d<State>;
    pixi: PixiApplication;
    hitboxSystem: HitboxSystem;
};

/**
 * Finds all keys from `Params` that match the value at the given `Key` in `OriginalObject`.
 *
 * @category Internal
 */
export type MatchingKeys<
    Key extends PropertyKey,
    Params extends Record<string, any> | undefined,
    OriginalObject extends AnyObject,
> =
    Params extends Record<string, any>
        ? ExtractKeysWithMatchingValues<Params, Extract<OriginalObject, Record<Key, any>>[Key]>
        : never;

/**
 * An object that controls which entity parameter projects get mapped to view and hitbox properties.
 * Values can be:
 *
 * - `true`: indicates that the property is mapped directly from params to that view or hitbox object.
 * - Omitted: the property is not mapped at all.
 * - A string: specifies the params key that this view or hitbox property is mapped to.
 */
export type ParamsMap<Params extends Record<string, any> | undefined = AnyObject> =
    IsEqual<Params, undefined> extends true
        ? undefined
        : PartialWithUndefined<{
              view: Partial<{
                  [Key in WritableKeysOf<ViewContainer> as IsNever<
                      MatchingKeys<Key, Params, ViewContainer>
                  > extends true
                      ? never
                      : Key]:
                      | (Key extends keyof Params
                            ? Params[Key] extends ViewContainer[Key]
                                ? true
                                : never
                            : never)
                      | MatchingKeys<Key, Params, ViewContainer>;
              }>;
              hitbox: Partial<{
                  [Key in WritableKeysOf<Hitbox> as IsNever<
                      MatchingKeys<Key, Params, Hitbox>
                  > extends true
                      ? never
                      : Key]:
                      | (Key extends keyof Params
                            ? Params[Key] extends Extract<Hitbox, Record<Key, any>>[Key]
                                ? true
                                : never
                            : never)
                      | MatchingKeys<Key, Params, Hitbox>;
              }>;
          }>;

/**
 * The bse of all entity-specific events.
 *
 * @category Internal
 */
export class EntityEvent<const Data = any> extends defineTypedCustomEvent<{
    data?: any;
    entityInstance: BaseEntity2d;
}>()('antha-entity-event') {
    public declare readonly detail: Readonly<
        undefined | void extends Data
            ? {
                  entityInstance: BaseEntity2d;
                  data?: never;
              }
            : {
                  entityInstance: BaseEntity2d;
                  data: Data;
              }
    >;

    constructor(
        detail: Readonly<
            undefined | void extends Data
                ? {
                      entityInstance: BaseEntity2d;
                      data?: never;
                  }
                : {
                      entityInstance: BaseEntity2d;
                      data: Data;
                  }
        >,
    ) {
        super({
            detail,
        });
    }
}

/**
 * Event emitted by all entities when they are destroyed.
 *
 * @category Internal
 */
export class EntityDestroyEvent extends EntityEvent<void> {}

/**
 * Default params shape for x, y position coordinates.
 *
 * Use with {@link position2dParamsMap}, or something similar.
 *
 * @category Internal
 */
export const position2dParamsShape = defineShape({
    x: -1,
    y: -1,
} satisfies Coords);

/**
 * Default value for the optional {@link ParamsMap}. This maps the top level params of `x` and `y` to
 * both `x` and `y` in the hitbox and view.
 *
 * Use with {@link position2dParamsShape}, or something similar.
 *
 * @category Internal
 */
export const position2dParamsMap = {
    hitbox: {
        x: true,
        y: true,
    } satisfies Record<keyof Coords, true>,
    view: {
        x: true,
        y: true,
    } satisfies Record<keyof Coords, true>,
} as const satisfies ParamsMap;

/**
 * Type for {@link BaseEntity2d.reverseParamsMap}.
 *
 * @category Internal
 */
export type ReverseParamsMap = Record<string, Partial<Record<'hitbox' | 'view', string[]>>>;

/**
 * The parameters given to entity update methods.
 *
 * @category Internal
 */
export type EntityUpdateParams = {
    msSinceLastUpdate: number;
};

/**
 * Base entity class, types, and functionality.
 *
 * @category Internal
 */
export abstract class BaseEntity2d<
    State extends AnyObject = any,
    Params extends Record<string, any> | undefined = any,
    EntityAssets extends BaseEntityAssetDefinitions | undefined = any,
> {
    /**
     * This key is used for deserialization of entities to track which class needs to be
     * constructed. You cannot have duplicate keys loaded at the same time.
     */
    public static readonly entityKey: string = 'BaseEntity';
    /** Entity classes this entity observes collisions with. Omit to observe none. */
    public static readonly collidesWith: ReadonlyArray<Entity2dConstructor> | undefined;
    /** Cached entity classes this entity observes collisions with. */
    public static readonly collidesWithSet: ReadonlySet<Entity2dConstructor> | undefined;
    /** Shape definition of this entity's parameters. */
    public static readonly paramsShape: Shape<AnyObject> | undefined;

    public static readonly assets:
        | MappedEntityAssets<BaseEntityAssetDefinitions | undefined>
        | undefined;

    /**
     * Defines which properties from {@link BaseEntity2d.params} will be mapped to hitbox and/or view
     * properties.
     */
    public static readonly paramsMap: ParamsMap | undefined;
    /**
     * A mapping from params properties to hitbox or view properties, making it easy to map params
     * values.
     */
    public static readonly reverseParamsMap: ReverseParamsMap | undefined;
    /** Parses the serialized params generated by {@link BaseEntity2d.serialize}. */
    public static deserialize(serialized: string | undefined): AnyObject | undefined {
        const deserialized = serialized ? JSON.parse(serialized) : undefined;
        if (this.paramsShape) {
            assertValidShape(deserialized, this.paramsShape);
        } else {
            assert.isUndefined(deserialized);
        }

        return deserialized;
    }

    /**
     * Dispatch an event. This will be dispatched through this entity's entity store (so listen for
     * the event on the store).
     */
    public dispatch(event: EntityEvent | EntityDestroyEvent) {
        /** Cast to optionally undefined to account for destruction. */
        (this.entityStore as typeof this.entityStore | undefined)?.listenTarget.dispatch(event);
    }

    /** If true, this entity should no longer be used or operated upon. */
    public readonly isDestroyed: boolean = false;
    /** Static definition used to construct this entity. */
    public readonly entityDefinition: Entity2dConstructor;
    protected readonly abortController = new AbortController();
    /** An `AbortSignal` that triggers when the entity is destroyed. */
    public readonly abortSignal: AbortSignal = this.abortController.signal;
    public hitbox: Hitbox<this> | undefined;

    /** The entity store to add all entities to. */
    public readonly entityStore: EntityStore2d<State>;

    /** Writable entity params. These should be serializable. */
    public readonly params: Params;
    /** Original pixi app. */
    public readonly pixi: PixiApplication;
    /** Collision detection system. */
    public readonly hitboxSystem: HitboxSystem;
    public getAsset: EntityAssetAccessor<MappedEntityAssets<EntityAssets>>;

    constructor(args: Readonly<Entity2dConstructorParams<NoInfer<State>, NoInfer<Params>>>) {
        this.entityDefinition = this.constructor as Entity2dConstructor;
        this.entityStore = args.entityStore;
        this.params = args.params as Params;
        this.pixi = args.pixi;
        this.hitboxSystem = args.hitboxSystem;
        this.state = args.state;

        const assets = (this.constructor as typeof ViewEntity2d).assets;

        this.getAsset = createEntityAssetAccessor<MappedEntityAssets<EntityAssets>>({
            assetLoader: args.entityStore.assetLoader,
            entityAssets: assets,
        });
    }

    /**
     * Called every game tick. Run all entity updates in here. This should be overridden in all
     * entity definition classes.
     */
    public abstract update(updateParams: Readonly<EntityUpdateParams>): MaybePromise<void>;

    /** Called after construction to perform async initialization (e.g. creating views). */
    public initInstance(): MaybePromise<void> {
        return;
    }

    /** The game's current state. */
    public state: State;

    /** Add a new entity to the entity store. */
    public async addEntity<const NewEntityConstructor extends Entity2dConstructor>(
        entityClass: NewEntityConstructor,
        ...params: AddEntity2dParams<NoInfer<NewEntityConstructor>>
    ): Promise<InstanceType<NewEntityConstructor>> {
        if (this.isDestroyed) {
            throw new Error('Cannot add entity through destroyed entity.');
        }
        return await this.entityStore.addEntity(entityClass, ...params);
    }

    /** Marks the entity for destruction in the next entity store update. */
    public destroy() {
        this.abortController.abort();
        makeWritable(this).isDestroyed = true;
    }

    /**
     * Immediately destroy the current entity, stop its updates.
     *
     * This is probably not what you want to use! See {@link BaseEntity2d.destroy} instead.
     */
    public immediatelyDestroy() {
        this.abortController.abort();
        makeWritable(this).isDestroyed = true;
        (this.entityStore as typeof this.entityStore | undefined)?.removeEntity(this);
        this.dispatch(
            new EntityDestroyEvent({
                entityInstance: this,
            }),
        );
        delete (this as Writable<Partial<BaseEntity2d>>).entityStore;
        delete (this as Writable<Partial<BaseEntity2d>>).hitboxSystem;
        delete (this as Writable<Partial<BaseEntity2d>>).params;
    }

    /**
     * This method is call whenever this entity's hitbox (if it has one) collides with another
     * hitbox. It will be called for each individual collision. Override this to do something about
     * it.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public collide(otherEntity: BaseEntity2d, collision: Readonly<Collision>): MaybePromise<void> {}

    /**
     * Serialize the entity params for sharing across the network (for multiplayer play). By default
     * this simply calls `JSON.stringify` on `this.params`. This method must be overridden if your
     * entity has params that are not JSON compatible.
     */
    public serialize(): string | undefined {
        return this.params ? JSON.stringify(this.params) : undefined;
    }
}

/**
 * Output of {@link ViewEntity2d.createView}.
 *
 * @category Internal
 */
export type ViewCreation2d = {
    /**
     * A view for rendering. Create with, for example, [`new
     * AnimatedSprite`](https://pixijs.download/release/docs/scene.AnimatedSprite.html) or [`new
     * Graphics`](https://pixijs.download/release/docs/scene.Graphics.html), etc. imported from the
     * [`pixi.js`](https://www.npmjs.com/package/pixi.js) package.
     */
    view?: Container | undefined;
    /**
     * A Body instance for hitbox collision detection. Create one with, for example,
     * `this.hitboxSystem.createBox()` or import directly from the
     * [`detect-collisions`](https://www.npmjs.com/package/detect-collisions) package, like with
     * [`new Circle`](https://prozi.github.io/detect-collisions/classes/Circle.html#constructor).
     *
     * This property optional, if a hitbox is not provided, collision detection will not be
     * calculated for this entity.
     */
    hitbox?: Hitbox | undefined;
};

/**
 * Creates async accessors for all entity assets.
 *
 * @category Internal
 */
export type EntityAssetAccessor<EntityAssets extends BaseEntityAssetDefinitions | undefined> =
    EntityAssets extends undefined
        ? EmptyObject
        : {
              [Key in keyof EntityAssets]: () => Promise<
                  AssetValue<NonNullable<EntityAssets>[Key]>
              >;
          };

function createEntityAssetAccessor<EntityAssets extends BaseEntityAssets | undefined = any>({
    assetLoader,
    entityAssets,
}: Readonly<{
    entityAssets: EntityAssets | undefined | EmptyObject;
    assetLoader: AssetLoader;
}>): EntityAssetAccessor<EntityAssets> {
    if (!entityAssets || check.isEmpty(entityAssets)) {
        return {} as EntityAssetAccessor<EntityAssets>;
    }

    return mapObjectValues(entityAssets, (key, asset) => {
        return async () => {
            return assetLoader.loadIndividualAsset({
                asset,
            });
        };
    }) satisfies Record<
        keyof EntityAssets,
        () => Promise<any>
    > as EntityAssetAccessor<EntityAssets>;
}

/**
 * Base view entity class, types, and functionality.
 *
 * @category Internal
 */
export abstract class ViewEntity2d<
    State extends AnyObject = any,
    Params extends Record<string, any> | undefined = any,
    EntityAssets extends BaseEntityAssetDefinitions | undefined = any,
> extends BaseEntity2d<State, Params, EntityAssets> {
    /** The entity's PixiJS view. */
    public view!: Container;

    /** Creates the view and hitbox, adds the view to the stage, and sets up the params proxy. */
    public override async initInstance() {
        const {view, hitbox} = await this.createView();

        if (view) {
            this.view = view;
            this.pixi.stage.addChild(this.view);
        } else {
            this.view = new ParticleContainer();
            this.view.visible = false;
        }

        if (hitbox) {
            this.hitbox = hitbox;
            this.hitbox.userData = this;
            this.hitboxSystem.insert(this.hitbox);
        }
        this.wrapParamsInProxy();
    }

    constructor(args: Readonly<Entity2dConstructorParams<NoInfer<State>, NoInfer<Params>>>) {
        super(args);
    }

    /** Wrap entity params in a proxy that maps changes to the view and hitbox properties. */
    protected wrapParamsInProxy(): void {
        const paramsMap = (this.constructor as typeof ViewEntity2d).paramsMap;
        const reverseParamsMap = (this.constructor as typeof ViewEntity2d).reverseParamsMap;
        const params = this.params;

        if (!params || !paramsMap || !reverseParamsMap) {
            return;
        }

        makeWritable(this).params = new Proxy(params, {
            set: (target, propertyKey, value, receiver) => {
                if (propertyKey in params && check.hasKey(reverseParamsMap, propertyKey)) {
                    const mappings = reverseParamsMap[propertyKey];

                    if (this.hitbox && mappings?.hitbox) {
                        mappings.hitbox.forEach((mapToKey) => {
                            (this.hitbox as AnyObject)[mapToKey] = value;
                        });
                    }
                    if (mappings?.view) {
                        mappings.view.forEach((mapToKey) => {
                            (this.view as AnyObject)[mapToKey] = value;
                        });
                    }
                }

                return Reflect.set(target, propertyKey, value, receiver);
            },
        });

        /** Propagate initial params. */
        getObjectTypedEntries(this.params).forEach(
            ([
                key,
                value,
            ]) => {
                (this.params as AnyObject)[key] = value;
            },
        );
    }

    /**
     * Creates the entity's PixiJS view. This will be called on entity construction and added to the
     * PixiJS application stage.
     */
    public abstract createView(): MaybePromise<ViewCreation2d>;

    /** Detects if the current entity is still within the bounds of the render canvas. */
    public isInBounds(
        options: PartialWithUndefined<{
            /**
             * If `true`, the entire entity's bounds must be within the canvas's bounds. If `false`,
             * any portion of the entity being within the canvas bounds is counted.
             *
             * @default false
             */
            entirely?: boolean;
        }> = {},
    ): boolean {
        if (this.isDestroyed) {
            throw new Error('Cannot check bounds on destroyed entity.');
        } else if (options.entirely) {
            return this.pixi.screen.containsRect(this.view.getBounds().rectangle);
        } else {
            return this.pixi.screen.intersects(this.view.getBounds().rectangle);
        }
    }

    /**
     * Immediately destroy the current entity, stop its updates, and remove it from the view.
     *
     * This is probably not what you want to use! See {@link BaseEntity2d.destroy} instead.
     */
    public override immediatelyDestroy() {
        (this.view as typeof this.view | undefined)?.destroy({
            children: true,
        });
        if (this.hitbox) {
            this.hitboxSystem.remove(this.hitbox);
        }
        super.immediatelyDestroy();
        delete (this as Writable<Partial<ViewEntity2d>>).view;
    }
}
