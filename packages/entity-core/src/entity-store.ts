import {type AssetLoader} from '@antha/asset';
import {type ModExecuteParams} from '@antha/engine';
import {hashObject} from '@antha/util';
import {assert} from '@augment-vir/assert';
import {
    awaitedBlockingMap,
    awaitedForEach,
    ConstructorInstanceMap,
    makeWritable,
    type AbstractConstructor,
    type AnyObject,
    type Constructor,
    type PartialWithUndefined,
    type Writable,
} from '@augment-vir/common';
import {convertDuration, type AnyDuration} from 'date-vir';
import {assertValidShape, defineShape, optionalShape, type Shape} from 'object-shape-tester';
import {GenericListenTarget} from 'typed-event-target';
import {type BaseEntity, type EntityConstructor, type EntityConstructorParams} from './entity.js';
import {
    type AnyPhysicsWorld,
    type BodyStateOf,
    type ContactPair,
    type InitialBodyStateOf,
} from './physics-world.js';

/**
 * Options for {@link EntityStore.addEntity}.
 *
 * @category Internal
 */
export type AddEntityOptions<Params, InitialBodyState> = (Params extends undefined
    ? {
          params?: undefined;
      }
    : {
          params: Params;
      }) &
    InitialBodyState;

/**
 * Parameters for {@link EntityStore.addEntity}. The options are optional when the entity has no
 * params.
 *
 * @category Internal
 */
export type AddEntityParams<
    ThisConstructor extends EntityConstructor,
    World extends AnyPhysicsWorld = AnyPhysicsWorld,
> = ThisConstructor extends {
    ConstructorArgsType: infer Args extends EntityConstructorParams<any, any>;
}
    ? Args['params'] extends undefined
        ? [options?: AddEntityOptions<undefined, InitialBodyStateOf<World>>]
        : [options: AddEntityOptions<Args['params'], InitialBodyStateOf<World>>]
    : ['ERROR: invalid entity constructor'];

/**
 * Parameters for the constructor of {@link EntityStore}.
 *
 * @category Internal
 */
export type EntityStoreConstructorParams<
    State extends AnyObject = any,
    World extends AnyPhysicsWorld = AnyPhysicsWorld,
> = {
    state: State;
    assetLoader: AssetLoader;
    /** The world every entity's body lives in. The store destroys it when the store is destroyed. */
    physicsWorld: World;
} & PartialWithUndefined<{
    /**
     * How much time each {@link EntityStore.updateAllEntities} call simulates. Shorter steps cost
     * more but let fast bodies collide more accurately.
     *
     * @default {seconds: 1 / 120}
     */
    stepDuration: AnyDuration;
    /**
     * An array of all entity constructors that will be pre-registered with this {@link EntityStore}
     * instance.
     */
    preregisteredEntities: ReadonlyArray<EntityConstructor>;
}>;

/**
 * Creates the shape of one entity in a snapshot, given its physics engine's body state shape.
 *
 * @category Internal
 */
export function defineSerializedEntityShape<const BodyStateShape extends Shape>(
    bodyStateShape: BodyStateShape,
) {
    return defineShape({
        entityKey: '',
        serializedParams: optionalShape('', {
            alsoUndefined: true,
        }),
        body: bodyStateShape,
    });
}

/**
 * One entity in a snapshot from {@link EntityStore.createSnapshot}.
 *
 * @category Internal
 */
export type SerializedEntity<World extends AnyPhysicsWorld = AnyPhysicsWorld> = {
    entityKey: string;
    serializedParams?: string | undefined;
    body: BodyStateOf<World>;
};

const defaultStepDuration: AnyDuration = {
    seconds: 1 / 120,
};

/**
 * The top level storage class of all entities. Add entities with {@link EntityStore.addEntity}.
 * Entity packages (like `@antha/entity-2d`) extend this to place views.
 *
 * @category Internal
 */
export abstract class EntityStore<
    State extends AnyObject = any,
    World extends AnyPhysicsWorld = AnyPhysicsWorld,
    Entity extends BaseEntity<any, any, any, World> = BaseEntity<any, any, any, World>,
