import {type AssetLoader} from '@antha/asset';
import {type ModExecuteParams} from '@antha/engine';
import {type PixiApplication} from '@antha/graphics-2d';
import {hashObject} from '@antha/util';
import {assert} from '@augment-vir/assert';
import {
    awaitedBlockingMap,
    ConstructorInstanceMap,
    makeWritable,
    type AbstractConstructor,
    type AnyObject,
    type Constructor,
    type MaybePromise,
    type PartialWithUndefined,
    type Writable,
} from '@augment-vir/common';
import {type System as HitboxSystem} from 'detect-collisions';
import {assertValidShape, defineShape, optionalShape} from 'object-shape-tester';
import {GenericListenTarget} from 'typed-event-target';
import {
    createReversedCollision,
    EntityHitboxSystem,
    shouldNotifyEntityOfCollision,
} from './entity-hitbox-system.js';
import {
    BaseEntity2d,
    ViewEntity2d,
    type Entity2dConstructor,
    type Entity2dConstructorParams,
} from './entity.js';

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
 * Shape definition for {@link SerializedEntity2d}.
 *
 * @category Internal
 */
export const serializedEntity2dShape = defineShape({
    entityKey: '',
    serializedParams: optionalShape('', {
        alsoUndefined: true,
    }),
});

/**
 * One entity in a snapshot from {@link EntityStore2d.createSnapshot}.
 *
 * @category Internal
 */
export type SerializedEntity2d = typeof serializedEntity2dShape.runtimeType;

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
     */
    public async updateAllEntities(
        updateParams: Readonly<ModExecuteParams<NoInfer<State>>>,
    ): Promise<void> {
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

    /** Runs presentation-only updates for every entity without simulating collisions. */
    public async renderAllEntities(
        renderParams: Readonly<ModExecuteParams<NoInfer<State>>>,
    ): Promise<void> {
        if (this.isDestroyed) {
            throw new Error('Cannot operate on a destroyed entity store.');
        }

        for (const entity of this.currentEntityInstances) {
            if (entity.isDestroyed) {
                return;
            }

            await entity.render(renderParams);
        }
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

    /**
     * Serializes every current entity, in update order, for {@link EntityStore2d.loadSnapshot}.
     * Entities that are marked destroyed but not yet removed are skipped.
     */
    public createSnapshot(): SerializedEntity2d[] {
        if (this.isDestroyed) {
            throw new Error('Cannot operate on a destroyed entity store.');
        }

        return [...this.currentEntityInstances]
            .filter((entity) => !entity.isDestroyed)
            .map((entity) => {
                return {
                    entityKey: entity.entityDefinition.entityKey,
                    serializedParams: entity.serialize(),
                };
            });
    }

    /**
     * Hashes {@link EntityStore2d.createSnapshot} with `hashObject` from `@antha/util`, so it covers
     * exactly what {@link BaseEntity2d.serialize} covers. Compare this across lock-step peers to
     * detect desyncs.
     */
    public hashEntities() {
        return hashObject(this.createSnapshot());
    }

    /**
     * Immediately destroys every current entity and recreates the entities from a snapshot made by
     * {@link EntityStore2d.createSnapshot}, in the same order. Only entity params are restored: any
     * state an entity keeps outside of its params is lost, so lock-step peers must all load the
     * snapshot on the same frame to stay in sync. Every entity class in the snapshot must be
     * registered in this store (see `preregisteredEntities`).
     *
     * The snapshot is validated against {@link serializedEntity2dShape} before any entity is
     * destroyed, so a malformed snapshot throws and leaves the current entities in place.
     */
    public async loadSnapshot(snapshot: ReadonlyArray<Readonly<SerializedEntity2d>>) {
        assert.isArray(snapshot, 'Entity snapshot must be an array.');
        snapshot.forEach((serializedEntity, index) => {
            assertValidShape(
                serializedEntity,
                serializedEntity2dShape,
                {},
                `Invalid entity snapshot entry at index ${index}`,
            );
        });

        this.destroyAllEntities();

        /**
         * `addEntity` inserts each entity only after its async init finishes, so creating them in
         * parallel could order the store differently on each peer.
         */
        return await awaitedBlockingMap(snapshot, async (serializedEntity) => {
            return await this.deserializeEntity(
                serializedEntity.entityKey,
                serializedEntity.serializedParams,
            );
        });
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

    /** Immediately destroys every current entity while leaving the entity store usable. */
    public destroyAllEntities() {
        if (this.isDestroyed) {
            throw new Error('Cannot operate on a destroyed entity store.');
        }
        this.currentEntityInstances.forEach((entity) => entity.immediatelyDestroy());
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
