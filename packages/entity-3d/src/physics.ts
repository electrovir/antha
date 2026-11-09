import {
    BodyType,
    type BaseEntityPhysicsDefinition,
    type CollisionFilter,
    type ContactPair,
    type EntityBody,
    type PhysicsWorld,
} from '@antha/entity-core';
import {assertWrap} from '@augment-vir/assert';
import {
    createArray,
    getObjectTypedKeys,
    type Coords3d,
    type PartialWithUndefined,
} from '@augment-vir/common';
import box3dFactory, {
    type b3BodyId,
    type b3Quat,
    type b3ShapeDef,
    type b3ShapeId,
    type b3Vec3,
    type b3WorldId,
    type Box3DModule,
    type ContactsBuffer,
    type EventsBuffer,
} from 'box3d.js';
import {defineShape} from 'object-shape-tester';

/**
 * The geometry of one physics shape.
 *
 * @category Main
 */
export enum ShapeType {
    Sphere = 'sphere',
    Box = 'box',
    /** A cylinder with rounded ends, standing along the body's y axis. */
    Capsule = 'capsule',
}

/**
 * Surface and mass properties of a physics shape.
 *
 * @category Internal
 */
export type PhysicsMaterial = PartialWithUndefined<{
    /**
     * Kilograms per cubic meter.
     *
     * @default 1000
     */
    density: number;
    /** @default 0.6 */
    friction: number;
    /**
     * Bounciness, from 0 (no bounce) to 1 (no energy lost).
     *
     * @default 0
     */
    restitution: number;
}>;

/**
 * One shape attached to an entity's physics body. Lengths are in meters.
 *
 * @category Internal
 */
export type PhysicsShapeDefinition = (
    | {
          type: ShapeType.Sphere;
          radius: number;
      }
    | {
          type: ShapeType.Box;
          width: number;
          height: number;
          depth: number;
      }
    | {
          type: ShapeType.Capsule;
          radius: number;
          /** End to end, including both rounded ends. Must be at least `radius * 2`. */
          height: number;
      }
) &
    PartialWithUndefined<{
        /** Where the shape's center sits relative to the body's position. */
        offset: Coords3d;
        material: PhysicsMaterial;
    }>;

/**
 * The physics body of an entity class.
 *
 * @category Internal
 */
export type EntityPhysicsDefinition = BaseEntityPhysicsDefinition<PhysicsShapeDefinition>;

/**
 * A rotation as a unit quaternion.
 *
 * @category Internal
 */
export type Quaternion = BodyState['rotation'];

/**
 * Shape definition for {@link BodyState}.
 *
 * @category Internal
 */
export const bodyStateShape = defineShape({
    position: {
        x: 0,
        y: 0,
        z: 0,
    },
    rotation: {
        x: 0,
        y: 0,
        z: 0,
        w: 1,
    },
    velocity: {
        x: 0,
        y: 0,
        z: 0,
    },
    angularVelocity: {
        x: 0,
        y: 0,
        z: 0,
    },
});

/**
 * Everything about a body that changes as it moves. Included in entity snapshots.
 *
 * @category Internal
 */
export type BodyState = typeof bodyStateShape.runtimeType;

/**
 * Where a new body starts. Leave any field out for a body at rest at the origin.
 *
 * @category Internal
 */
export type InitialBodyState = PartialWithUndefined<BodyState>;

/**
 * A position and rotation.
 *
 * @category Internal
 */
export type Transform3d = {
    position: Coords3d;
    rotation: Quaternion;
};

const bodyTypeNames = {
    [BodyType.Static]: 'b3_staticBody',
    [BodyType.Kinematic]: 'b3_kinematicBody',
    [BodyType.Dynamic]: 'b3_dynamicBody',
} as const satisfies Record<BodyType, keyof Box3DModule['b3BodyType']>;

const subStepCount = 4;

const box3dModule = box3dFactory();

function toVector(coords: Readonly<Coords3d>): b3Vec3 {
    return [
        coords.x,
        coords.y,
        coords.z,
    ];
}

function fromVector([
    x,
    y,
    z,
]: Readonly<b3Vec3>) {
    return {
        x,
        y,
        z,
    };
}

function createVector(): b3Vec3 {
    return [
        0,
        0,
        0,
    ];
}

function toQuaternion(rotation: Readonly<Quaternion>): b3Quat {
    return [
        rotation.x,
        rotation.y,
        rotation.z,
        rotation.w,
    ];
}