> {
    /**
     * All current child entities.
     *
     * Instead of modifying this set, use {@link EntityStore.addEntity} or
     * {@link EntityStore.removeEntity}. If you must manually modify this set directly, you'll also
     * need to modify {@link EntityStore.entityInstanceMap}.
     */
    public readonly currentEntityInstances = new Set<Entity>();
    /** If true, this entity store should no longer be used or operated upon. */
    public readonly isDestroyed: boolean = false;
    /** An internal mapping of all entity constructors to their current instances. */
    public readonly entityInstanceMap = new ConstructorInstanceMap();
    /** The world every entity's body lives in. */
    public readonly physicsWorld: World;
    /** A map of all entity keys to their registered Entity constructors. */
    public entityKeyConstructorMap: Record<string, EntityConstructor> = {};
    /** Listen target for events emitted from any child entities. */
    public listenTarget = new GenericListenTarget();
    /** The game's current state. */
    public readonly state: State;
    /** Loads entity assets. */
    public readonly assetLoader: AssetLoader;
    /** How many milliseconds each {@link EntityStore.updateAllEntities} call simulates. */
    public readonly stepMs: number;
    /**
     * The `performance.now()` time that the most recent step represents. Renders interpolate views
     * between the last two steps by how far the current time is past this. Clock owners that run
     * several steps at once should set it to the time the last step would ideally have run at.
     */
    public lastStepTime: number | undefined;
    protected nextEntityId = 1;
    protected readonly entitiesById = new Map<number, Entity>();
    /** Validates snapshot entries before {@link EntityStore.loadSnapshot} destroys anything. */
    protected readonly serializedEntityShape: Shape;

    constructor(args: Readonly<EntityStoreConstructorParams<State, World>>) {
        this.assetLoader = args.assetLoader;
        this.state = args.state;
        this.physicsWorld = args.physicsWorld;
        this.serializedEntityShape = defineSerializedEntityShape(args.physicsWorld.bodyStateShape);
        this.stepMs = convertDuration(args.stepDuration || defaultStepDuration, {
            milliseconds: true,
        }).milliseconds;
        if (args.preregisteredEntities) {
            this.registerEntities({
                entities: args.preregisteredEntities,
                clearPreviousRegistrations: true,
            });
        }
    }

    /**
     * Moves an entity's view to its body's transform, blended between the last two steps.
     *
     * @param progress From 0 (the second most recent step) to 1 (the most recent step).
     */
    protected abstract placeView(entity: Entity, progress: number): void;

    /** Takes an entity's view off the screen. Called by {@link EntityStore.removeEntity}. */
    protected abstract detachView(entity: Entity): void;

    /** @throws Error if this store has been destroyed. */
    protected assertNotDestroyed() {
        if (this.isDestroyed) {
            throw new Error('Cannot operate on a destroyed entity store.');
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
            entities: ReadonlyArray<EntityConstructor>;
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
     * Advances the game by one physics step: runs `.update()` on every entity, steps the physics
     * world by {@link EntityStore.stepMs}, then calls the contact hooks. Entities marked as
     * destroyed are removed before they update.
     */
    public async updateAllEntities(updateParams: Readonly<ModExecuteParams<NoInfer<State>>>) {
        this.assertNotDestroyed();

        for (const entity of this.currentEntityInstances) {
            /** Check if the entity was destroyed outside of an update cycle. */
            if (entity.isDestroyed) {
                entity.immediatelyDestroy();
                continue;
            }
            await entity.update(updateParams);
            /** Check if the entity was destroyed while updating. */
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (entity.isDestroyed) {
                entity.immediatelyDestroy();
            }
        }

        const contacts = this.physicsWorld.step(this.stepMs / 1000);
        this.lastStepTime = performance.now();
        this.currentEntityInstances.forEach((entity) => entity.physics.recordStep());

        await this.callContactHooks(contacts.started, (entity, otherEntity) => {
            return entity.contactStart(otherEntity);
        });
        await this.callContactHooks(contacts.ended, (entity, otherEntity) => {
            return entity.contactEnd(otherEntity);
        });
    }

    /** Calls `callHook` on both entities of each pair, skipping pairs where either entity is gone. */
    protected async callContactHooks(
        pairs: ReadonlyArray<Readonly<ContactPair>>,
        callHook: (entity: Entity, otherEntity: Entity) => unknown,
    ) {
        await awaitedForEach(
            pairs,
            async ([
                firstId,
                secondId,
            ]) => {
                const firstEntity = this.entitiesById.get(firstId);
                const secondEntity = this.entitiesById.get(secondId);

                if (
                    !firstEntity ||
                    !secondEntity ||
                    firstEntity.isDestroyed ||
                    secondEntity.isDestroyed
                ) {
                    return;
                }

                await callHook(firstEntity, secondEntity);
                await callHook(secondEntity, firstEntity);
            },
        );
    }

    /**
     * Moves every view to its body's transform, blended between the last two steps by how much time
     * has passed since the last one, then runs `.render()` on every entity.
     */
    public async renderAllEntities(renderParams: Readonly<ModExecuteParams<NoInfer<State>>>) {
        this.assertNotDestroyed();

        const progress =
            this.lastStepTime == undefined
                ? 1
                : Math.min(Math.max((performance.now() - this.lastStepTime) / this.stepMs, 0), 1);

        for (const entity of this.currentEntityInstances) {
            if (entity.isDestroyed) {
                continue;
            }

            this.placeView(entity, progress);
            await entity.render(renderParams);
        }
    }

    /** Get all current instances of the given entity class constructor. */
    public getEntities<T>(entityClassConstructor: AbstractConstructor<T> | Constructor<T>): Set<T> {
        return this.entityInstanceMap.getInstances(entityClassConstructor);
    }

    /** Remove an entity, and its body and view, from the store. */
    public removeEntity(entity: Entity) {
        this.assertNotDestroyed();
        this.currentEntityInstances.delete(entity);
        this.entityInstanceMap.remove(entity);
        this.entitiesById.delete(entity.entityId);
        this.physicsWorld.destroyBody(entity.physics);
        this.detachView(entity);
    }

    /**
     * Create an entity instance by finding the registered constructor with the given `entityKey`
     * and then deserializing and passing the given `serializedParams` to that constructor.
     */
    public async deserializeEntity({
        entityKey,
        serializedParams,
        body,
    }: Readonly<SerializedEntity<World>>): Promise<Entity> {
        this.assertNotDestroyed();
        const entityConstructor = this.entityKeyConstructorMap[entityKey];
        if (!entityConstructor) {
            throw new Error(`No entity registered for key '${entityKey}'`);
        }

        return (await this.addEntity(entityConstructor, {
            ...(body satisfies BodyStateOf<World> as AnyObject),
            params: entityConstructor.deserialize(serializedParams),
        })) satisfies BaseEntity as Entity;
    }

    /**
     * Serializes every current entity, in update order, for {@link EntityStore.loadSnapshot}.
     * Entities that are marked destroyed but not yet removed are skipped.
     */
    public createSnapshot(): SerializedEntity<World>[] {
        this.assertNotDestroyed();

        return [...this.currentEntityInstances]
            .filter((entity) => !entity.isDestroyed)
            .map((entity) => {
                return {
                    entityKey: entity.entityDefinition.entityKey,
                    serializedParams: entity.serialize(),
                    body: entity.physics.getState() as BodyStateOf<World>,
                };
            });
    }

    /**
     * Hashes {@link EntityStore.createSnapshot} with `hashObject` from `@antha/util`, so it covers
     * every entity's params and body state. Compare this across lock-step peers to detect desyncs.
     */
    public hashEntities() {
        return hashObject(this.createSnapshot());
    }

    /**
     * Immediately destroys every current entity, resets the physics world, and recreates the
     * entities from a snapshot made by {@link EntityStore.createSnapshot}, in the same order. Only
     * entity params and body state are restored. The physics engine's internal state (such as which
     * contacts are already touching) starts over, so lock-step peers must all load the snapshot on
     * the same frame to stay in sync. Every entity class in the snapshot must be registered in this
     * store (see `preregisteredEntities`).
     *
     * The snapshot is validated before any entity is destroyed, so a malformed snapshot throws and
     * leaves the current entities in place.
     */
    public async loadSnapshot(snapshot: ReadonlyArray<Readonly<SerializedEntity<World>>>) {
        assert.isArray(snapshot, 'Entity snapshot must be an array.');
        snapshot.forEach((serializedEntity, index) => {
            assertValidShape(
                serializedEntity,
                this.serializedEntityShape,
                {},
                `Invalid entity snapshot entry at index ${index}`,
            );
        });

        this.destroyAllEntities();
        this.physicsWorld.reset();
        this.lastStepTime = undefined;

        /**
         * `addEntity` inserts each entity only after its async init finishes, so creating them in
         * parallel could order the store differently on each peer.
         */
        return await awaitedBlockingMap(snapshot, async (serializedEntity) => {
            return await this.deserializeEntity(serializedEntity);
        });
    }

    /** Create a new instance of the given entity class and add it to this entity store. */
    public async addEntity<const NewEntityConstructor extends EntityConstructor>(
        entityClass: NewEntityConstructor,
        ...[options]: AddEntityParams<NoInfer<NewEntityConstructor>, World>
    ): Promise<InstanceType<NewEntityConstructor>> {
        this.assertNotDestroyed();

        if (!(entityClass.entityKey in this.entityKeyConstructorMap)) {
            this.entityKeyConstructorMap[entityClass.entityKey] = entityClass;
        }

        const {params, ...bodyState} = (options || {}) satisfies AnyObject as AnyObject;
        const entityId = this.nextEntityId++;
        const child = new entityClass({
            entityStore: this,
            state: this.state,
            params,
            entityId,
            bodyState: bodyState satisfies AnyObject as InitialBodyStateOf<World>,
        } satisfies EntityConstructorParams<any, any, World>);
        await child.initInstance();
        /** Every entity class in a store extends the store's own base entity class. */
        const entity = child satisfies BaseEntity as Entity;
        this.currentEntityInstances.add(entity);
        this.entityInstanceMap.add(child);
        this.entitiesById.set(entityId, entity);
        return child as InstanceType<NewEntityConstructor>;
    }

    /** Immediately destroys every current entity while leaving the entity store usable. */
    public destroyAllEntities() {
        this.assertNotDestroyed();
        this.currentEntityInstances.forEach((entity) => entity.immediatelyDestroy());
    }

    /** Destroys the entity store, all entities contained inside it, and its physics world. */
    public destroy() {
        if (this.isDestroyed) {
            throw new Error('Entity store is already destroyed.');
        }
        this.currentEntityInstances.forEach((entity) => entity.destroy());
        makeWritable(this).isDestroyed = true;
        this.listenTarget.destroy();
        this.currentEntityInstances.clear();
        this.entitiesById.clear();
        this.entityInstanceMap.destroy();
        this.physicsWorld.destroy();
        delete (this as Writable<Partial<EntityStore>>).listenTarget;
    }
}
