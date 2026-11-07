// cspell:word pthread
import {
    type CollisionFilter,
    type ContactEvents,
    type ContactPair,
    type EntityBody,
    type PhysicsWorld,
} from '@antha/entity-core';
import {assertWrap, check} from '@augment-vir/assert';
import {
    createArray,
    getObjectTypedKeys,
    getOrSetFromMap,
    type Coords,
    type PartialWithUndefined,
} from '@augment-vir/common';
import box2dFactory, {
    type b2BodyId,
    type b2ContactData,
    type b2Rot,
    type b2ShapeDef,
    type b2ShapeId,
    type b2Vec2,
    type b2WorldId,
    type Box2DModule,
    type TaskSystem,
} from 'box2d3-wasm';
import {defineShape} from 'object-shape-tester';

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
 * The geometry of one physics shape.
 *
 * @category Main
 */
export enum ShapeType {
    Circle = 'circle',
    Box = 'box',
}

/**
 * Surface and mass properties of a physics shape.
 *
 * @category Internal
 */
export type PhysicsMaterial = PartialWithUndefined<{
    /**
     * Mass per square unit.
     *
     * @default 1
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
 * One shape attached to an entity's physics body. Lengths are in game units (see `pixelsPerMeter`).
 *
 * @category Internal
 */
export type PhysicsShapeDefinition = (
    | {
          type: ShapeType.Circle;
          radius: number;
      }
    | {
          type: ShapeType.Box;
          width: number;
          height: number;
      }
) &
    PartialWithUndefined<{
        /** Where the shape's center sits relative to the body's position. */
        offset: Coords;
        material: PhysicsMaterial;
    }>;

/**
 * The physics body of an entity class.
 *
 * @category Internal
 */
export type EntityPhysicsDefinition = {
    type: BodyType;
} & PartialWithUndefined<{
    /** Entities with no shapes never touch anything. */
    shapes: ReadonlyArray<PhysicsShapeDefinition>;
    /** Prevents the body from rotating. */
    fixedRotation: boolean;
    /** Slows linear velocity by `v / (1 + stepSeconds * linearDamping)` every step. */
    linearDamping: number;
    angularDamping: number;
}>;

/**
 * Options for the physics world of an entity suite.
 *
 * @category Internal
 */
export type PhysicsOptions = PartialWithUndefined<{
    /**
     * How many game units make up one meter. Box2D is tuned for moving objects between 0.1 and 10
     * meters, so pick a value that puts your common objects in that range.
     *
     * @default 1
     */
    pixelsPerMeter: number;
    /**
     * How many threads step the world, from 1 to 4. More than 1 only works when the page is
     * cross-origin isolated; otherwise Box2D runs on the main thread alone. Results are identical
     * for every thread count.
     *
     * @default 4
     */
    threadCount: number;
}>;

/**
 * Shape definition for {@link BodyState}.
 *
 * @category Internal
 */
export const bodyStateShape = defineShape({
    position: {
        x: 0,
        y: 0,
    },
    /**
     * Box2D's own cosine and sine rather than an angle, because converting to an angle and back
     * shifts the rotation slightly, which would make a loaded snapshot differ from its source.
     */
    rotation: {
        cosine: 1,
        sine: 0,
    },
    velocity: {
        x: 0,
        y: 0,
    },
    angularVelocity: 0,
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
export type InitialBodyState = PartialWithUndefined<
    Omit<BodyState, 'rotation'> & {
        /** An angle in radians, or Box2D's exact rotation from a {@link BodyState}. */
        rotation: number | BodyState['rotation'];
    }
>;

/**
 * A position and rotation.
 *
 * @category Internal
 */
export type Transform2d = {
    position: Coords;
    rotation: number;
};

const bodyTypeNames = {
    [BodyType.Static]: 'b2_staticBody',
    [BodyType.Kinematic]: 'b2_kinematicBody',
    [BodyType.Dynamic]: 'b2_dynamicBody',
} as const satisfies Record<BodyType, keyof Box2DModule['b2BodyType']>;

/** The package's own comment calls its all-cores default a bad one and recommends 4. */
const physicsThreadCount = 4;
const subStepCount = 4;

/**
 * A loaded Box2D module, shared by every world with the same `pixelsPerMeter`.
 *
 * @category Internal
 */
export type LoadedBox2d = {
    box2d: Box2DModule;
    /** Only exists in the multithreaded build. */
    taskSystem: TaskSystem | undefined;
};

const box2dModules = new Map<number, Promise<LoadedBox2d>>();

/**
 * Loads one Box2D module per length scale, because `b2SetLengthUnitsPerMeter` applies to a whole
 * module.
 */
async function loadBox2d(pixelsPerMeter: number) {
    return await getOrSetFromMap(box2dModules, pixelsPerMeter, () => {
        return box2dFactory({
            pthreadCount: physicsThreadCount,
        }).then((box2d) => {
            box2d.b2SetLengthUnitsPerMeter(pixelsPerMeter);
            return {
                box2d,
                taskSystem: createTaskSystem(box2d),
            };
        });
    });
}

function readVector(vector: b2Vec2): Coords {
    const coords = {
        x: vector.x,
        y: vector.y,
    };
    vector.delete();
    return coords;
}

function readAngle(rotation: b2Rot) {
    const angle = rotation.GetAngle();
    rotation.delete();
    return angle;
}

function readRotation(rotation: b2Rot): BodyState['rotation'] {
    const state = {
        cosine: rotation.c,
        sine: rotation.s,
    };
    rotation.delete();
    return state;
}

const shapeCreators: {
    [Type in ShapeType]: (
        params: Readonly<{
            box2d: Box2DModule;
            bodyId: b2BodyId;
            shapeDef: b2ShapeDef;
            shape: Readonly<Extract<PhysicsShapeDefinition, {type: Type}>>;
        }>,
    ) => b2ShapeId;
} = {
    [ShapeType.Circle]({box2d, bodyId, shapeDef, shape}) {
        const circle = new box2d.b2Circle();
        circle.center.Set(shape.offset?.x ?? 0, shape.offset?.y ?? 0);
        circle.radius = shape.radius;
        const shapeId = box2d.b2CreateCircleShape(bodyId, shapeDef, circle);
        circle.delete();
        return shapeId;
    },
    [ShapeType.Box]({box2d, bodyId, shapeDef, shape}) {
        const offset = new box2d.b2Vec2(shape.offset?.x ?? 0, shape.offset?.y ?? 0);
        const rotation = box2d.b2MakeRot(0);
        const polygon = box2d.b2MakeOffsetBox(shape.width / 2, shape.height / 2, offset, rotation);
        const shapeId = box2d.b2CreatePolygonShape(bodyId, shapeDef, polygon);
        polygon.delete();
        rotation.delete();
        offset.delete();
        return shapeId;
    },
};

/**
 * Controls one entity's Box2D body. Positions, lengths, and velocities are in game units.
 *
 * @category Main
 */
export class EntityPhysics2d implements EntityBody<BodyState> {
    /**
     * The transform after the second most recent step, the start of the motion the view
     * interpolates through.
     */
    public previousTransform: Transform2d;
    /** The transform after the most recent step. */
    public currentTransform: Transform2d;

    constructor(
        protected readonly box2d: Box2DModule,
        /** The Box2D body this controls. */
        public readonly bodyId: b2BodyId,
    ) {
        this.currentTransform = this.readTransform();
        this.previousTransform = this.currentTransform;
    }

    /** Reads the body's current transform from Box2D. */
    protected readTransform(): Transform2d {
        return {
            position: readVector(this.box2d.b2Body_GetPosition(this.bodyId)),
            rotation: readAngle(this.box2d.b2Body_GetRotation(this.bodyId)),
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

    /** Game units. */
    public getPosition(): Coords {
        return readVector(this.box2d.b2Body_GetPosition(this.bodyId));
    }

    /** Teleports the body. Its view jumps straight there instead of sliding. */
    public setPosition(position: Readonly<Coords>) {
        const newPosition = new this.box2d.b2Vec2(position.x, position.y);
        const rotation = this.box2d.b2Body_GetRotation(this.bodyId);
        this.box2d.b2Body_SetTransform(this.bodyId, newPosition, rotation);
        rotation.delete();
        newPosition.delete();
        this.snapTransform();
    }

    /**
     * Rotation in radians, clockwise on screen. Box2D stores rotations as an approximate cosine and
     * sine, so this can differ slightly from the angle last set.
     */
    public getRotation() {
        return readAngle(this.box2d.b2Body_GetRotation(this.bodyId));
    }

    /** Turns the body instantly. Its view jumps straight there instead of turning. */
    public setRotation(rotation: number) {
        const position = this.box2d.b2Body_GetPosition(this.bodyId);
        const newRotation = this.box2d.b2MakeRot(rotation);
        this.box2d.b2Body_SetTransform(this.bodyId, position, newRotation);
        newRotation.delete();
        position.delete();
        this.snapTransform();
    }

    /** Game units per second. */
    public getVelocity(): Coords {
        return readVector(this.box2d.b2Body_GetLinearVelocity(this.bodyId));
    }

    /** Game units per second. */
    public setVelocity(velocity: Readonly<Coords>) {
        const newVelocity = new this.box2d.b2Vec2(velocity.x, velocity.y);
        this.box2d.b2Body_SetLinearVelocity(this.bodyId, newVelocity);
        newVelocity.delete();
    }

    /** Radians per second. */
    public getAngularVelocity() {
        return this.box2d.b2Body_GetAngularVelocity(this.bodyId);
    }

    /** Radians per second, clockwise on screen. */
    public setAngularVelocity(angularVelocity: number) {
        this.box2d.b2Body_SetAngularVelocity(this.bodyId, angularVelocity);
    }

    /**
     * Pushes the body's center during the next step only. Box2D clears forces after each step, so
     * call this every step (from `update()`) for a constant push.
     */
    public applyForce(force: Readonly<Coords>) {
        const newForce = new this.box2d.b2Vec2(force.x, force.y);
        this.box2d.b2Body_ApplyForceToCenter(this.bodyId, newForce, true);
        newForce.delete();
    }

    /** Changes the body's velocity immediately, by `impulse / mass`. */
    public applyImpulse(impulse: Readonly<Coords>) {
        const newImpulse = new this.box2d.b2Vec2(impulse.x, impulse.y);
        this.box2d.b2Body_ApplyLinearImpulseToCenter(this.bodyId, newImpulse, true);
        newImpulse.delete();
    }

    /** Total mass from every shape's area and density. Always 0 for static and kinematic bodies. */
    public getMass() {
        return this.box2d.b2Body_GetMass(this.bodyId);
    }

    /**
     * Every shape this body touches or is about to touch, as of the last step. `normal` points away
     * from the other shape, toward this body. `separation` is the gap between them, negative while
     * they overlap.
     */
    public getContacts() {
        const contacts: {
            normal: Coords;
            separation: number;
            otherBodyType: BodyType;
        }[] = [];

        (
            this.box2d.b2Body_GetContactData(
                this.bodyId,
                this.box2d.b2Body_GetContactCapacity(this.bodyId),
            ) as b2ContactData[]
        ).forEach((contactData) => {
            const manifold = contactData.manifold;
            const isShapeA =
                this.box2d.b2Shape_GetBody(contactData.shapeIdA).index1 === this.bodyId.index1;
            /** Box2D's normal points from shape A to shape B. */
            const direction = isShapeA ? -1 : 1;
            const otherType = this.box2d.b2Body_GetType(
                this.box2d.b2Shape_GetBody(isShapeA ? contactData.shapeIdB : contactData.shapeIdA),
            );
            const otherBodyType = assertWrap.isDefined(
                getObjectTypedKeys(bodyTypeNames).find((bodyType) => {
                    return this.box2d.b2BodyType[bodyTypeNames[bodyType]].value === otherType.value;
                }),
            );
            const separations = createArray(manifold.pointCount, (index) => {
                const point = manifold.GetPoint(index);
                const separation = point.separation;
                point.delete();
                return separation;
            });

            const normal = readVector(manifold.normal);

            if (separations.length) {
                contacts.push({
                    normal: {
                        x: normal.x * direction,
                        y: normal.y * direction,
                    },
                    separation: Math.min(...separations),
                    otherBodyType,
                });
            }
            manifold.delete();
            contactData.delete();
        });

        return contacts;
    }

    /** Reads everything about the body that changes as it moves. */
    public getState(): BodyState {
        return {
            position: this.getPosition(),
            rotation: readRotation(this.box2d.b2Body_GetRotation(this.bodyId)),
            velocity: this.getVelocity(),
            angularVelocity: this.getAngularVelocity(),
        };
    }
}

/**
 * A Box2D world. Create one with {@link PhysicsWorld2d.create}.
 *
 * @category Internal
 */
export class PhysicsWorld2d
    implements PhysicsWorld<EntityPhysicsDefinition, EntityPhysics2d, InitialBodyState>
{
    /** Loads Box2D (shared by every world with the same `pixelsPerMeter`) and creates a world. */
    public static async create(options: Readonly<PhysicsOptions> = {}) {
        const threadCount = options.threadCount ?? physicsThreadCount;
        if (!Number.isInteger(threadCount) || threadCount < 1 || threadCount > physicsThreadCount) {
            throw new Error(
                `Physics threadCount must be an integer from 1 to ${physicsThreadCount}, got ${threadCount}.`,
            );
        }

        return new PhysicsWorld2d({
            ...(await loadBox2d(options.pixelsPerMeter ?? 1)),
            threadCount,
        });
    }

    /** Validates {@link BodyState} entries in snapshots. */
    public readonly bodyStateShape = bodyStateShape;
    protected readonly box2d: Box2DModule;
    protected readonly taskSystem: TaskSystem | undefined;
    protected readonly threadCount: number;
    protected worldId: b2WorldId | undefined;
    protected gravity: Coords = {
        x: 0,
        y: 0,
    };

    /** Use {@link PhysicsWorld2d.create} instead, which loads Box2D first. */
    protected constructor({
        box2d,
        taskSystem,
        threadCount,
    }: Readonly<
        LoadedBox2d & {
            threadCount: number;
        }
    >) {
        this.box2d = box2d;
        this.taskSystem = taskSystem;
        this.threadCount = threadCount;
        this.createWorld();
    }

    /** Whether steps are split across several threads. */
    public isThreaded() {
        return !!this.taskSystem && this.threadCount > 1;
    }

    /** Creates the Box2D world, threaded when this world has more than one thread. */
    protected createWorld() {
        const worldDef = this.box2d.b2DefaultWorldDef();
        worldDef.gravity.Set(this.gravity.x, this.gravity.y);
        if (this.taskSystem && this.isThreaded()) {
            worldDef.workerCount = this.threadCount;
            this.worldId = this.box2d.b2CreateThreadedWorld(worldDef, this.taskSystem);
        } else {
            this.worldId = this.box2d.b2CreateWorld(worldDef);
        }
        worldDef.delete();
    }

    /** @throws Error if the world was destroyed. */
    protected requireWorld() {
        if (!this.worldId) {
            throw new Error('The physics world has been destroyed.');
        }
        return {
            box2d: this.box2d,
            worldId: this.worldId,
        };
    }

    /**
     * Sets the acceleration applied to every dynamic body, in game units per second squared.
     *
     * @default {x: 0, y: 0}
     */
    public setGravity(gravity: Readonly<Coords>) {
        const {box2d, worldId} = this.requireWorld();
        this.gravity = {
            ...gravity,
        };
        const newGravity = new box2d.b2Vec2(gravity.x, gravity.y);
        box2d.b2World_SetGravity(worldId, newGravity);
        newGravity.delete();
    }

    /** Game units per second squared. */
    public getGravity(): Coords {
        return {
            ...this.gravity,
        };
    }

    /**
     * Destroys every body by replacing the world, so that loading the same snapshot builds the same
     * internal world on every peer.
     */
    public reset() {
        const {box2d, worldId} = this.requireWorld();
        box2d.b2DestroyWorld(worldId);
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
        /** Stored on the body and its shapes so contact events can find the entity. */
        entityId: number;
        bodyState: Readonly<InitialBodyState>;
    }>) {
        const {box2d, worldId} = this.requireWorld();
        const bodyDef = box2d.b2DefaultBodyDef();
        bodyDef.type = box2d.b2BodyType[bodyTypeNames[definition?.type || BodyType.Static]];
        bodyDef.position.Set(bodyState.position?.x ?? 0, bodyState.position?.y ?? 0);
        const rotation = box2d.b2MakeRot(
            check.isNumber(bodyState.rotation) ? bodyState.rotation : 0,
        );
        if (bodyState.rotation && !check.isNumber(bodyState.rotation)) {
            rotation.c = bodyState.rotation.cosine;
            rotation.s = bodyState.rotation.sine;
        }
        bodyDef.rotation = rotation;
        rotation.delete();
        bodyDef.linearVelocity.Set(bodyState.velocity?.x ?? 0, bodyState.velocity?.y ?? 0);
        bodyDef.angularVelocity = bodyState.angularVelocity ?? 0;
        bodyDef.linearDamping = definition?.linearDamping ?? 0;
        bodyDef.angularDamping = definition?.angularDamping ?? 0;
        bodyDef.motionLocks.angularZ = !!definition?.fixedRotation;
        /**
         * Box2D judges whether a body is still by how fast its shapes move, so a body without
         * shapes always looks still. It soon falls asleep and loses its velocity.
         */
        bodyDef.enableSleep = !!definition?.shapes?.length;
        bodyDef.userData = entityId;
        const bodyId = box2d.b2CreateBody(worldId, bodyDef);
        bodyDef.delete();

        definition?.shapes?.forEach((shape) => {
            const shapeDef = box2d.b2DefaultShapeDef();
            shapeDef.filter.setCategoryBits64(filter.category.toString());
            shapeDef.filter.setMaskBits64(filter.mask.toString());
            shapeDef.enableContactEvents = filter.mask !== 0n;
            shapeDef.userData = entityId;
            if (shape.material?.density != undefined) {
                shapeDef.density = shape.material.density;
            }
            if (shape.material?.friction != undefined) {
                shapeDef.material.friction = shape.material.friction;
            }
            if (shape.material?.restitution != undefined) {
                shapeDef.material.restitution = shape.material.restitution;
            }
            (
                shapeCreators[shape.type] satisfies (typeof shapeCreators)[ShapeType] as (
                    params: Readonly<{
                        box2d: Box2DModule;
                        bodyId: b2BodyId;
                        shapeDef: b2ShapeDef;
                        shape: Readonly<PhysicsShapeDefinition>;
                    }>,
                ) => b2ShapeId
            )({
                box2d,
                bodyId,
                shapeDef,
                shape,
            });
            shapeDef.delete();
        });

        return new EntityPhysics2d(box2d, bodyId);
    }

    /** Does nothing if the body was already destroyed. */
    public destroyBody(physics: Readonly<EntityPhysics2d>) {
        const {box2d} = this.requireWorld();
        if (box2d.b2Body_IsValid(physics.bodyId)) {
            box2d.b2DestroyBody(physics.bodyId);
        }
    }

    /**
     * Advances the world by one step and returns the entity id pairs whose shapes started and
     * stopped touching during it.
     */
    public step(stepSeconds: number): ContactEvents {
        const {box2d, worldId} = this.requireWorld();
        box2d.b2World_Step(worldId, stepSeconds, subStepCount);

        const contactEvents = box2d.b2World_GetContactEvents(worldId);
        const started: ContactPair[] = [];
        const ended: ContactPair[] = [];

        for (let index = 0; index < contactEvents.beginCount; index++) {
            const event = contactEvents.GetBeginEvent(index);
            started.push([
                box2d.b2Shape_GetUserData(event.shapeIdA),
                box2d.b2Shape_GetUserData(event.shapeIdB),
            ]);
            event.delete();
        }
        for (let index = 0; index < contactEvents.endCount; index++) {
            const event = contactEvents.GetEndEvent(index);
            /** End events also fire for shapes destroyed since the last step. */
            if (box2d.b2Shape_IsValid(event.shapeIdA) && box2d.b2Shape_IsValid(event.shapeIdB)) {
                ended.push([
                    box2d.b2Shape_GetUserData(event.shapeIdA),
                    box2d.b2Shape_GetUserData(event.shapeIdB),
                ]);
            }
        }
        contactEvents.delete();

        return {
            started,
            ended,
        };
    }

    /** Box2D's hash of the whole world's state. */
    public getStateHash() {
        const {box2d, worldId} = this.requireWorld();
        return box2d.b2World_GetStateHash(worldId);
    }

    /** Destroys the Box2D world. Every later call that needs the world throws. */
    public destroy() {
        if (this.worldId) {
            this.box2d.b2DestroyWorld(this.worldId);
        }
        this.worldId = undefined;
    }
}

/**
 * The package picks its multithreaded `deluxe` build only when the page is cross-origin isolated.
 * The single-threaded `compat` build still has `TaskSystem`, but constructing one aborts the wasm
 * module. Only `deluxe` sets `sharedMemEnabled`.
 */
function createTaskSystem(box2d: Box2DModule) {
    /* c8 ignore start: tests run cross-origin isolated, so they never load `compat`. */
    return check.hasKey(box2d, 'sharedMemEnabled') && box2d.sharedMemEnabled
        ? new box2d.TaskSystem(physicsThreadCount)
        : undefined;
    /* c8 ignore stop */
}