function fromQuaternion([
    x,
    y,
    z,
    w,
]: Readonly<b3Quat>) {
    return {
        x,
        y,
        z,
        w,
    };
}

function createQuaternion(): b3Quat {
    return [
        0,
        0,
        0,
        1,
    ];
}

function shapeKey(shapeId: Readonly<b3ShapeId>) {
    return `${shapeId.index1}:${shapeId.generation}`;
}

type ShapeCreator<Type extends ShapeType> = (
    params: Readonly<{
        box3d: Box3DModule;
        bodyId: b3BodyId;
        shapeDef: b3ShapeDef;
        shape: Readonly<Extract<PhysicsShapeDefinition, {type: Type}>>;
        center: b3Vec3;
    }>,
) => b3ShapeId;

const shapeCreators: {
    [Type in ShapeType]: ShapeCreator<Type>;
} = {
    [ShapeType.Sphere]({box3d, bodyId, shapeDef, shape, center}) {
        return box3d.b3CreateSphereShape(bodyId, shapeDef, {
            center,
            radius: shape.radius,
        });
    },
    [ShapeType.Box]({box3d, bodyId, shapeDef, shape, center}) {
        if (!center.some(Boolean)) {
            return box3d.b3CreateBoxShape(
                bodyId,
                shapeDef,
                shape.width / 2,
                shape.height / 2,
                shape.depth / 2,
            );
        }
        /**
         * Box3D has no offset box. Its hull mass computation leaves float noise in the inertia, so
         * centered boxes keep the exact box shape above.
         */
        const hull = box3d.b3CreateHull(
            [
                -1,
                1,
            ].flatMap((xSign) => {
                return [
                    -1,
                    1,
                ].flatMap((ySign) => {
                    return [
                        -1,
                        1,
                    ].flatMap((zSign) => {
                        return [
                            center[0] + (xSign * shape.width) / 2,
                            center[1] + (ySign * shape.height) / 2,
                            center[2] + (zSign * shape.depth) / 2,
                        ];
                    });
                });
            }),
        );
        const shapeId = box3d.b3CreateHullShape(bodyId, shapeDef, hull);
        box3d.b3DestroyHull(hull);
        return shapeId;
    },
    [ShapeType.Capsule]({box3d, bodyId, shapeDef, shape, center}) {
        if (shape.height < shape.radius * 2) {
            throw new Error(
                `Capsule height (${shape.height}) must be at least twice its radius (${shape.radius}).`,
            );
        }
        const halfSegment = shape.height / 2 - shape.radius;
        return box3d.b3CreateCapsuleShape(bodyId, shapeDef, {
            center1: [
                center[0],
                center[1] - halfSegment,
                center[2],
            ],
            center2: [
                center[0],
                center[1] + halfSegment,
                center[2],
            ],
            radius: shape.radius,
        });
    },
};

/**
 * Controls one entity's Box3D body. Positions and lengths are in meters, velocities in meters per
 * second.
 *
 * @category Main
 */
export class EntityPhysics3d implements EntityBody<BodyState> {
    /**
     * The transform after the second most recent step, the start of the motion the view
     * interpolates through.
     */
    public previousTransform: Transform3d;
    /** The transform after the most recent step. */
    public currentTransform: Transform3d;

    protected readonly box3d: Box3DModule;
    /** The Box3D body this controls. */
    public readonly bodyId: b3BodyId;
    /** The Box3D shapes attached to this body. */
    public readonly shapeIds: ReadonlyArray<b3ShapeId>;
    /** Shared by every body in the world, refilled by each {@link EntityPhysics3d.getContacts} call. */
    protected readonly contactsBuffer: ContactsBuffer;

    constructor({
        box3d,
        bodyId,
        shapeIds,
        contactsBuffer,
    }: Readonly<{
        box3d: Box3DModule;
        bodyId: b3BodyId;
        shapeIds: ReadonlyArray<b3ShapeId>;
        contactsBuffer: ContactsBuffer;
    }>) {
        this.box3d = box3d;
        this.bodyId = bodyId;
        this.shapeIds = shapeIds;
        this.contactsBuffer = contactsBuffer;
        this.currentTransform = this.readTransform();
        this.previousTransform = this.currentTransform;
    }

    /** Reads the body's current transform from Box3D. */
    protected readTransform() {
        return {
            position: this.getPosition(),
            rotation: this.getRotation(),
        };
    }

