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
    /**
     * Slows the body down. Each step is split into several smaller solver steps, and each of those
     * divides linear velocity by `1 + seconds * linearDamping`, where `seconds` is the length of
     * the smaller step.
     */
    linearDamping: number;
    angularDamping: number;
    /**
     * Multiplies the world's gravity for this body. 0 makes it float, negative makes it fall up.
     *
     * @default 1
     */
    gravityScale: number;
    /**
     * Stops this body from tunneling through other moving bodies when it moves fast, at some cost
     * to performance. Every dynamic body already can't tunnel through static bodies.
     */
    isBullet: boolean;
    /**
     * Starts the body removed from the simulation, so it neither moves nor touches anything until
     * enabled.
     */
    isDisabled: boolean;
    /** Reports this body's fast collisions to the `contactHit` entity hook. */
    enableHitEvents: boolean;
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
 * A collision faster than the world's hit event threshold, as one of its two entities sees it.
 *
 * @category Internal
 */
export type EntityHit<Hit> = {
    entityId: number;
    otherEntityId: number;
    hit: Hit;
};

/**
 * Contacts reported by one {@link PhysicsWorld.step}.
 *
 * @category Internal
 */
export type ContactEvents<Hit = unknown> = {
    started: ContactPair[];
    ended: ContactPair[];
    /** Each pair is the sensor's entity id, then the id of the entity that entered it. */
    sensorStarted: ContactPair[];
    /** Each pair is the sensor's entity id, then the id of the entity that left it. */
    sensorEnded: ContactPair[];
    /** Each collision appears twice, once as each of its entities sees it. */
    hits: EntityHit<Hit>[];
    /** The `jointId` of each joint that pulled harder than its force or torque threshold. */
    strainedJoints: number[];
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
 * One shape's side of a contact whose friction or restitution a {@link WorldHooks} mixer combines.
 *
 * @category Internal
 */
export type MixedSurface = {
    /** The shape's friction or restitution. */
    value: number;
    /** From the shape's material, or 0 when it has none. */
    userMaterialId: number;
};

/**
 * Callbacks a physics world runs while stepping. Multiplayer peers must get the same results from
 * them, so they should only read state that is part of the simulation.
 *
 * @category Internal
 */
export type WorldHooks<Vector> = PartialWithUndefined<{
    /**
     * Runs when two shapes start overlapping, if either has `enableCustomFiltering` and their
     * collision filters accept each other. Return false to keep them from touching or sensing each
     * other. The engine doesn't ask again for the same pair every step, so a rejected pair can stay
     * rejected after this would accept it.
     */
    customFilter: (
        entities: Readonly<{
            entityA: number;
            entityB: number;
        }>,
    ) => boolean;
    /**
     * Runs before every step solves a contact with a shape that has `enablePreSolve`, and before a
     * fast body stops at such a shape. Return false to skip the contact for this step. `point` is
     * in world space, and `normal` points from entity A toward entity B.
     */
    preSolve: (
        contact: Readonly<{
            entityA: number;
            entityB: number;
            point: Vector;
            normal: Vector;
        }>,
    ) => boolean;
    /** Replaces the default friction of a contact, the square root of the two frictions multiplied. */
    mixFriction: (surfaceA: Readonly<MixedSurface>, surfaceB: Readonly<MixedSurface>) => number;
    /** Replaces the default restitution of a contact, the larger of the two. */
    mixRestitution: (surfaceA: Readonly<MixedSurface>, surfaceB: Readonly<MixedSurface>) => number;
}>;

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
 * The parts of a joint between two physics bodies that the entity store uses.
 *
 * @category Internal
 */
export type EntityJoint<JointDefinition = unknown> = {
    /** The id the entity store gave this joint. */
    readonly jointId: number;
    /** The joint's current settings, for snapshots. */
    getDefinition(): JointDefinition;
};

/**
 * A physics engine's world, as the entity store drives it. Each physics engine (like Box2D) gets
 * its own implementation.
 *
 * @category Internal
 */
export type PhysicsWorld<
    Definition,
    Body extends EntityBody,
    InitialBodyState,
    Hit = unknown,
    JointDefinition = unknown,
    Joint extends EntityJoint<JointDefinition> = EntityJoint<JointDefinition>,
> = {
    /** Validates the output of every body's `getState()` when loading snapshots. */
    readonly bodyStateShape: Shape;
    /** Validates joint definitions when loading snapshots. */
    readonly jointDefinitionShape: Shape;
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
    /** Connects two bodies. */
    createJoint(
        params: Readonly<{
            bodies: Readonly<
                [
                    Body,
                    Body,
                ]
            >;
            definition: Readonly<JointDefinition>;
            /** Reported back in {@link ContactEvents.strainedJoints}. */
            jointId: number;
        }>,
    ): Joint;
    /** Does nothing if the joint was already destroyed, such as along with one of its bodies. */
    destroyJoint(joint: Joint): void;
    /** Advances the world by one step. */
    step(stepSeconds: number): ContactEvents<Hit>;
    /**
     * Saves the physics engine's whole internal state, such as which contacts are already touching,
     * for `EntityStore.createSnapshot`. Restoring it destroys `droppedBodies`.
     *
     * @throws Error if the physics engine can't save its state.
     */
    createPhysicsState(
        params: Readonly<{
            bodies: ReadonlyArray<Body>;
            droppedBodies: ReadonlyArray<Body>;
            joints: ReadonlyArray<Joint>;
        }>,
    ): Uint8Array;
    /**
     * @throws Error unless `state` came from {@link PhysicsWorld.createPhysicsState} with this many
     *   `bodies` and `joints`.
     */
    assertValidPhysicsState(
        params: Readonly<{
            state: Uint8Array;
            bodyCount: number;
            jointCount: number;
        }>,
    ): void;
    /**
     * Replaces every body and joint with the state saved by {@link PhysicsWorld.createPhysicsState},
     * and points each of `bodies` and `joints` at the saved one in the same position. World
     * settings (like gravity) keep their current values. Check the state with
     * {@link PhysicsWorld.assertValidPhysicsState} first.
     */
    restorePhysicsState(
        params: Readonly<{
            state: Uint8Array;
            bodies: ReadonlyArray<Body>;
            joints: ReadonlyArray<Joint>;
        }>,
    ): void;
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
export type AnyPhysicsWorld = PhysicsWorld<any, EntityBody, any, any, any, EntityJoint<any>>;

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

/**
 * What the `contactHit` entity hook receives about a collision in a {@link PhysicsWorld}.
 *
 * @category Internal
 */
export type HitOf<World extends AnyPhysicsWorld> = ReturnType<World['step']>['hits'][number]['hit'];

/**
 * The joint type created by a {@link PhysicsWorld}.
 *
 * @category Internal
 */
export type JointOf<World extends AnyPhysicsWorld> = ReturnType<World['createJoint']>;

/**
 * The joint definition accepted by a {@link PhysicsWorld}.
 *
 * @category Internal
 */
export type JointDefinitionOf<World extends AnyPhysicsWorld> = Parameters<
    World['createJoint']
>[0]['definition'];
