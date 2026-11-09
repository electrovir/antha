import {type PartialWithUndefined} from '@augment-vir/common';
import {type Shape} from 'object-shape-tester';

/**
 * How a physics body moves.
 *
 * @category Main
 */
export enum BodyType {
    /** Never moves, like walls and floors. */
    Static = 'static',
    /** Moves only by the velocity you set, ignoring forces and collisions. */
    Kinematic = 'kinematic',
    /** Moved by forces, gravity, and collisions. */
    Dynamic = 'dynamic',
}

/**
 * The physics body of an entity class, built from a physics engine's `ShapeDefinition`.
 *
 * @category Internal
 */
export type BaseEntityPhysicsDefinition<ShapeDefinition> = {
    type: BodyType;
} & PartialWithUndefined<{
    /** Entities with no shapes never touch anything. */
    shapes: ReadonlyArray<ShapeDefinition>;
    /** Prevents the body from rotating. */
    fixedRotation: boolean;
    /**
     * Slows the body down. Each step is split into several smaller solver steps, and each of those
     * divides linear velocity by `1 + seconds * linearDamping`, where `seconds` is the length of
     * the smaller step.
     */
    linearDamping: number;
    angularDamping: number;
}>;

/**
 * A pair of entity ids whose shapes started or stopped touching.
 *
 * @category Internal
 */
export type ContactPair = [
    number,
    number,
];

/**
 * Contacts reported by one {@link PhysicsWorld.step}.
 *
 * @category Internal
 */
export type ContactEvents = {
    started: ContactPair[];
    ended: ContactPair[];
};

/**
 * Which collision categories a body is in and which it touches, as bitmasks.
 *
 * @category Internal
 */
export type CollisionFilter = {
    category: bigint;
    mask: bigint;
};

/**
 * The most collision categories one world supports. Box2D and Box3D both use 64-bit filters.
 *
 * @category Internal
 */
export const maxCollisionCategories = 64;

/**
 * The parts of an entity's physics body that the entity store uses.
 *
 * @category Internal
 */
export type EntityBody<BodyState = unknown> = {
    /** Saves the transform the last step produced, for interpolating views. */
    recordStep(): void;
    /** Reads everything about the body that changes as it moves, for snapshots. */
    getState(): BodyState;
};

/**
 * A physics engine's world, as the entity store drives it. Each physics engine (like Box2D) gets
 * its own implementation.
 *
 * @category Internal
 */
export type PhysicsWorld<Definition, Body extends EntityBody, InitialBodyState> = {
    /** Validates the output of every body's `getState()` when loading snapshots. */
    readonly bodyStateShape: Shape;
    /** Without a `definition`, creates a body that only holds a position. */
    createBody(
        params: Readonly<{
            definition: Readonly<Definition> | undefined;
            filter: Readonly<CollisionFilter>;
            /** Reported back in {@link ContactPair} entries. */
            entityId: number;
            bodyState: Readonly<InitialBodyState>;
        }>,
    ): Body;
    /** Does nothing if the body was already destroyed. */
    destroyBody(body: Body): void;
    /** Advances the world by one step. */
    step(stepSeconds: number): ContactEvents;
    /**
     * Destroys every body and starts a fresh internal world, so that loading the same snapshot
     * builds the same world on every peer.
     */
    reset(): void;
    /** Releases the world. The entity store calls this when it is destroyed. */
    destroy(): void;
};

/**
 * Any {@link PhysicsWorld}.
 *
 * @category Internal
 */
export type AnyPhysicsWorld = PhysicsWorld<any, EntityBody, any>;

/**
 * The body type created by a {@link PhysicsWorld}.
 *
 * @category Internal
 */
export type BodyOf<World extends AnyPhysicsWorld> = ReturnType<World['createBody']>;

/**
 * The body definition accepted by a {@link PhysicsWorld}.
 *
 * @category Internal
 */
export type PhysicsDefinitionOf<World extends AnyPhysicsWorld> = NonNullable<
    Parameters<World['createBody']>[0]['definition']
>;

/**
 * Where a new body of a {@link PhysicsWorld} starts.
 *
 * @category Internal
 */
export type InitialBodyStateOf<World extends AnyPhysicsWorld> = Parameters<
    World['createBody']
>[0]['bodyState'];

/**
 * The snapshot state of a body of a {@link PhysicsWorld}.
 *
 * @category Internal
 */
export type BodyStateOf<World extends AnyPhysicsWorld> = ReturnType<BodyOf<World>['getState']>;