    /** Saves the transform the last step produced. Called by the entity store after each step. */
    public recordStep() {
        this.previousTransform = this.currentTransform;
        this.currentTransform = this.readTransform();
    }

    /** Stops the view from sliding between the old and new transform after a teleport. */
    protected snapTransform() {
        this.currentTransform = this.readTransform();
        this.previousTransform = this.currentTransform;
    }

    /** Meters. */
    public getPosition() {
        return fromVector(this.box3d.b3Body_GetPosition(createVector(), this.bodyId));
    }

    /** Teleports the body. Its view jumps straight there instead of sliding. */
    public setPosition(position: Readonly<Coords3d>) {
        this.box3d.b3Body_SetTransform(
            this.bodyId,
            toVector(position),
            this.box3d.b3Body_GetRotation(createQuaternion(), this.bodyId),
        );
        this.snapTransform();
    }

    /** Box3D stores rotations in 32-bit floats, so this can differ slightly from the one last set. */
    public getRotation() {
        return fromQuaternion(this.box3d.b3Body_GetRotation(createQuaternion(), this.bodyId));
    }

    /** Turns the body instantly. Its view jumps straight there instead of turning. */
    public setRotation(rotation: Readonly<Quaternion>) {
        this.box3d.b3Body_SetTransform(
            this.bodyId,
            this.box3d.b3Body_GetPosition(createVector(), this.bodyId),
            toQuaternion(rotation),
        );
        this.snapTransform();
    }

    /** Meters per second. */
    public getVelocity() {
        return fromVector(this.box3d.b3Body_GetLinearVelocity(createVector(), this.bodyId));
    }

    /** Meters per second. */
    public setVelocity(velocity: Readonly<Coords3d>) {
        this.box3d.b3Body_SetLinearVelocity(this.bodyId, toVector(velocity));
    }

    /** Radians per second around each axis. */
    public getAngularVelocity() {
        return fromVector(this.box3d.b3Body_GetAngularVelocity(createVector(), this.bodyId));
    }

    /** Radians per second around each axis. */
    public setAngularVelocity(angularVelocity: Readonly<Coords3d>) {
        this.box3d.b3Body_SetAngularVelocity(this.bodyId, toVector(angularVelocity));
    }

    /**
     * Pushes the body's center during the next step only. Box3D clears forces after each step, so
     * call this every step (from `update()`) for a constant push.
     */
    public applyForce(force: Readonly<Coords3d>) {
        this.box3d.b3Body_ApplyForceToCenter(this.bodyId, toVector(force), true);
    }

    /** Changes the body's velocity immediately, by `impulse / mass`. */
    public applyImpulse(impulse: Readonly<Coords3d>) {
        this.box3d.b3Body_ApplyLinearImpulseToCenter(this.bodyId, toVector(impulse), true);
    }

    /** Total mass in kilograms. Always 0 for static and kinematic bodies. */
    public getMass() {
        return this.box3d.b3Body_GetMass(this.bodyId);
    }

    /**
     * Every shape this body touches or is about to touch, as of the last step. `normal` points away
     * from the other shape, toward this body. `separation` is the gap between them, negative while
     * they overlap.
     */
    public getContacts() {
        this.box3d.getBodyContactData(this.contactsBuffer, this.bodyId);
        const contact = this.box3d.createContact();
        const manifold = this.box3d.createManifold();

        return createArray(this.box3d.getNumContacts(this.contactsBuffer), (contactIndex) => {
            this.box3d.getContactAt(contact, this.contactsBuffer, contactIndex);
            const isShapeA = this.shapeIds.some((shapeId) => {
                return shapeKey(shapeId) === shapeKey(contact.shapeIdA);
            });
            /** Box3D's normal points from shape A to shape B. */
            const direction = isShapeA ? -1 : 1;
            const otherType = this.box3d.b3Body_GetType(
                this.box3d.b3Shape_GetBody(isShapeA ? contact.shapeIdB : contact.shapeIdA),
            );
            const otherBodyType = assertWrap.isDefined(
                getObjectTypedKeys(bodyTypeNames).find((bodyType) => {
                    return this.box3d.b3BodyType[bodyTypeNames[bodyType]].value === otherType.value;
                }),
            );

            return createArray(contact.manifoldCount, (manifoldIndex) => {
                this.box3d.getManifoldAt(manifold, contact, manifoldIndex);

                return {
                    normal: {
                        x: manifold.normal[0] * direction,
                        y: manifold.normal[1] * direction,
                        z: manifold.normal[2] * direction,
                    },
                    separation: Math.min(
                        ...manifold.points
                            .slice(0, manifold.pointCount)
                            .map((point) => point.separation),
                    ),
                    otherBodyType,
                };
            });
        }).flat();
    }

    /** Reads everything about the body that changes as it moves. */
    public getState() {
        return {
            position: this.getPosition(),
            rotation: this.getRotation(),
            velocity: this.getVelocity(),
            angularVelocity: this.getAngularVelocity(),
        };
    }
}

/**
 * A Box3D world. Create one with {@link PhysicsWorld3d.create}.
 *
 * @category Internal
 */
export class PhysicsWorld3d
    implements PhysicsWorld<EntityPhysicsDefinition, EntityPhysics3d, InitialBodyState>
{
    /** Loads Box3D (shared by every world) and creates a world. */
    public static async create() {
        return new PhysicsWorld3d(await box3dModule);
    }

    /** Validates {@link BodyState} entries in snapshots. */
    public readonly bodyStateShape = bodyStateShape;
    protected readonly box3d: Box3DModule;
    protected world:
        | {
              id: b3WorldId;
              eventsBuffer: EventsBuffer;
              contactsBuffer: ContactsBuffer;
          }
        | undefined;
    /** Box3D shapes can't hold user data, so contact events look up their entity here. */
    protected readonly shapeEntityIds = new Map<string, number>();
    protected gravity: Coords3d = {
        x: 0,
        y: 0,
        z: 0,
    };

    /** Use {@link PhysicsWorld3d.create} instead, which loads Box3D first. */
    protected constructor(box3d: Box3DModule) {
        this.box3d = box3d;
        this.createWorld();
    }

    /** Creates the Box3D world. */
    protected createWorld() {
        const worldDef = this.box3d.b3DefaultWorldDef();
        worldDef.gravity = toVector(this.gravity);
        this.world = {
            id: this.box3d.b3CreateWorld(worldDef),
            eventsBuffer: this.box3d.createEventsBuffer(),
            contactsBuffer: this.box3d.createContactsBuffer(),
        };
    }

    /** Destroys the Box3D world and its buffers. */
    protected destroyWorld() {
        if (this.world) {
            this.box3d.b3DestroyWorld(this.world.id);
            this.box3d.destroyEventsBuffer(this.world.eventsBuffer);
            this.box3d.destroyContactsBuffer(this.world.contactsBuffer);
        }
        this.world = undefined;
        this.shapeEntityIds.clear();
    }

    /** @throws Error if the world was destroyed. */
    protected requireWorld() {
        if (!this.world) {
            throw new Error('The physics world has been destroyed.');
        }
        return this.world;
    }

    /**
     * Sets the acceleration applied to every dynamic body, in meters per second squared. +y is up.
     *
     * @default {x: 0, y: 0, z: 0}
     */
    public setGravity(gravity: Readonly<Coords3d>) {
        const world = this.requireWorld();
        this.gravity = {
            ...gravity,
        };
        this.box3d.b3World_SetGravity(world.id, toVector(gravity));
    }

    /** Meters per second squared. */
    public getGravity() {
        return {
            ...this.gravity,
        };
    }

    /**
     * Destroys every body by replacing the world, so that loading the same snapshot builds the same
     * internal world on every peer.
     */
    public reset() {
        this.requireWorld();
        this.destroyWorld();
        this.createWorld();
    }

    /**
     * Usually called by the entity store. Without a `definition`, creates a static body with no
     * shapes.
     */
    public createBody({
        definition,
        filter,
        entityId,
        bodyState,
    }: Readonly<{
        definition: Readonly<EntityPhysicsDefinition> | undefined;
        filter: Readonly<CollisionFilter>;
        /** Reported back in contact events. */
        entityId: number;
        bodyState: Readonly<InitialBodyState>;
    }>) {
        const world = this.requireWorld();
        const bodyDef = this.box3d.b3DefaultBodyDef();
        bodyDef.type = this.box3d.b3BodyType[bodyTypeNames[definition?.type || BodyType.Static]];
        if (bodyState.position) {
            bodyDef.position = toVector(bodyState.position);
        }
        if (bodyState.rotation) {
            bodyDef.rotation = toQuaternion(bodyState.rotation);
        }
        if (bodyState.velocity) {
            bodyDef.linearVelocity = toVector(bodyState.velocity);
        }
        if (bodyState.angularVelocity) {
            bodyDef.angularVelocity = toVector(bodyState.angularVelocity);
        }
        bodyDef.linearDamping = definition?.linearDamping ?? 0;
        bodyDef.angularDamping = definition?.angularDamping ?? 0;
        bodyDef.motionLocks = {
            ...bodyDef.motionLocks,
            angularX: !!definition?.fixedRotation,
            angularY: !!definition?.fixedRotation,
            angularZ: !!definition?.fixedRotation,
        };
        /**
         * Box3D judges whether a body is still by how fast its shapes move, so a body without
         * shapes always looks still. It soon falls asleep and loses its velocity.
         */
        bodyDef.enableSleep = !!definition?.shapes?.length;
        const bodyId = this.box3d.b3CreateBody(world.id, bodyDef);

        const shapeIds = (definition?.shapes || []).map((shape) => {
            const shapeDef = this.box3d.b3DefaultShapeDef();
            shapeDef.filter = {
                ...shapeDef.filter,
                categoryBits: filter.category,
                maskBits: filter.mask,
            };
            shapeDef.enableContactEvents = filter.mask !== 0n;
            shapeDef.density = shape.material?.density ?? shapeDef.density;
            shapeDef.baseMaterial = {
                ...shapeDef.baseMaterial,
                friction: shape.material?.friction ?? shapeDef.baseMaterial.friction,
                restitution: shape.material?.restitution ?? shapeDef.baseMaterial.restitution,
            };
            const shapeId = (
                shapeCreators[shape.type] satisfies ShapeCreator<any> as ShapeCreator<ShapeType>
            )({
                box3d: this.box3d,
                bodyId,
                shapeDef,
                shape,
                center: toVector({
                    x: 0,
                    y: 0,
                    z: 0,
                    ...shape.offset,
                }),
            });
            this.shapeEntityIds.set(shapeKey(shapeId), entityId);
            return shapeId;
        });

        return new EntityPhysics3d({
            box3d: this.box3d,
            bodyId,
            shapeIds,
            contactsBuffer: world.contactsBuffer,
        });
    }

    /** Does nothing if the body was already destroyed. */
    public destroyBody(physics: Readonly<EntityPhysics3d>) {
        this.requireWorld();
        if (this.box3d.b3Body_IsValid(physics.bodyId)) {
            this.box3d.b3DestroyBody(physics.bodyId);
            physics.shapeIds.forEach((shapeId) => {
                this.shapeEntityIds.delete(shapeKey(shapeId));
            });
        }
    }

    /**
     * Advances the world by one step and returns the entity id pairs whose shapes started and
     * stopped touching during it.
     */
    public step(stepSeconds: number) {
        const world = this.requireWorld();
        this.box3d.b3World_Step(world.id, stepSeconds, subStepCount);
        this.box3d.getEvents(world.eventsBuffer, world.id);
        const event = this.box3d.createContactTouchEvent();

        const started = createArray(
            this.box3d.getNumContactBeginEvents(world.eventsBuffer),
            (index): ContactPair => {
                this.box3d.getContactBeginEventAt(event, world.eventsBuffer, index);
                return [
                    this.getShapeEntityId(event.shapeIdA),
                    this.getShapeEntityId(event.shapeIdB),
                ];
            },
        );
        const ended = createArray(
            this.box3d.getNumContactEndEvents(world.eventsBuffer),
            (index) => {
                this.box3d.getContactEndEventAt(event, world.eventsBuffer, index);
                /** End events also fire for shapes destroyed since the last step. */
                return this.box3d.b3Shape_IsValid(event.shapeIdA) &&
                    this.box3d.b3Shape_IsValid(event.shapeIdB)
                    ? [
                          [
                              this.getShapeEntityId(event.shapeIdA),
                              this.getShapeEntityId(event.shapeIdB),
                          ] satisfies ContactPair,
                      ]
                    : [];
            },
        ).flat();

        return {
            started,
            ended,
        };
    }

    /** @throws Error if the shape was not created by {@link PhysicsWorld3d.createBody}. */
    protected getShapeEntityId(shapeId: Readonly<b3ShapeId>) {
        return assertWrap.isDefined(this.shapeEntityIds.get(shapeKey(shapeId)));
    }

    /** Destroys the Box3D world. Every later call that needs the world throws. */
    public destroy() {
        this.destroyWorld();
    }
}
