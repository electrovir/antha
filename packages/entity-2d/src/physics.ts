// cspell:words ragdoll rrggbb
import {
    BodyType,
    flattenBindingValues,
    readBindingValues,
    readFilterBits,
    readWasmFloat32s,
    readWasmInt32s,
    readWasmOverlaps,
    writeWasmInputBytes,
    type BaseEntityPhysicsDefinition,
    type CollisionFilter,
    type ContactEvents,
    type ContactPair,
    type EntityBody,
    type EntityHit,
    type EntityJoint,
    type EntityStore,
    type PhysicsWorld,
    type WorldHooks,
} from '@antha/entity-core';
import {assertWrap, check} from '@augment-vir/assert';
import {
    createArray,
    filterObject,
    getEnumValues,
    getObjectTypedEntries,
    getObjectTypedKeys,
    getOrSetFromMap,
    makeWritable,
    mapObjectValues,
    omitObjectKeys,
    type Coords,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {
    defineShape,
    enumShape,
    exactShape,
    intersectShape,
    optionalShape,
    partialShape,
    unionShape,
} from 'object-shape-tester';
import box2dFactory, {type MainModule as Box2dModule} from './box2d/box2d.mjs';

/**
 * The geometry of one physics shape.
 *
 * @category Main
 */
export enum ShapeType {
    Circle = 'circle',
    /** A rectangle with round ends: every point within `radius` of the line between its centers. */
    Capsule = 'capsule',
    /** A single line between two points, colliding from either side. */
    Segment = 'segment',
    Box = 'box',
    /** The smallest convex polygon that wraps a set of points. */
    Polygon = 'polygon',
    /**
     * A line through a series of points, such as terrain. Shapes collide with it from either side.
     * An open chain's ends act as if the line continued straight past them.
     */
    Chain = 'chain',
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
    /**
     * Slows shapes rolling against this one, like a ball on grass. Only affects contacts where one
     * shape has a radius: circles, capsules, and rounded boxes and polygons.
     *
     * @default 0
     */
    rollingResistance: number;
    /**
     * Moves shapes touching this one along its surface at this speed in game units per second, like
     * a conveyor belt. Positive speeds carry them around this shape in the opposite direction to a
     * positive rotation.
     *
     * @default 0
     */
    tangentSpeed: number;
    /**
     * Tells surfaces apart in the world's `mixFriction` and `mixRestitution` hooks. A whole number
     * from 0 to 2147483647.
     *
     * @default 0
     */
    userMaterialId: number;
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
          type: ShapeType.Capsule;
          center1: Coords;
          center2: Coords;
          radius: number;
      }
    | {
          type: ShapeType.Segment;
          point1: Coords;
          point2: Coords;
      }
    | ({
          type: ShapeType.Box;
          width: number;
          height: number;
      } & PartialWithUndefined<{
          /** Rounds the corners without changing the box's size. At most half the width and height. */
          cornerRadius: number;
      }>)
    | ({
          type: ShapeType.Polygon;
          /** 3 to 8 points that don't all lie on one line. */
          points: ReadonlyArray<Readonly<Coords>>;
      } & PartialWithUndefined<{
          /** Grows the polygon outward by this much on every side, rounding its corners. */
          cornerRadius: number;
      }>)
    | ({
          type: ShapeType.Chain;
          /** At least 2 points, or at least 3 for a loop. */
          points: ReadonlyArray<Readonly<Coords>>;
          /** Box2D chains can't be sensors. */
          isSensor?: undefined;
          /** Box2D chains don't support custom filtering. */
          enableCustomFiltering?: undefined;
          /** Box2D chains don't support pre-solve hooks. */
          enablePreSolve?: undefined;
          /**
           * Chains are already one-way: each segment only collides on its right side, looking from
           * one point to the next.
           */
          oneWayDirection?: undefined;
      } & PartialWithUndefined<{
          /** Connects the last point back to the first. */
          isLoop: boolean;
          /**
           * A material for each segment, in point order, filling in values left out of `material`.
           * Needs one entry per segment: one less than the point count, or the point count for a
           * loop.
           */
          segmentMaterials: ReadonlyArray<Readonly<Omit<PhysicsMaterial, 'density'>>>;
      }>)
) &
    PartialWithUndefined<{
        /** Where the shape's center sits relative to the body's position. */
        offset: Coords;
        material: PhysicsMaterial;
        /**
         * Makes the shape detect overlaps instead of colliding, reporting them to the `sensorStart`
         * and `sensorEnd` entity hooks. It senses the same entity classes it would otherwise touch.
         * Sensors never sense other sensors.
         */
        isSensor: boolean;
        /**
         * Makes the shape collide only with things on the side this points to, relative to the
         * body's rotation. Point it against gravity for a platform that can be jumped up through. A
         * shape that touches it from any other side passes through until they stop touching.
         */
        oneWayDirection: Coords;
        /** Asks the world's `customFilter` hook whether this shape may touch each shape it meets. */
        enableCustomFiltering: boolean;
        /** Runs the world's `preSolve` hook for this shape's contacts. */
        enablePreSolve: boolean;
        /**
         * Overrides the collision filter between shapes with the same non-zero group: positive
         * groups always collide and negative groups never do, such as the parts of one ragdoll.
         */
        collisionGroup: number;
    }>;

/**
 * A shape that {@link PhysicsWorld2d.castShape} can sweep through the world.
 *
 * @category Internal
 */
export type CastShapeDefinition = Extract<
    PhysicsShapeDefinition,
    {
        type: CastShapeType;
    }
>;

/**
 * The shape types that casts support.
 *
 * @category Internal
 */
export type CastShapeType =
    | ShapeType.Circle
    | ShapeType.Capsule
    | ShapeType.Segment
    | ShapeType.Box
    | ShapeType.Polygon;

/**
 * The closest shape a ray or shape cast hit.
 *
 * @category Internal
 */
export type CastHit2d = {
    /** The entity whose shape was hit. */
    entityId: number;
    /** Where the hit happened, in world space. */
    point: Coords;
    /** The hit surface's direction, pointing back toward the cast. */
    normal: Coords;
    /** How far along `translation` the hit happened, from 0 to 1. */
    fraction: number;
};

/**
 * A collision reported to the `contactHit` entity hook.
 *
 * @category Internal
 */
export type Hit2d = {
    /** Where the shapes hit, in world space. */
    point: Coords;
    /** Points from the other entity toward this one. */
    normal: Coords;
    /** How fast the shapes were closing in on each other, in game units per second. Always positive. */
    approachSpeed: number;
};

/**
 * Options shared by every cast.
 *
 * @category Internal
 */
export type CastFilter = PartialWithUndefined<{
    /**
     * Selects what the cast can hit. A shape is hit when its category is in `mask` and its own mask
     * includes `category`. Leave it out to hit every shape.
     */
    filter: Readonly<CollisionFilter>;
}>;

/**
 * The capsule a character mover sweeps and collides, relative to the position passed with it. Use
 * the same point for both centers to make a circle.
 *
 * @category Internal
 */
export type MoverCapsule2d = {
    center1: Coords;
    center2: Coords;
    radius: number;
};

/**
 * A surface touching a character mover, found by {@link PhysicsWorld2d.collideMover}. The plane is
 * relative to the mover's position.
 *
 * @category Internal
 */
export type MoverPlane2d = {
    /** The entity whose shape the mover touches. */
    entityId: number;
    /** Points out of the surface, toward the mover. */
    normal: Coords;
    /** How deep the mover overlaps the shape along `normal`. 0 when they only touch. */
    offset: number;
    /** The closest point on the touched shape, in world space. */
    point: Coords;
};

/**
 * A plane that {@link PhysicsWorld2d.solveMoverPlanes} keeps a character mover out of.
 *
 * @category Internal
 */
export type MoverCollisionPlane2d = Pick<MoverPlane2d, 'normal' | 'offset'> &
    PartialWithUndefined<{
        /**
         * How far the plane can push the mover in one solve. Lower values make the surface soft.
         *
         * @default Infinity
         */
        pushLimit: number;
        /** Lets the mover keep its velocity into this plane, as on soft surfaces. */
        isSoft: boolean;
    }>;

/**
 * The physics body of an entity class.
 *
 * @category Internal
 */
export type EntityPhysicsDefinition = BaseEntityPhysicsDefinition<PhysicsShapeDefinition> &
    PartialWithUndefined<{
        /** Stops the body from moving along the locked axes or from turning. */
        motionLocks: Partial<MotionLocks2d>;
    }>;

/**
 * Which axes a body can't move along (`linear`) and whether it can't turn (`angularZ`).
 *
 * @category Internal
 */
export type MotionLocks2d = BodyState['motionLocks'];

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
}>;

/**
 * The world settings in the order the bindings read them, so don't reorder them.
 *
 * @category Internal
 */
export const worldSettingsTemplate = {
    /** Game units per second. Slower collisions don't bounce, so resting bodies can settle. */
    restitutionThreshold: 0,
    /** How many passes each step spends on bounces. More passes spin boxes less. */
    restitutionIterations: 0,
    /** Passes bounces through every touching body, like a Newton's cradle. Expensive. */
    enableRestitutionPropagation: false,
    /** Cycles per second. Stiffer contacts push overlapping shapes apart faster but can jitter. */
    contactHertz: 0,
    /** Lower values push overlapping shapes apart more energetically. */
    contactDampingRatio: 0,
    /** Game units per second. The fastest that contacts push overlapping shapes apart. */
    contactSpeed: 0,
    /** Game units per second. No body moves faster. */
    maximumLinearSpeed: 0,
    /**
     * Game units. Touching shapes reuse their contact points until they move this far apart, and 0
     * recomputes the points every step.
     */
    contactRecycleDistance: 0,
    /** Keeps every body awake, overriding each body's own sleep setting. */
    isSleepDisabled: false,
    /** Lets fast bodies tunnel through static bodies for a minor speedup. */
    isContinuousDisabled: false,
    /** Makes stacks much less stable for no speedup. Box2D offers this for testing. */
    isWarmStartingDisabled: false,
};

/**
 * Settings for a whole {@link PhysicsWorld2d}, which keeps them through {@link PhysicsWorld2d.reset}.
 * Snapshots don't include them.
 *
 * @category Internal
 */
export type WorldSettings2d = typeof worldSettingsTemplate;

function assertValidWorldSettings(settings: Readonly<WorldSettings2d>) {
    getObjectTypedEntries(settings).forEach(
        ([
            key,
            value,
        ]) => {
            if (!check.isBoolean(value) && !(Number.isFinite(value) && value >= 0)) {
                throw new Error(
                    `World setting ${key} must be a finite number of 0 or more, got ${value}.`,
                );
            }
        },
    );
    if (settings.maximumLinearSpeed === 0) {
        throw new Error('World setting maximumLinearSpeed must be more than 0.');
    } else if (
        !Number.isInteger(settings.restitutionIterations) ||
        settings.restitutionIterations > 63
    ) {
        throw new Error(
            `World setting restitutionIterations must be a whole number up to 63, got ${settings.restitutionIterations}.`,
        );
    }
}

const surfaceMaterialShapeInit = {
    friction: optionalShape(0, {
        alsoUndefined: true,
    }),
    restitution: optionalShape(0, {
        alsoUndefined: true,
    }),
    rollingResistance: optionalShape(0, {
        alsoUndefined: true,
    }),
    tangentSpeed: optionalShape(0, {
        alsoUndefined: true,
    }),
    userMaterialId: optionalShape(0, {
        alsoUndefined: true,
    }),
};

const shapeSettingsShapeInit = {
    offset: optionalShape(
        {
            x: 0,
            y: 0,
        },
        {
            alsoUndefined: true,
        },
    ),
    material: optionalShape(
        {
            density: optionalShape(0, {
                alsoUndefined: true,
            }),
            ...surfaceMaterialShapeInit,
        },
        {
            alsoUndefined: true,
        },
    ),
    collisionGroup: optionalShape(0, {
        alsoUndefined: true,
    }),
};

const sensorShapeSettingsShape = defineShape({
    ...shapeSettingsShapeInit,
    isSensor: optionalShape(false, {
        alsoUndefined: true,
    }),
    oneWayDirection: optionalShape(
        {
            x: 0,
            y: 0,
        },
        {
            alsoUndefined: true,
        },
    ),
    enableCustomFiltering: optionalShape(false, {
        alsoUndefined: true,
    }),
    enablePreSolve: optionalShape(false, {
        alsoUndefined: true,
    }),
});

/**
 * Shape definition for {@link PhysicsShapeDefinition}.
 *
 * @category Internal
 */
export const physicsShapeDefinitionShape = unionShape(
    intersectShape(
        defineShape({
            type: exactShape(ShapeType.Circle),
            radius: 0,
        }),
        sensorShapeSettingsShape,
    ),
    intersectShape(
        defineShape({
            type: exactShape(ShapeType.Capsule),
            center1: {
                x: 0,
                y: 0,
            },
            center2: {
                x: 0,
                y: 0,
            },
            radius: 0,
        }),
        sensorShapeSettingsShape,
    ),
    intersectShape(
        defineShape({
            type: exactShape(ShapeType.Segment),
            point1: {
                x: 0,
                y: 0,
            },
            point2: {
                x: 0,
                y: 0,
            },
        }),
        sensorShapeSettingsShape,
    ),
    intersectShape(
        defineShape({
            type: exactShape(ShapeType.Box),
            width: 0,
            height: 0,
        }),
        sensorShapeSettingsShape,
        defineShape({
            cornerRadius: optionalShape(0, {
                alsoUndefined: true,
            }),
        }),
    ),
    intersectShape(
        defineShape({
            type: exactShape(ShapeType.Polygon),
            points: [
                {
                    x: 0,
                    y: 0,
                },
            ],
        }),
        sensorShapeSettingsShape,
        defineShape({
            cornerRadius: optionalShape(0, {
                alsoUndefined: true,
            }),
        }),
    ),
    intersectShape(
        defineShape({
            type: exactShape(ShapeType.Chain),
            points: [
                {
                    x: 0,
                    y: 0,
                },
            ],
        }),
        defineShape({
            ...shapeSettingsShapeInit,
            isLoop: optionalShape(false, {
                alsoUndefined: true,
            }),
            segmentMaterials: optionalShape([surfaceMaterialShapeInit], {
                alsoUndefined: true,
            }),
        }),
    ),
);

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
    type: enumShape(BodyType, BodyType.Static),
    gravityScale: 1,
    linearDamping: 0,
    angularDamping: 0,
    /** Game units per second. */
    sleepThreshold: 0,
    isSleepDisabled: false,
    enableHitEvents: false,
    isDisabled: false,
    isBullet: false,
    motionLocks: {
        linearX: false,
        linearY: false,
        angularZ: false,
    },
    /**
     * Material values from {@link EntityPhysics2d.setMaterial}, used on every shape in place of the
     * values in the shape definitions.
     */
    material: {
        density: optionalShape(0, {
            alsoUndefined: true,
        }),
        friction: optionalShape(0, {
            alsoUndefined: true,
        }),
        restitution: optionalShape(0, {
            alsoUndefined: true,
        }),
        rollingResistance: optionalShape(0, {
            alsoUndefined: true,
        }),
        tangentSpeed: optionalShape(0, {
            alsoUndefined: true,
        }),
        userMaterialId: optionalShape(0, {
            alsoUndefined: true,
        }),
    },
    /** Shapes from {@link EntityPhysics2d.setShapes}, used in place of the physics definition's. */
    shapes: optionalShape([physicsShapeDefinitionShape], {
        alsoUndefined: true,
    }),
    /** From {@link EntityPhysics2d.setMassData}, used in place of the mass from the shapes. */
    massData: optionalShape(
        {
            mass: 0,
            /** In body space. */
            center: {
                x: 0,
                y: 0,
            },
            /** Around `center`. */
            rotationalInertia: 0,
        },
        {
            alsoUndefined: true,
        },
    ),
});

/**
 * Everything about a body that changes as it moves or that its methods can change. Included in
 * entity snapshots.
 *
 * @category Internal
 */
export type BodyState = typeof bodyStateShape.runtimeType;

/**
 * Where a new body starts. Leave any field out for a body at rest at the origin, with the rest of
 * its settings from its physics definition.
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
 * A body's mass, where its center of mass is, and how hard it is to spin.
 *
 * @category Internal
 */
export type MassData2d = NonNullable<BodyState['massData']>;

/**
 * A position and rotation.
 *
 * @category Internal
 */
export type Transform2d = {
    position: Coords;
    rotation: number;
};

/**
 * A body's or joint's id in Box2D, which is 8 bytes and so is split across two numbers.
 *
 * @category Internal
 */
export type Box2dId = {
    index: number;
    tag: number;
};

/** The values of Box2D's `b2BodyType` enum. */
const box2dBodyTypes: Record<BodyType, number> = {
    [BodyType.Static]: 0,
    [BodyType.Kinematic]: 1,
    [BodyType.Dynamic]: 2,
};

const subStepCount = 4;

/** The largest 32-bit float, which Box2D's default drawing bounds reach to. */
const maxFloat32 = 3.4028234663852886e38;

/**
 * The default debug drawing options, in the order the bindings read them.
 *
 * @category Internal
 */
export const debugDrawTemplate = {
    /** Only things overlapping these bounds are drawn. Everything is drawn by default. */
    bounds: {
        lower: {
            x: -maxFloat32,
            y: -maxFloat32,
        },
        upper: {
            x: maxFloat32,
            y: maxFloat32,
        },
    },
    /** Scales the length of drawn contact and friction forces. */
    forceScale: 1,
    /** Scales the size of drawn joints. */
    jointScale: 1,
    drawContacts: false,
    /** Draws contact points on the first shape of each contact instead of the second. */
    drawAnchorA: false,
    drawShapes: false,
    drawChainNormals: false,
    drawJoints: false,
    /** Draws joint details, such as limits and anchor frames. */
    drawJointExtras: false,
    /** Draws each shape's bounding box. */
    drawBounds: false,
    /** Draws each dynamic body's center of mass. */
    drawMass: false,
    drawBodyNames: false,
    /** Colors contacts and joints by the solver batch (graph color) they are solved in. */
    drawGraphColors: false,
    /** Labels contact points with their feature ids. */
    drawContactFeatures: false,
    drawContactNormals: false,
    drawContactForces: false,
    drawFrictionForces: false,
    /** Draws the bounding box of each island of touching bodies. */
    drawIslands: false,
};

/**
 * What {@link PhysicsWorld2d.drawDebug} draws. Nothing is drawn unless enabled.
 *
 * @category Internal
 */
export type DebugDrawOptions2d = PartialWithUndefined<typeof debugDrawTemplate>;

/**
 * Everything Box2D's debug drawing drew, in world space. Rotations are in radians, and colors are
 * `0xRRGGBB`.
 *
 * @category Internal
 */
export type DebugDrawing2d = {
    polygons: {
        vertices: Coords[];
        color: number;
    }[];
    /** Filled polygons, rounded by `radius`. */
    solidPolygons: {
        vertices: Coords[];
        radius: number;
        color: number;
    }[];
    circles: {
        center: Coords;
        radius: number;
        color: number;
    }[];
    /** Filled circles, with the rotation of their body. */
    solidCircles: {
        center: Coords;
        radius: number;
        rotation: number;
        color: number;
    }[];
    solidCapsules: {
        start: Coords;
        end: Coords;
        radius: number;
        color: number;
    }[];
    lines: {
        start: Coords;
        end: Coords;
        color: number;
    }[];
    /** Body frames, drawn at a length of your choosing. */
    transforms: Transform2d[];
    points: {
        position: Coords;
        /** In pixels, not game units. */
        size: number;
        color: number;
    }[];
    strings: {
        position: Coords;
        text: string;
        color: number;
    }[];
    bounds: {
        lower: Coords;
        upper: Coords;
        color: number;
    }[];
};

/** The values of the `DrawKind` enum in bindings.c. */
enum DrawKind {
    Polygon,
    SolidPolygon,
    Circle,
    SolidCircle,
    SolidCapsule,
    Line,
    Transform,
    Point,
    String,
    Bounds,
}

/** Reads numbers in order out of a drawing. */
type DrawingReader = {
    next(): number;
    nextCoords(): Coords;
};

const drawingReaders: Record<
    DrawKind,
    (reader: Readonly<DrawingReader>, drawing: Readonly<DebugDrawing2d>) => void
> = {
    [DrawKind.Polygon](reader, drawing) {
        drawing.polygons.push({
            vertices: createArray(reader.next(), () => reader.nextCoords()),
            color: reader.next(),
        });
    },
    [DrawKind.SolidPolygon](reader, drawing) {
        drawing.solidPolygons.push({
            vertices: createArray(reader.next(), () => reader.nextCoords()),
            radius: reader.next(),
            color: reader.next(),
        });
    },
    [DrawKind.Circle](reader, drawing) {
        drawing.circles.push({
            center: reader.nextCoords(),
            radius: reader.next(),
            color: reader.next(),
        });
    },
    [DrawKind.SolidCircle](reader, drawing) {
        drawing.solidCircles.push({
            center: reader.nextCoords(),
            radius: reader.next(),
            rotation: reader.next(),
            color: reader.next(),
        });
    },
    [DrawKind.SolidCapsule](reader, drawing) {
        drawing.solidCapsules.push({
            start: reader.nextCoords(),
            end: reader.nextCoords(),
            radius: reader.next(),
            color: reader.next(),
        });
    },
    [DrawKind.Line](reader, drawing) {
        drawing.lines.push({
            start: reader.nextCoords(),
            end: reader.nextCoords(),
            color: reader.next(),
        });
    },
    [DrawKind.Transform](reader, drawing) {
        drawing.transforms.push({
            position: reader.nextCoords(),
            rotation: reader.next(),
        });
    },
    [DrawKind.Point](reader, drawing) {
        drawing.points.push({
            position: reader.nextCoords(),
            size: reader.next(),
            color: reader.next(),
        });
    },
    [DrawKind.String](reader, drawing) {
        const position = reader.nextCoords();
        const color = reader.next();
        drawing.strings.push({
            position,
            text: String.fromCodePoint(...createArray(reader.next(), () => reader.next())),
            color,
        });
    },
    [DrawKind.Bounds](reader, drawing) {
        drawing.bounds.push({
            lower: reader.nextCoords(),
            upper: reader.nextCoords(),
            color: reader.next(),
        });
    },
};

function writeDebugDrawOptions(box2d: Box2dModule, options: Readonly<DebugDrawOptions2d>) {
    writeInputFloats(
        box2d,
        flattenBindingValues(debugDrawTemplate, {
            ...debugDrawTemplate,
            ...filterObject(options, (key, value) => value != undefined),
        }),
    );
}

/** Reads the drawing a `drawWorld` or `drawReplay` binding call returned. */
function readDrawing(box2d: Box2dModule, pointer: number): DebugDrawing2d {
    const [
        start,
        count,
    ] = readWasmInt32s(box2d, pointer, 2);
    const values = box2d.HEAPF32.subarray(
        start / Float32Array.BYTES_PER_ELEMENT,
        start / Float32Array.BYTES_PER_ELEMENT + count,
    ).values();
    const reader: DrawingReader = {
        next() {
            return assertWrap.isDefined(values.next().value);
        },
        nextCoords() {
            return {
                x: reader.next(),
                y: reader.next(),
            };
        },
    };
    const drawing: DebugDrawing2d = {
        polygons: [],
        solidPolygons: [],
        circles: [],
        solidCircles: [],
        solidCapsules: [],
        lines: [],
        transforms: [],
        points: [],
        strings: [],
        bounds: [],
    };
    for (let kind = values.next(); !kind.done; kind = values.next()) {
        drawingReaders[assertWrap.isEnumValue(kind.value, DrawKind)](reader, drawing);
    }
    return drawing;
}

/**
 * The step profile timings, in the order the bindings write them.
 *
 * @category Internal
 */
export const profileTemplate = {
    step: 0,
    pairs: 0,
    collide: 0,
    solve: 0,
    solverSetup: 0,
    constraints: 0,
    prepareConstraints: 0,
    integrateVelocities: 0,
    warmStart: 0,
    solveImpulses: 0,
    integratePositions: 0,
    relaxImpulses: 0,
    restitution: 0,
    storeImpulses: 0,
    splitIslands: 0,
    transforms: 0,
    sensorHits: 0,
    jointEvents: 0,
    hitEvents: 0,
    refit: 0,
    bullets: 0,
    sleepIslands: 0,
    sensors: 0,
};

/**
 * How many milliseconds each part of the last step took.
 *
 * @category Internal
 */
export type PhysicsProfile2d = typeof profileTemplate;

/**
 * The world counters, in the order the bindings write them.
 *
 * @category Internal
 */
export const countersTemplate = {
    /** Memory Box2D has allocated. */
    byteCount: 0,
    bodyCount: 0,
    shapeCount: 0,
    contactCount: 0,
    jointCount: 0,
    islandCount: 0,
    /** Bytes of Box2D's step stack used by the last step. */
    stackUsed: 0,
    /** Height of the tree holding static shapes. */
    staticTreeHeight: 0,
    /** Height of the tallest tree holding moving shapes. */
    treeHeight: 0,
    taskCount: 0,
    /** Contacts the last step checked for collision. */
    awakeContactCount: 0,
    /** Contacts the last step reused the points of. */
    recycledContactCount: 0,
};

/**
 * The size of a world's simulation.
 *
 * @category Internal
 */
export type PhysicsCounters2d = typeof countersTemplate & {
    /** How many contacts and joints are in each solver batch (graph color), the last being overflow. */
    colorCounts: number[];
};

/** Box2D's `B2_GRAPH_COLOR_COUNT`. */
const graphColorCount = 24;

/** The return values of `startRecording` in bindings.c. */
enum RecordingStart {
    Started,
    AlreadyRecording,
    HasHooks,
    HasPreSolveShapes,
}

const recordingHooksMessage = 'A recording physics world cannot have hooks.';
const recordingPreSolveMessage =
    'A recording physics world cannot have shapes with oneWayDirection or enablePreSolve.';

/**
 * Which world query a recording saw. Values match Box2D's `b2ReplayQueryType`.
 *
 * @category Internal
 */
export enum ReplayQueryType2d {
    OverlapBounds,
    OverlapShape,
    CastRay,
    CastShape,
    CollideMover,
    CastRayClosest,
    CastMover,
}

/**
 * A world query made during one recorded frame, and what it found.
 *
 * @category Internal
 */
export type ReplayQuery2d = {
    type: ReplayQueryType2d;
    filter: CollisionFilter;
    /** For overlap queries, relative to `origin`. */
    bounds: {
        lower: Coords;
        upper: Coords;
    };
    origin: Coords;
    translation: Coords;
    hits: {
        /**
         * The hit body's place in the order the recording's bodies were created, matching
         * {@link PhysicsReplay2d.getBodies}. Undefined when the body no longer exists.
         */
        bodyIndex: number | undefined;
        point: Coords;
        normal: Coords;
        fraction: number;
    }[];
};

/** The int32 values `readReplayQuery` in bindings.c writes before each query's hits. */
const replayQueryLength = 14;
/** The int32 values `readReplayQuery` in bindings.c writes for each hit. */
const replayQueryHitLength = 6;
/** `sizeof(b2RecHeader)` in Box2D. */
const recordingHeaderLength = 32;

/**
 * Callbacks the world runs while stepping. See {@link PhysicsWorld2d.setHooks}.
 *
 * @category Internal
 */
export type WorldHooks2d = WorldHooks<Coords>;

/**
 * The Box2D WebAssembly module, plus the hooks its C bindings call back into.
 *
 * @category Internal
 */
export type LoadedBox2d = Box2dModule & {
    /** Read by bindings.c, keyed by world id. */
    anthaWorldHooks: Map<number, () => WorldHooks2d>;
};

const box2dModules = new Map<number, Promise<LoadedBox2d>>();

/**
 * Loads one Box2D module per length scale, because `b2SetLengthUnitsPerMeter` applies to a whole
 * module.
 */
async function loadBox2d(pixelsPerMeter: number) {
    return await getOrSetFromMap(box2dModules, pixelsPerMeter, async () => {
        const box2d = await box2dFactory();
        box2d._setLengthUnitsPerMeter(pixelsPerMeter);
        return Object.assign(box2d, {
            anthaWorldHooks: new Map<number, () => WorldHooks2d>(),
        });
    });
}

function readCoords(box2d: Box2dModule, pointer: number) {
    const [
        x,
        y,
    ] = readWasmFloat32s(box2d, pointer, 2);
    return {
        x,
        y,
    };
}

/** Writes points where the next binding call reads them, moved by `offset`. */
function writePoints(
    box2d: Box2dModule,
    points: ReadonlyArray<Readonly<Coords>>,
    offset: Readonly<Coords> | undefined,
) {
    const pointer = box2d._reserveInput(points.length * 2 * Float32Array.BYTES_PER_ELEMENT);
    box2d.HEAPF32.set(
        points.flatMap((point) => {
            return [
                point.x + (offset?.x ?? 0),
                point.y + (offset?.y ?? 0),
            ];
        }),
        pointer / Float32Array.BYTES_PER_ELEMENT,
    );
}

const allBits = 2n ** 64n - 1n;

const collinearPolygonMessage = 'Polygon points must not all lie on one line.';

/** Box2D's `B2_MAX_POLYGON_VERTICES`. */
const maxPolygonPointCount = 8;

function readHit(box2d: Box2dModule, pointer: number): CastHit2d | undefined {
    const [
        isHit,
        entityId,
    ] = readWasmInt32s(box2d, pointer, 2);
    if (!isHit) {
        return undefined;
    }
    const [
        pointX,
        pointY,
        normalX,
        normalY,
        fraction,
    ] = readWasmFloat32s(box2d, pointer + 2 * Int32Array.BYTES_PER_ELEMENT, 5);
    return {
        entityId,
        point: {
            x: pointX,
            y: pointY,
        },
        normal: {
            x: normalX,
            y: normalY,
        },
        fraction,
    };
}

/** The bit for each motion lock, as `loadMotionLocks` in `bindings.c` reads them. */
const motionLockBits: Record<keyof MotionLocks2d, number> = {
    linearX: 1,
    linearY: 2,
    angularZ: 4,
};

function writeMotionLocks(motionLocks: Readonly<Partial<MotionLocks2d>>) {
    return getObjectTypedKeys(motionLockBits).reduce((bits, lock) => {
        return motionLocks[lock] ? bits | motionLockBits[lock] : bits;
    }, 0);
}

function readBodyType(box2dType: number) {
    return assertWrap.isDefined(
        getObjectTypedKeys(box2dBodyTypes).find((bodyType) => {
            return box2dBodyTypes[bodyType] === box2dType;
        }),
    );
}

function readSettings(box2d: Box2dModule, bodyId: Readonly<Box2dId>) {
    const pointer = box2d._readSettings(bodyId.index, bodyId.tag);
    const [
        type,
        isEnabled,
        isBullet,
        isAwake,
        motionLocks,
    ] = readWasmInt32s(box2d, pointer, 5);
    const [
        gravityScale,
        linearDamping,
        angularDamping,
        sleepThreshold,
    ] = readWasmFloat32s(box2d, pointer + 5 * Int32Array.BYTES_PER_ELEMENT, 4);
    return {
        type: readBodyType(type),
        isDisabled: !isEnabled,
        isBullet: !!isBullet,
        isAwake: !!isAwake,
        /** `mapObjectValues` would type this as all `true` or all `false`. */
        motionLocks: mapObjectValues(motionLockBits, (lock, bit) => {
            return !!(motionLocks & bit);
        }) satisfies Record<keyof MotionLocks2d, boolean> as MotionLocks2d,
        gravityScale,
        linearDamping,
        angularDamping,
        sleepThreshold,
    };
}

/** Undefined goes back to the mass from the body's shapes. */
function writeMassData(
    box2d: Box2dModule,
    bodyId: Readonly<Box2dId>,
    massData: Readonly<MassData2d> | undefined,
) {
    box2d._setMassData(
        bodyId.index,
        bodyId.tag,
        massData?.mass ?? Number.NaN,
        massData?.center.x ?? 0,
        massData?.center.y ?? 0,
        massData?.rotationalInertia ?? 0,
    );
}

function assertValidMassData(massData: Readonly<MassData2d>) {
    const isInvalid = [
        massData.mass,
        massData.rotationalInertia,
    ].some((value) => {
        return Number.isNaN(value) || value < 0;
    });
    if (isInvalid) {
        throw new Error(
            `Mass and rotational inertia must be 0 or more, got ${massData.mass} and ${massData.rotationalInertia}.`,
        );
    }
}

function readMotion(box2d: Box2dModule, bodyId: Readonly<Box2dId>) {
    const pointer = box2d._readBody(bodyId.index, bodyId.tag);
    const [
        x,
        y,
        cosine,
        sine,
        angle,
        velocityX,
        velocityY,
        angularVelocity,
    ] = readWasmFloat32s(box2d, pointer, 8);
    return {
        position: {
            x,
            y,
        },
        rotation: {
            cosine,
            sine,
        },
        angle,
        velocity: {
            x: velocityX,
            y: velocityY,
        },
        angularVelocity,
    };
}

function makeRotation(box2d: Box2dModule, angle: number): BodyState['rotation'] {
    const pointer = box2d._makeRotation(angle);
    const [
        cosine,
        sine,
    ] = readWasmFloat32s(box2d, pointer, 2);
    return {
        cosine,
        sine,
    };
}

type ShapeCreatorParams<Shape extends PhysicsShapeDefinition> = {
    box2d: Box2dModule;
    bodyId: Readonly<Box2dId>;
    shape: Readonly<Shape>;
    materialOverride: Readonly<PhysicsMaterial>;
};

const shapeCreators: {
    [Type in ShapeType]: (
        params: Readonly<ShapeCreatorParams<Extract<PhysicsShapeDefinition, {type: Type}>>>,
    ) => void;
} = {
    [ShapeType.Circle]({box2d, bodyId, shape}) {
        box2d._addCircle(
            bodyId.index,
            bodyId.tag,
            shape.offset?.x ?? 0,
            shape.offset?.y ?? 0,
            shape.radius,
        );
    },
    [ShapeType.Capsule]({box2d, bodyId, shape}) {
        box2d._addCapsule(
            bodyId.index,
            bodyId.tag,
            shape.center1.x + (shape.offset?.x ?? 0),
            shape.center1.y + (shape.offset?.y ?? 0),
            shape.center2.x + (shape.offset?.x ?? 0),
            shape.center2.y + (shape.offset?.y ?? 0),
            shape.radius,
        );
    },
    [ShapeType.Segment]({box2d, bodyId, shape}) {
        box2d._addSegment(
            bodyId.index,
            bodyId.tag,
            shape.point1.x + (shape.offset?.x ?? 0),
            shape.point1.y + (shape.offset?.y ?? 0),
            shape.point2.x + (shape.offset?.x ?? 0),
            shape.point2.y + (shape.offset?.y ?? 0),
        );
    },
    [ShapeType.Box]({box2d, bodyId, shape}) {
        const cornerRadius = shape.cornerRadius ?? 0;
        box2d._addBox(
            bodyId.index,
            bodyId.tag,
            shape.offset?.x ?? 0,
            shape.offset?.y ?? 0,
            shape.width / 2 - cornerRadius,
            shape.height / 2 - cornerRadius,
            cornerRadius,
        );
    },
    [ShapeType.Polygon]({box2d, bodyId, shape}) {
        writePoints(box2d, shape.points, shape.offset);
        if (
            !box2d._addPolygon(
                bodyId.index,
                bodyId.tag,
                shape.points.length,
                shape.cornerRadius ?? 0,
            )
        ) {
            throw new Error(collinearPolygonMessage);
        }
    },
    [ShapeType.Chain]({box2d, bodyId, shape, materialOverride}) {
        const segmentMaterials = shape.segmentMaterials ?? [];
        const floats = [
            ...shape.points.flatMap((point) => {
                return [
                    point.x + (shape.offset?.x ?? 0),
                    point.y + (shape.offset?.y ?? 0),
                ];
            }),
            ...segmentMaterials.flatMap((material) => {
                return [
                    materialOverride.friction ?? material.friction ?? Number.NaN,
                    materialOverride.restitution ?? material.restitution ?? Number.NaN,
                    materialOverride.rollingResistance ?? material.rollingResistance ?? Number.NaN,
                    materialOverride.tangentSpeed ?? material.tangentSpeed ?? Number.NaN,
                ];
            }),
        ];
        const pointer = box2d._reserveInput(
            (floats.length + segmentMaterials.length) * Float32Array.BYTES_PER_ELEMENT,
        );
        box2d.HEAPF32.set(floats, pointer / Float32Array.BYTES_PER_ELEMENT);
        box2d.HEAP32.set(
            segmentMaterials.map((material) => {
                return materialOverride.userMaterialId ?? material.userMaterialId ?? -1;
            }),
            pointer / Int32Array.BYTES_PER_ELEMENT + floats.length,
        );
        box2d._addChain(
            bodyId.index,
            bodyId.tag,
            shape.points.length,
            Number(!!shape.isLoop),
            shape.segmentMaterials?.length ?? 0,
        );
    },
};

/**
 * Adds shapes to a body. Values in `materialOverride` replace the shapes' own material values.
 *
 * @throws Error if Box2D rejects a polygon. Call {@link assertValidShapes} first to catch the rest.
 */
function addShapes({
    box2d,
    bodyId,
    shapes,
    materialOverride,
    filter,
    entityId,
    enableHitEvents,
}: Readonly<{
    box2d: Box2dModule;
    bodyId: Readonly<Box2dId>;
    shapes: ReadonlyArray<Readonly<PhysicsShapeDefinition>>;
    materialOverride: Readonly<PhysicsMaterial>;
    filter: Readonly<CollisionFilter>;
    entityId: number;
    enableHitEvents: boolean;
}>) {
    shapes.forEach((shape) => {
        box2d._setShapeDefinition(
            filter.category,
            filter.mask,
            shape.collisionGroup ?? 0,
            entityId,
            materialOverride.density ?? shape.material?.density ?? Number.NaN,
            materialOverride.friction ?? shape.material?.friction ?? Number.NaN,
            materialOverride.restitution ?? shape.material?.restitution ?? Number.NaN,
            materialOverride.rollingResistance ?? shape.material?.rollingResistance ?? Number.NaN,
            materialOverride.tangentSpeed ?? shape.material?.tangentSpeed ?? Number.NaN,
            materialOverride.userMaterialId ?? shape.material?.userMaterialId ?? -1,
            Number(!!shape.isSensor),
            Number(enableHitEvents),
            Number(!!shape.enableCustomFiltering),
            Number(!!shape.enablePreSolve),
            shape.oneWayDirection?.x ?? Number.NaN,
            shape.oneWayDirection?.y ?? Number.NaN,
        );
        (
            shapeCreators[shape.type] satisfies (typeof shapeCreators)[ShapeType] as (
                params: Readonly<ShapeCreatorParams<PhysicsShapeDefinition>>,
            ) => void
        )({
            box2d,
            bodyId,
            shape,
            materialOverride,
        });
    });
}

/** Box2D stores `userMaterialId` as 64 bits, but the bindings pass it as a signed 32-bit integer. */
const maxUserMaterialId = 2 ** 31 - 1;

function assertValidUserMaterialId(material: Readonly<Pick<PhysicsMaterial, 'userMaterialId'>>) {
    if (
        material.userMaterialId != undefined &&
        !(
            Number.isInteger(material.userMaterialId) &&
            material.userMaterialId >= 0 &&
            material.userMaterialId <= maxUserMaterialId
        )
    ) {
        throw new Error(
            `A userMaterialId must be a whole number from 0 to ${maxUserMaterialId}, got ${material.userMaterialId}.`,
        );
    }
}

/**
 * Throws for shapes Box2D would reject, before any of the body is created.
 *
 * @throws Error describing the first invalid shape.
 */
function assertValidShapes(
    shapes: ReadonlyArray<Readonly<PhysicsShapeDefinition>>,
    isRecording = false,
) {
    shapes.forEach((shape) => {
        assertValidUserMaterialId(shape.material ?? {});
        if (isRecording && (shape.oneWayDirection || shape.enablePreSolve)) {
            throw new Error(recordingPreSolveMessage);
        } else if (
            shape.type === ShapeType.Polygon &&
            (shape.points.length < 3 || shape.points.length > maxPolygonPointCount)
        ) {
            throw new Error(
                `A polygon needs 3 to ${maxPolygonPointCount} points, got ${shape.points.length}.`,
            );
        } else if (
            (shape.type === ShapeType.Box &&
                (shape.cornerRadius ?? 0) > Math.min(shape.width, shape.height) / 2) ||
            ((shape.type === ShapeType.Box || shape.type === ShapeType.Polygon) &&
                (shape.cornerRadius ?? 0) < 0)
        ) {
            throw new Error(
                `A ${shape.type} corner radius must be from 0 to half its smallest side, got ${shape.cornerRadius}.`,
            );
        } else if (shape.type === ShapeType.Chain) {
            const minimumCount = shape.isLoop ? 3 : 2;
            if (shape.points.length < minimumCount) {
                throw new Error(
                    `A chain${shape.isLoop ? ' loop' : ''} needs at least ${minimumCount} points, got ${shape.points.length}.`,
                );
            }
            const segmentCount = shape.isLoop ? shape.points.length : shape.points.length - 1;
            if (shape.segmentMaterials && shape.segmentMaterials.length !== segmentCount) {
                throw new Error(
                    `A chain with ${segmentCount} segments needs ${segmentCount} segment materials, got ${shape.segmentMaterials.length}.`,
                );
            }
            shape.segmentMaterials?.forEach((material) => {
                assertValidUserMaterialId(material);
            });
        }
    });
}

/** Points around the cast shape's position, before its rotation, plus the radius that rounds them. */
const castShapeProxies: {
    [Type in CastShapeType]: (shape: Readonly<Extract<CastShapeDefinition, {type: Type}>>) => {
        points: ReadonlyArray<Readonly<Coords>>;
        radius: number;
    };
} = {
    [ShapeType.Circle](shape) {
        return {
            points: [
                {
                    x: 0,
                    y: 0,
                },
            ],
            radius: shape.radius,
        };
    },
    [ShapeType.Capsule](shape) {
        return {
            points: [
                shape.center1,
                shape.center2,
            ],
            radius: shape.radius,
        };
    },
    [ShapeType.Segment](shape) {
        return {
            points: [
                shape.point1,
                shape.point2,
            ],
            radius: 0,
        };
    },
    [ShapeType.Box](shape) {
        const cornerRadius = shape.cornerRadius ?? 0;
        const halfWidth = shape.width / 2 - cornerRadius;
        const halfHeight = shape.height / 2 - cornerRadius;
        return {
            points: [
                {
                    x: -halfWidth,
                    y: -halfHeight,
                },
                {
                    x: halfWidth,
                    y: -halfHeight,
                },
                {
                    x: halfWidth,
                    y: halfHeight,
                },
                {
                    x: -halfWidth,
                    y: halfHeight,
                },
            ],
            radius: cornerRadius,
        };
    },
    [ShapeType.Polygon](shape) {
        return {
            points: shape.points,
            radius: shape.cornerRadius ?? 0,
        };
    },
};

/** @throws Error if the shape is invalid. */
function readCastShapeProxy(shape: Readonly<CastShapeDefinition>) {
    assertValidShapes([shape]);
    return (
        castShapeProxies[shape.type] satisfies (shape: any) => unknown as (
            shape: Readonly<CastShapeDefinition>,
        ) => ReturnType<(typeof castShapeProxies)[CastShapeType]>
    )(shape);
}

/**
 * Writes a cast or overlap shape's points where the next binding call reads them.
 *
 * @throws Error if the shape is invalid.
 */
function writeCastShape(box2d: Box2dModule, shape: Readonly<CastShapeDefinition>) {
    const proxy = readCastShapeProxy(shape);
    writePoints(box2d, proxy.points, shape.offset);
    return {
        pointCount: proxy.points.length,
        radius: proxy.radius,
    };
}

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

    protected readonly box2d: Box2dModule;
    /** The Box2D body this controls. */
    public readonly bodyId: Readonly<Box2dId>;
    /** See `material` in {@link BodyState}. */
    protected material: Readonly<PhysicsMaterial>;
    /** See `shapes` in {@link BodyState}. */
    protected shapes: ReadonlyArray<Readonly<PhysicsShapeDefinition>> | undefined;
    /** Shape settings that {@link EntityPhysics2d.setShapes} reuses for new shapes. */
    public readonly shapeSettings: Readonly<{
        filter: Readonly<CollisionFilter>;
        entityId: number;
        /** The physics definition's shapes, used while `shapes` is undefined. */
        definitionShapes: ReadonlyArray<Readonly<PhysicsShapeDefinition>>;
    }>;
    /** See `enableHitEvents` in {@link BodyState}. */
    protected enableHitEvents: boolean;
    /** See `isSleepDisabled` in {@link BodyState}. */
    protected isSleepDisabled: boolean;
    /** See `massData` in {@link BodyState}. */
    protected massData: Readonly<MassData2d> | undefined = undefined;

    constructor({
        box2d,
        bodyId,
        material,
        shapes,
        shapeSettings,
        enableHitEvents,
        isSleepDisabled,
    }: Readonly<
        Pick<EntityPhysics2d, 'bodyId'> & {
            box2d: Box2dModule;
            material: Readonly<PhysicsMaterial>;
            shapes: ReadonlyArray<Readonly<PhysicsShapeDefinition>> | undefined;
            shapeSettings: EntityPhysics2d['shapeSettings'];
            enableHitEvents: boolean;
            isSleepDisabled: boolean;
        }
    >) {
        this.box2d = box2d;
        this.bodyId = bodyId;
        this.material = material;
        this.shapes = shapes;
        this.shapeSettings = shapeSettings;
        this.enableHitEvents = enableHitEvents;
        this.isSleepDisabled = isSleepDisabled;
        this.currentTransform = this.readTransform();
        this.previousTransform = this.currentTransform;
    }

    /** Reads the body's current transform from Box2D. */
    protected readTransform(): Transform2d {
        const body = readMotion(this.box2d, this.bodyId);
        return {
            position: body.position,
            rotation: body.angle,
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
        return readMotion(this.box2d, this.bodyId).position;
    }

    /** Teleports the body. Its view jumps straight there instead of sliding. */
    public setPosition(position: Readonly<Coords>) {
        const {rotation} = readMotion(this.box2d, this.bodyId);
        this.box2d._setTransform(
            this.bodyId.index,
            this.bodyId.tag,
            position.x,
            position.y,
            rotation.cosine,
            rotation.sine,
        );
        this.snapTransform();
    }

    /**
     * Rotation in radians, clockwise on screen. Box2D stores rotations as an approximate cosine and
     * sine, so this can differ slightly from the angle last set.
     */
    public getRotation() {
        return readMotion(this.box2d, this.bodyId).angle;
    }

    /** Turns the body instantly. Its view jumps straight there instead of turning. */
    public setRotation(rotation: number) {
        const {position} = readMotion(this.box2d, this.bodyId);
        const newRotation = makeRotation(this.box2d, rotation);
        this.box2d._setTransform(
            this.bodyId.index,
            this.bodyId.tag,
            position.x,
            position.y,
            newRotation.cosine,
            newRotation.sine,
        );
        this.snapTransform();
    }

    /** Game units per second. */
    public getVelocity(): Coords {
        return readMotion(this.box2d, this.bodyId).velocity;
    }

    /** Game units per second. */
    public setVelocity(velocity: Readonly<Coords>) {
        this.box2d._setVelocity(this.bodyId.index, this.bodyId.tag, velocity.x, velocity.y);
    }

    /** Radians per second. */
    public getAngularVelocity() {
        return readMotion(this.box2d, this.bodyId).angularVelocity;
    }

    /** Radians per second, clockwise on screen. */
    public setAngularVelocity(angularVelocity: number) {
        this.box2d._setAngularVelocity(this.bodyId.index, this.bodyId.tag, angularVelocity);
    }

    /**
     * Pushes the body's center during the next step only. Box2D clears forces after each step, so
     * call this every step (from `update()`) for a constant push.
     */
    public applyForce(force: Readonly<Coords>) {
        this.box2d._applyForce(this.bodyId.index, this.bodyId.tag, force.x, force.y);
    }

    /** Changes the body's velocity immediately, by `impulse / mass`. */
    public applyImpulse(impulse: Readonly<Coords>) {
        this.box2d._applyImpulse(this.bodyId.index, this.bodyId.tag, impulse.x, impulse.y);
    }

    /** Total mass from every shape's area and density. Always 0 for static and kinematic bodies. */
    public getMass() {
        return this.box2d._getMass(this.bodyId.index, this.bodyId.tag);
    }

    /**
     * Same as {@link EntityPhysics2d.applyForce} but pushes at `point` (in world space) instead of
     * the center, so it also spins the body.
     */
    public applyForceAtPoint({
        force,
        point,
    }: Readonly<{
        force: Readonly<Coords>;
        point: Readonly<Coords>;
    }>) {
        this.box2d._applyForceAtPoint(
            this.bodyId.index,
            this.bodyId.tag,
            force.x,
            force.y,
            point.x,
            point.y,
        );
    }

    /**
     * Same as {@link EntityPhysics2d.applyImpulse} but pushes at `point` (in world space) instead of
     * the center, so it also spins the body.
     */
    public applyImpulseAtPoint({
        impulse,
        point,
    }: Readonly<{
        impulse: Readonly<Coords>;
        point: Readonly<Coords>;
    }>) {
        this.box2d._applyImpulseAtPoint(
            this.bodyId.index,
            this.bodyId.tag,
            impulse.x,
            impulse.y,
            point.x,
            point.y,
        );
    }

    /**
     * Twists the body clockwise on screen during the next step only. Call this every step for a
     * constant twist.
     */
    public applyTorque(torque: number) {
        this.box2d._applyTorque(this.bodyId.index, this.bodyId.tag, torque);
    }

    /** Changes the body's angular velocity immediately, by `impulse / rotational inertia`. */
    public applyAngularImpulse(impulse: number) {
        this.box2d._applyAngularImpulse(this.bodyId.index, this.bodyId.tag, impulse);
    }

    /** Converts a point relative to the body (its position and rotation) into world space. */
    public getWorldPoint(localPoint: Readonly<Coords>) {
        return readCoords(
            this.box2d,
            this.box2d._getWorldPoint(
                this.bodyId.index,
                this.bodyId.tag,
                localPoint.x,
                localPoint.y,
            ),
        );
    }

    /** Converts a world space point into one relative to the body (its position and rotation). */
    public getLocalPoint(worldPoint: Readonly<Coords>) {
        return readCoords(
            this.box2d,
            this.box2d._getLocalPoint(
                this.bodyId.index,
                this.bodyId.tag,
                worldPoint.x,
                worldPoint.y,
            ),
        );
    }

    /** Rotates a direction from the body's frame into world space. Ignores the body's position. */
    public getWorldVector(localVector: Readonly<Coords>) {
        return readCoords(
            this.box2d,
            this.box2d._getWorldVector(
                this.bodyId.index,
                this.bodyId.tag,
                localVector.x,
                localVector.y,
            ),
        );
    }

    /** Rotates a world space direction into the body's frame. Ignores the body's position. */
    public getLocalVector(worldVector: Readonly<Coords>) {
        return readCoords(
            this.box2d,
            this.box2d._getLocalVector(
                this.bodyId.index,
                this.bodyId.tag,
                worldVector.x,
                worldVector.y,
            ),
        );
    }

    /** The velocity of a world space point moving with the body, including its spin. */
    public getPointVelocity(worldPoint: Readonly<Coords>) {
        return readCoords(
            this.box2d,
            this.box2d._getPointVelocity(
                this.bodyId.index,
                this.bodyId.tag,
                worldPoint.x,
                worldPoint.y,
            ),
        );
    }

    /**
     * Every shape this body touches or is about to touch, as of the last step. `normal` points away
     * from the other shape, toward this body. `separation` is the gap between them, negative while
     * they overlap.
     */
    public getContacts() {
        const pointer = this.box2d._readContacts(this.bodyId.index, this.bodyId.tag);
        const [count] = readWasmFloat32s(this.box2d, pointer, 1);
        const contactsPointer = pointer + Float32Array.BYTES_PER_ELEMENT;

        return createArray(count, (contactIndex) => {
            const [
                normalX,
                normalY,
                separation,
                otherType,
            ] = readWasmFloat32s(
                this.box2d,
                contactsPointer + contactIndex * 4 * Float32Array.BYTES_PER_ELEMENT,
                4,
            );
            return {
                normal: {
                    x: normalX,
                    y: normalY,
                },
                separation,
                otherBodyType: readBodyType(otherType),
            };
        });
    }

    /** Static bodies never move, kinematic bodies move only by their velocity. */
    public getType() {
        return readSettings(this.box2d, this.bodyId).type;
    }

    /**
     * Changing a static body to dynamic gives it mass from its shapes, or from
     * {@link EntityPhysics2d.setMassData}.
     */
    public setType(type: BodyType) {
        this.box2d._setBodyType(this.bodyId.index, this.bodyId.tag, box2dBodyTypes[type]);
        this.reapplyMassData();
    }

    /** A disabled body stays where it is, touches nothing, and isn't found by queries. */
    public isEnabled() {
        return !readSettings(this.box2d, this.bodyId).isDisabled;
    }

    /** See {@link EntityPhysics2d.isEnabled}. */
    public setEnabled(isEnabled: boolean) {
        this.box2d._setEnabled(this.bodyId.index, this.bodyId.tag, Number(isEnabled));
    }

    /** See `isBullet` in {@link EntityPhysicsDefinition}. */
    public isBullet() {
        return readSettings(this.box2d, this.bodyId).isBullet;
    }

    /** See `isBullet` in {@link EntityPhysicsDefinition}. */
    public setBullet(isBullet: boolean) {
        this.box2d._setBullet(this.bodyId.index, this.bodyId.tag, Number(isBullet));
    }

    /**
     * A body that has stayed still for a while falls asleep and skips simulation until something
     * touches it or one of its methods moves it.
     */
    public isAwake() {
        return readSettings(this.box2d, this.bodyId).isAwake;
    }

    /** Putting a body to sleep also stops it. */
    public setAwake(isAwake: boolean) {
        this.box2d._setAwake(this.bodyId.index, this.bodyId.tag, Number(isAwake));
    }

    /** See `gravityScale` in {@link EntityPhysicsDefinition}. */
    public getGravityScale() {
        return readSettings(this.box2d, this.bodyId).gravityScale;
    }

    /** See `gravityScale` in {@link EntityPhysicsDefinition}. */
    public setGravityScale(gravityScale: number) {
        this.box2d._setGravityScale(this.bodyId.index, this.bodyId.tag, gravityScale);
    }

    /** See `motionLocks` in {@link EntityPhysicsDefinition}. */
    public getMotionLocks() {
        return readSettings(this.box2d, this.bodyId).motionLocks;
    }

    /** Locks left out are unlocked. */
    public setMotionLocks(motionLocks: Readonly<Partial<MotionLocks2d>>) {
        this.box2d._setMotionLocks(
            this.bodyId.index,
            this.bodyId.tag,
            writeMotionLocks(motionLocks),
        );
    }

    /**
     * Sets the velocity that brings a kinematic body to `position` and `rotation` (radians,
     * clockwise on screen) by the end of a step of `stepSeconds`, so that it pushes what it moves
     * into instead of teleporting through it. Leave out `rotation` to keep the current one.
     */
    public setTargetTransform({
        position,
        rotation,
        stepSeconds,
    }: Readonly<
        {
            position: Readonly<Coords>;
            stepSeconds: number;
        } & PartialWithUndefined<{
            rotation: number;
        }>
    >) {
        const targetRotation = check.isNumber(rotation)
            ? makeRotation(this.box2d, rotation)
            : readMotion(this.box2d, this.bodyId).rotation;
        this.box2d._setTargetTransform(
            this.bodyId.index,
            this.bodyId.tag,
            position.x,
            position.y,
            targetRotation.cosine,
            targetRotation.sine,
            stepSeconds,
        );
    }

    /** Material values from earlier {@link EntityPhysics2d.setMaterial} calls. */
    public getMaterial(): PhysicsMaterial {
        return {
            ...this.material,
        };
    }

    /**
     * Changes the material of every shape on the body. Values left out keep their current value,
     * and changing `density` recomputes the body's mass.
     */
    public setMaterial(material: Readonly<PhysicsMaterial>) {
        assertValidUserMaterialId(material);
        this.box2d._setMaterial(
            this.bodyId.index,
            this.bodyId.tag,
            material.density ?? Number.NaN,
            material.friction ?? Number.NaN,
            material.restitution ?? Number.NaN,
            material.rollingResistance ?? Number.NaN,
            material.tangentSpeed ?? Number.NaN,
            material.userMaterialId ?? -1,
        );
        if (material.density != undefined) {
            this.reapplyMassData();
        }
        this.material = {
            ...this.material,
            ...filterObject(material, (key, value) => {
                return value != undefined;
            }),
        };
    }

    /** The body's shapes, from its physics definition until {@link EntityPhysics2d.setShapes}. */
    public getShapes(): PhysicsShapeDefinition[] {
        return structuredClone([...(this.shapes ?? this.shapeSettings.definitionShapes)]);
    }

    /**
     * Replaces every shape on the body and recomputes its mass. Materials from
     * {@link EntityPhysics2d.setMaterial} still apply to the new shapes.
     *
     * @throws Error if a shape is invalid, keeping the current shapes.
     */
    public setShapes(shapes: ReadonlyArray<Readonly<PhysicsShapeDefinition>>) {
        assertValidShapes(
            shapes,
            !!this.box2d._isRecordingBody(this.bodyId.index, this.bodyId.tag),
        );
        const previousShapes = this.shapes ?? this.shapeSettings.definitionShapes;
        this.replaceShapes(shapes);
        try {
            this.addShapes(shapes);
        } catch (error) {
            this.replaceShapes(previousShapes);
            this.addShapes(previousShapes);
            throw error;
        }
        this.shapes = structuredClone([...shapes]);
    }

    /** Removes the body's shapes, only letting it sleep if it will have any. */
    protected replaceShapes(shapes: ReadonlyArray<Readonly<PhysicsShapeDefinition>>) {
        this.box2d._removeShapes(this.bodyId.index, this.bodyId.tag);
        this.updateSleepEnabled(shapes);
    }

    /** Lets the body sleep only when sleep is not disabled and it has shapes. */
    protected updateSleepEnabled(shapes: ReadonlyArray<Readonly<PhysicsShapeDefinition>>) {
        /** See the matching `createBody` argument. */
        this.box2d._setSleepEnabled(
            this.bodyId.index,
            this.bodyId.tag,
            Number(!this.isSleepDisabled && !!shapes.length),
        );
    }

    /** Box2D recomputes the mass after every shape, density, or type change. */
    protected reapplyMassData() {
        if (this.massData && this.getType() === BodyType.Dynamic) {
            writeMassData(this.box2d, this.bodyId, this.massData);
        }
    }

    /** Adds shapes with this body's material, filter, and hit events, then reapplies its mass data. */
    protected addShapes(shapes: ReadonlyArray<Readonly<PhysicsShapeDefinition>>) {
        addShapes({
            box2d: this.box2d,
            bodyId: this.bodyId,
            shapes,
            materialOverride: this.material,
            filter: this.shapeSettings.filter,
            entityId: this.shapeSettings.entityId,
            enableHitEvents: this.enableHitEvents,
        });
        this.reapplyMassData();
    }

    /** See `linearDamping` in {@link EntityPhysicsDefinition}. */
    public getLinearDamping() {
        return readSettings(this.box2d, this.bodyId).linearDamping;
    }

    /** See `linearDamping` in {@link EntityPhysicsDefinition}. */
    public setLinearDamping(linearDamping: number) {
        this.box2d._setDamping(
            this.bodyId.index,
            this.bodyId.tag,
            linearDamping,
            this.getAngularDamping(),
        );
    }

    /** See `linearDamping` in {@link EntityPhysicsDefinition}. */
    public getAngularDamping() {
        return readSettings(this.box2d, this.bodyId).angularDamping;
    }

    /** See `linearDamping` in {@link EntityPhysicsDefinition}. */
    public setAngularDamping(angularDamping: number) {
        this.box2d._setDamping(
            this.bodyId.index,
            this.bodyId.tag,
            this.getLinearDamping(),
            angularDamping,
        );
    }

    /**
     * The speed in game units per second that the body must stay under before it can fall asleep.
     * Defaults to Box2D's 0.05 meters per second.
     */
    public getSleepThreshold() {
        return readSettings(this.box2d, this.bodyId).sleepThreshold;
    }

    /** See {@link EntityPhysics2d.getSleepThreshold}. */
    public setSleepThreshold(sleepThreshold: number) {
        this.box2d._setSleepThreshold(this.bodyId.index, this.bodyId.tag, sleepThreshold);
    }

    /** Whether the body falls asleep once it stays still. A body without shapes never does. */
    public isSleepEnabled() {
        return !this.isSleepDisabled;
    }

    /** Disabling sleep also wakes the body. */
    public setSleepEnabled(isEnabled: boolean) {
        this.isSleepDisabled = !isEnabled;
        this.updateSleepEnabled(this.shapes ?? this.shapeSettings.definitionShapes);
    }

    /** Whether this body's fast collisions reach the `contactHit` entity hook. */
    public areHitEventsEnabled() {
        return this.enableHitEvents;
    }

    /** See {@link EntityPhysics2d.areHitEventsEnabled}. */
    public setHitEventsEnabled(isEnabled: boolean) {
        this.box2d._setHitEvents(this.bodyId.index, this.bodyId.tag, Number(isEnabled));
        this.enableHitEvents = isEnabled;
    }

    /** The mass data in use, whether from the body's shapes or {@link EntityPhysics2d.setMassData}. */
    public getMassData(): MassData2d {
        const [
            mass,
            centerX,
            centerY,
            rotationalInertia,
        ] = readWasmFloat32s(
            this.box2d,
            this.box2d._readMassData(this.bodyId.index, this.bodyId.tag),
            4,
        );
        return {
            mass,
            center: {
                x: centerX,
                y: centerY,
            },
            rotationalInertia,
        };
    }

    /**
     * Replaces the mass the body's shapes give it, until called with `undefined`. The replacement
     * survives shape, density, and type changes, but only applies while the body is dynamic.
     *
     * @throws Error if the mass or rotational inertia is negative or NaN.
     */
    public setMassData(massData: Readonly<MassData2d> | undefined) {
        if (massData) {
            assertValidMassData(massData);
        }
        this.massData = massData && structuredClone(massData);
        if (!massData) {
            writeMassData(this.box2d, this.bodyId, undefined);
        }
        this.reapplyMassData();
    }

    /**
     * Same as {@link EntityPhysics2d.getPointVelocity} but takes a point in body space, so it
     * follows the body.
     */
    public getLocalPointVelocity(localPoint: Readonly<Coords>) {
        return readCoords(
            this.box2d,
            this.box2d._getLocalPointVelocity(
                this.bodyId.index,
                this.bodyId.tag,
                localPoint.x,
                localPoint.y,
            ),
        );
    }

    /**
     * A world space box around every shape on the body, slightly bigger than the shapes. A body
     * without shapes gets a box around its position.
     */
    public getBounds() {
        return readBounds(
            this.box2d,
            this.box2d._computeBounds(this.bodyId.index, this.bodyId.tag),
        );
    }

    /**
     * Pushes the body during the next step as if air were blowing at `wind` (game units per
     * second), harder on shapes that show the wind more area. `drag` is how much the body's own
     * velocity counts against the wind: 0 ignores it, and 1 means a body already moving with the
     * wind feels none. `lift` also pushes tilted capsule and polygon edges sideways to the wind.
     * Only circles, capsules, boxes, and polygons on a dynamic body catch wind, so call this every
     * step for steady wind.
     */
    public applyWind({
        wind,
        drag,
        lift,
    }: Readonly<
        {
            wind: Readonly<Coords>;
            drag: number;
        } & PartialWithUndefined<{
            /** @default 0 */
            lift: number;
        }>
    >) {
        this.box2d._applyWind(this.bodyId.index, this.bodyId.tag, wind.x, wind.y, drag, lift ?? 0);
    }

    /**
     * Same as {@link PhysicsWorld2d.castRay} but only hits this body's shapes, whatever their
     * filter.
     */
    public castRay({
        origin,
        translation,
    }: Readonly<{
        origin: Readonly<Coords>;
        translation: Readonly<Coords>;
    }>) {
        return readHit(
            this.box2d,
            this.box2d._castBodyRay(
                this.bodyId.index,
                this.bodyId.tag,
                origin.x,
                origin.y,
                translation.x,
                translation.y,
            ),
        );
    }

    /**
     * The point on the body's shapes closest to `target`, in world space. A target inside a solid
     * shape is its own closest point. Undefined for a body without shapes.
     */
    public getClosestPoint(target: Readonly<Coords>): Coords | undefined {
        const [
            hasShapes,
            x,
            y,
        ] = readWasmFloat32s(
            this.box2d,
            this.box2d._getClosestPoint(this.bodyId.index, this.bodyId.tag, target.x, target.y),
            3,
        );
        return hasShapes
            ? {
                  x,
                  y,
              }
            : undefined;
    }

    /**
     * Whether a world space point is inside one of the body's shapes. Segments and chains have no
     * inside.
     */
    public containsPoint(point: Readonly<Coords>) {
        return !!this.box2d._testPoint(this.bodyId.index, this.bodyId.tag, point.x, point.y);
    }

    /** Every entity inside this body's sensor shapes as of the last step. Each entity appears once. */
    public getSensorOverlaps() {
        return readWasmOverlaps(
            this.box2d,
            this.box2d._readSensorOverlaps(this.bodyId.index, this.bodyId.tag),
        );
    }

    /** Cancels every force and torque applied since the last step. */
    public clearForces() {
        this.box2d._clearForces(this.bodyId.index, this.bodyId.tag);
    }

    /** Wakes every body touching this one. */
    public wakeTouching() {
        this.box2d._wakeTouching(this.bodyId.index, this.bodyId.tag);
    }

    /** Reads everything about the body that changes as it moves or that its methods can change. */
    public getState(): BodyState {
        return {
            ...omitObjectKeys(readMotion(this.box2d, this.bodyId), ['angle']),
            ...omitObjectKeys(readSettings(this.box2d, this.bodyId), ['isAwake']),
            isSleepDisabled: this.isSleepDisabled,
            enableHitEvents: this.enableHitEvents,
            material: this.getMaterial(),
            shapes:
                this.shapes &&
                (structuredClone(this.shapes) satisfies ReadonlyArray<
                    Readonly<PhysicsShapeDefinition>
                > as BodyState['shapes']),
            massData: this.massData && structuredClone(this.massData),
        };
    }
}

/**
 * How a joint connects its two bodies.
 *
 * @category Main
 */
export enum JointType {
    /** Keeps two points a set distance apart, optionally as a spring, like a rope or a strut. */
    Distance = 'distance',
    /** Only stops the two bodies from colliding with each other. */
    Filter = 'filter',
    /** Drives body B toward a target velocity and offset relative to body A. */
    Motor = 'motor',
    /** Drives body B toward a velocity on each axis separately, for character movers. */
    Mover = 'mover',
    /** A spring along `normal`, for holding a character mover up off the ground. */
    Pogo = 'pogo',
    /** Lets body B slide along frame A's x axis without turning. */
    Prismatic = 'prismatic',
    /** Lets the bodies turn around a shared point, like a hinge. */
    Revolute = 'revolute',
    /** Holds the bodies together, optionally with some flex. */
    Weld = 'weld',
    /** Lets body B spin and slide along frame A's x axis, like a wheel on a suspension. */
    Wheel = 'wheel',
}

/** The values of Box2D's `b2JointType` enum. */
const box2dJointTypes: Record<JointType, number> = {
    [JointType.Distance]: 0,
    [JointType.Filter]: 1,
    [JointType.Motor]: 2,
    [JointType.Mover]: 3,
    [JointType.Pogo]: 4,
    [JointType.Prismatic]: 5,
    [JointType.Revolute]: 6,
    [JointType.Weld]: 7,
    [JointType.Wheel]: 8,
};

/**
 * Settings every joint type has. Their key order is the order the bindings read them in, so don't
 * reorder them.
 *
 * @category Internal
 */
export const baseJointSettings = {
    /** Where the joint attaches to body A, relative to its position and rotation. */
    frameA: {
        position: {
            x: 0,
            y: 0,
        },
        /** Radians. */
        angle: 0,
    },
    frameB: {
        position: {
            x: 0,
            y: 0,
        },
        angle: 0,
    },
    /**
     * Each step where the joint pulls harder than this, both entities get a `jointStrained` call.
     * Leave it out to never report force.
     */
    forceThreshold: 0,
    torqueThreshold: 0,
    constraintHertz: 0,
    constraintDampingRatio: 0,
    /** Lets the two bodies collide with each other. */
    collideConnected: false,
};

/**
 * The settings of each joint type. Their key order is the order the bindings read them in, so don't
 * reorder them. Angles are in radians and lengths in game units.
 *
 * @category Internal
 */
export const jointTypeSettings = {
    [JointType.Distance]: {
        length: 0,
        enableSpring: false,
        lowerSpringForce: 0,
        upperSpringForce: 0,
        hertz: 0,
        dampingRatio: 0,
        enableLimit: false,
        minLength: 0,
        maxLength: 0,
        enableMotor: false,
        maxMotorForce: 0,
        motorSpeed: 0,
    },
    [JointType.Filter]: {},
    [JointType.Motor]: {
        linearVelocity: {
            x: 0,
            y: 0,
        },
        maxVelocityForce: 0,
        angularVelocity: 0,
        maxVelocityTorque: 0,
        linearHertz: 0,
        linearDampingRatio: 0,
        maxSpringForce: 0,
        angularHertz: 0,
        angularDampingRatio: 0,
        maxSpringTorque: 0,
    },
    [JointType.Mover]: {
        linearVelocity: {
            x: 0,
            y: 0,
        },
        maxVelocityForce: {
            x: 0,
            y: 0,
        },
    },
    [JointType.Pogo]: {
        normal: {
            x: 0,
            y: 0,
        },
        hertz: 0,
        dampingRatio: 0,
        restLength: 0,
        maxTensionForce: 0,
        maxCompressionForce: 0,
        impulse: 0,
        velocity: 0,
    },
    [JointType.Prismatic]: {
        enableSpring: false,
        hertz: 0,
        dampingRatio: 0,
        targetTranslation: 0,
        enableLimit: false,
        lowerTranslation: 0,
        upperTranslation: 0,
        enableMotor: false,
        maxMotorForce: 0,
        motorSpeed: 0,
    },
    [JointType.Revolute]: {
        targetAngle: 0,
        enableSpring: false,
        hertz: 0,
        dampingRatio: 0,
        enableLimit: false,
        lowerAngle: 0,
        upperAngle: 0,
        enableMotor: false,
        maxMotorTorque: 0,
        motorSpeed: 0,
    },
    [JointType.Weld]: {
        linearHertz: 0,
        angularHertz: 0,
        linearDampingRatio: 0,
        angularDampingRatio: 0,
    },
    [JointType.Wheel]: {
        enableSpring: false,
        hertz: 0,
        dampingRatio: 0,
        enableLimit: false,
        lowerTranslation: 0,
        upperTranslation: 0,
        enableMotor: false,
        maxMotorTorque: 0,
        motorSpeed: 0,
    },
} satisfies Record<JointType, object>;

/**
 * Pogo settings that only apply when the joint is created.
 *
 * @category Internal
 */
export type PogoCreationSettings =
    | 'normal'
    | 'maxTensionForce'
    | 'maxCompressionForce'
    | 'impulse'
    | 'velocity';

/**
 * The settings of a joint, for {@link EntityJoint2d.update}. Leave a setting out for Box2D's
 * default.
 *
 * @category Internal
 */
export type JointSettings2d<Type extends JointType = JointType> = {
    [ThisType in Type]: PartialWithUndefined<
        typeof baseJointSettings &
            Omit<
                (typeof jointTypeSettings)[ThisType],
                ThisType extends JointType.Pogo ? PogoCreationSettings : never
            >
    >;
}[Type];

/**
 * How to connect two bodies with a joint. Leave a setting out for Box2D's default.
 *
 * @category Internal
 */
export type JointDefinition2d<Type extends JointType = JointType> = {
    [ThisType in Type]: {
        type: ThisType;
    } & PartialWithUndefined<typeof baseJointSettings & (typeof jointTypeSettings)[ThisType]>;
}[Type];

/**
 * Shape definition for {@link JointDefinition2d}.
 *
 * @category Internal
 */
export const jointDefinition2dShape = unionShape(
    ...assertWrap.isLengthAtLeast(
        getEnumValues(JointType).map((type) => {
            return intersectShape(
                defineShape({
                    type: exactShape(type),
                }),
                partialShape({
                    ...baseJointSettings,
                    ...jointTypeSettings[type],
                }),
            );
        }),
        1,
    ),
);

/**
 * What {@link EntityJoint2d.read} reads for every joint type, in the order the bindings write it.
 *
 * @category Internal
 */
export const baseJointReading = {
    /** The force the joint applied to body B in the last step. */
    constraintForce: {
        x: 0,
        y: 0,
    },
    constraintTorque: 0,
    /** How far apart the joint's frames have been pulled, in game units. */
    linearSeparation: 0,
    /** How far the joint's frames have been twisted apart, in radians. */
    angularSeparation: 0,
};

/**
 * What {@link EntityJoint2d.read} adds for each joint type, in the order the bindings write it.
 *
 * @category Internal
 */
export const jointTypeReadings = {
    [JointType.Distance]: {
        length: 0,
        springForce: 0,
        motorForce: 0,
    },
    [JointType.Filter]: {},
    [JointType.Motor]: {},
    [JointType.Mover]: {},
    [JointType.Pogo]: {
        length: 0,
        speed: 0,
        impulse: 0,
    },
    [JointType.Prismatic]: {
        translation: 0,
        speed: 0,
        motorForce: 0,
    },
    [JointType.Revolute]: {
        angle: 0,
        speed: 0,
        motorTorque: 0,
    },
    [JointType.Weld]: {},
    [JointType.Wheel]: {
        motorTorque: 0,
    },
} satisfies Record<JointType, object>;

/**
 * What a joint is doing right now, from {@link EntityJoint2d.read}.
 *
 * @category Internal
 */
export type JointReading2d<Type extends JointType = JointType> = {
    [ThisType in Type]: typeof baseJointReading & (typeof jointTypeReadings)[ThisType];
}[Type];

/** Writes floats where the next binding call that takes input reads them. */
function writeInputFloats(box2d: Box2dModule, values: ReadonlyArray<number>) {
    const pointer = box2d._reserveInput(values.length * Float32Array.BYTES_PER_ELEMENT);
    box2d.HEAPF32.set(values, pointer / Float32Array.BYTES_PER_ELEMENT);
}

function writeJointDefinition(
    box2d: Box2dModule,
    definition: Readonly<Pick<JointDefinition2d, 'type'>>,
) {
    const values = flattenBindingValues(
        {
            ...baseJointSettings,
            ...jointTypeSettings[definition.type],
        },
        definition,
    );
    writeInputFloats(box2d, values);
}

/**
 * A joint between two entities' bodies. Create one with {@link EntityStore.addJoint}.
 *
 * @category Internal
 */
export class EntityJoint2d<Type extends JointType = JointType>
    implements EntityJoint<JointDefinition2d<Type>>
{
    constructor(
        protected readonly box2d: Box2dModule,
        /** The id the entity store gave this joint. */
        public readonly jointId: number,
        /** The Box2D joint this controls. */
        public readonly box2dJointId: Readonly<Box2dId>,
        protected definition: JointDefinition2d<Type>,
    ) {}

    /** The joint's settings, including every {@link EntityJoint2d.update}. */
    public getDefinition(): JointDefinition2d<Type> {
        return structuredClone(this.definition);
    }

    /** Changes some of the joint's settings and wakes its bodies. */
    public update(settings: Readonly<JointSettings2d<Type>>) {
        this.definition = {
            ...this.definition,
            ...settings,
        };
        writeJointDefinition(this.box2d, this.definition);
        this.box2d._updateJoint(
            this.box2dJointId.index,
            this.box2dJointId.tag,
            box2dJointTypes[this.definition.type],
        );
    }

    /** Reads what the joint did in the last step. */
    public read() {
        const pointer = this.box2d._readJoint(
            this.box2dJointId.index,
            this.box2dJointId.tag,
            box2dJointTypes[this.definition.type],
        );
        return readBindingValues<JointReading2d>(
            {
                ...baseJointReading,
                ...jointTypeReadings[this.definition.type],
            },
            readWasmFloat32s(this.box2d, pointer, 8),
        ) satisfies JointReading2d as JointReading2d<Type>;
    }
}

/**
 * A Box2D world. Create one with {@link PhysicsWorld2d.create}.
 *
 * @category Internal
 */
export class PhysicsWorld2d
    implements
        PhysicsWorld<
            EntityPhysicsDefinition,
            EntityPhysics2d,
            InitialBodyState,
            Hit2d,
            JointDefinition2d,
            EntityJoint2d
        >
{
    /** Loads Box2D (shared by every world with the same `pixelsPerMeter`) and creates a world. */
    public static async create(options: Readonly<PhysicsOptions> = {}) {
        return new PhysicsWorld2d(await loadBox2d(options.pixelsPerMeter ?? 1));
    }

    /** Validates {@link BodyState} entries in snapshots. */
    public readonly bodyStateShape = bodyStateShape;
    /** Validates {@link JointDefinition2d} entries in snapshots. */
    public readonly jointDefinitionShape = jointDefinition2dShape;
    protected readonly box2d: LoadedBox2d;
    protected worldId: number | undefined;
    protected gravity: Coords = {
        x: 0,
        y: 0,
    };
    protected hitEventThreshold = 1;
    protected settings: WorldSettings2d;
    protected hooks: WorldHooks2d = {};

    /** Use {@link PhysicsWorld2d.create} instead, which loads Box2D first. */
    protected constructor(box2d: LoadedBox2d) {
        this.box2d = box2d;
        this.settings = readBindingValues(
            worldSettingsTemplate,
            readWasmFloat32s(
                box2d,
                box2d._readDefaultWorldSettings(),
                flattenBindingValues(worldSettingsTemplate, undefined).length,
            ),
        );
        this.createWorld();
    }

    /** Creates the Box2D world. */
    protected createWorld() {
        const worldId = this.box2d._createWorld(this.gravity.x, this.gravity.y);
        this.worldId = worldId;
        this.box2d._setHitEventThreshold(worldId, this.hitEventThreshold);
        this.applySettings(worldId);
        this.box2d.anthaWorldHooks.set(worldId, () => {
            return this.hooks;
        });
        this.applyHooks(worldId);
    }

    /** Tells the bindings which of {@link hooks} are set, so they only call the ones that are. */
    protected applyHooks(worldId: number) {
        this.box2d._setHooks(
            worldId,
            Number(!!this.hooks.customFilter),
            Number(!!this.hooks.preSolve),
            Number(!!this.hooks.mixFriction),
            Number(!!this.hooks.mixRestitution),
        );
    }

    /** Destroys the native world and forgets its hooks. */
    protected destroyWorld(worldId: number) {
        this.box2d._destroyWorld(worldId);
        this.box2d.anthaWorldHooks.delete(worldId);
    }

    /** Writes {@link settings} into the native world. */
    protected applySettings(worldId: number) {
        writeInputFloats(this.box2d, flattenBindingValues(worldSettingsTemplate, this.settings));
        this.box2d._setWorldSettings(worldId);
    }

    /** @throws Error if the world was destroyed. */
    protected requireWorld() {
        if (this.worldId == undefined) {
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
        box2d._setGravity(worldId, gravity.x, gravity.y);
    }

    /** Game units per second squared. */
    public getGravity(): Coords {
        return {
            ...this.gravity,
        };
    }

    /**
     * Sets how fast, in game units per second, two shapes must close in on each other for their
     * collision to reach the `contactHit` entity hook.
     *
     * @default 1
     */
    public setHitEventThreshold(speed: number) {
        const {box2d, worldId} = this.requireWorld();
        box2d._setHitEventThreshold(worldId, speed);
        this.hitEventThreshold = speed;
    }

    /** Game units per second. */
    public getHitEventThreshold() {
        return this.hitEventThreshold;
    }

    /** Settings left out keep their current values. Every world starts with Box2D's defaults. */
    public setSettings(settings: Readonly<Partial<WorldSettings2d>>) {
        const {worldId} = this.requireWorld();
        const merged = {
            ...this.settings,
            ...settings,
        };
        assertValidWorldSettings(merged);
        this.settings = merged;
        this.applySettings(worldId);
    }

    /** A copy, so changing it does not change the world. Use {@link setSettings} for that. */
    public getSettings() {
        return {
            ...this.settings,
        };
    }

    /**
     * Sets the callbacks the world runs while stepping, which are kept through reset and left out
     * of snapshots. Hooks left out keep their current callbacks, and `undefined` removes one. Hooks
     * must not throw or change the world.
     */
    public setHooks(hooks: Readonly<WorldHooks2d>) {
        const {box2d, worldId} = this.requireWorld();
        const merged = {
            ...this.hooks,
            ...hooks,
        };
        if (box2d._isRecording(worldId) && Object.values(merged).some(check.isFunction)) {
            throw new Error(recordingHooksMessage);
        }
        this.hooks = merged;
        this.applyHooks(worldId);
    }

    /** A copy, so changing it does not change the world. Use {@link setHooks} for that. */
    public getHooks() {
        return {
            ...this.hooks,
        };
    }

    /**
     * Destroys every body by replacing the world, so that loading the same snapshot builds the same
     * internal world on every peer. Discards the world's recording.
     */
    public reset() {
        const {worldId} = this.requireWorld();
        this.destroyWorld(worldId);
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
        const shapes = bodyState.shapes ?? definition?.shapes ?? [];
        assertValidShapes(shapes, !!box2d._isRecording(worldId));
        if (bodyState.massData) {
            assertValidMassData(bodyState.massData);
        }
        const rotation = check.isNumber(bodyState.rotation)
            ? makeRotation(box2d, bodyState.rotation)
            : (bodyState.rotation ?? bodyStateShape.default.rotation);
        const idPointer = box2d._createBody(
            worldId,
            box2dBodyTypes[bodyState.type || definition?.type || BodyType.Static],
            bodyState.position?.x ?? 0,
            bodyState.position?.y ?? 0,
            rotation.cosine,
            rotation.sine,
            bodyState.velocity?.x ?? 0,
            bodyState.velocity?.y ?? 0,
            bodyState.angularVelocity ?? 0,
            bodyState.linearDamping ?? definition?.linearDamping ?? 0,
            bodyState.angularDamping ?? definition?.angularDamping ?? 0,
            bodyState.gravityScale ??
                definition?.gravityScale ??
                bodyStateShape.default.gravityScale,
            writeMotionLocks(bodyState.motionLocks ?? definition?.motionLocks ?? {}),
            Number(bodyState.isBullet ?? !!definition?.isBullet),
            Number(!(bodyState.isDisabled ?? definition?.isDisabled)),
            /**
             * Box2D judges whether a body is still by how fast its shapes move, so a body without
             * shapes always looks still. It soon falls asleep and loses its velocity.
             */
            Number(!bodyState.isSleepDisabled && !!shapes.length),
            bodyState.sleepThreshold ?? Number.NaN,
            entityId,
        );
        const [
            index,
            tag,
        ] = readWasmInt32s(box2d, idPointer, 2);
        const bodyId = {
            index,
            tag,
        };

        const shapeSettings = {
            filter,
            entityId,
            definitionShapes: definition?.shapes ?? [],
        };
        const enableHitEvents = bodyState.enableHitEvents ?? !!definition?.enableHitEvents;
        try {
            addShapes({
                box2d,
                bodyId,
                shapes,
                materialOverride: bodyState.material ?? {},
                filter,
                entityId,
                enableHitEvents,
            });
        } catch (error) {
            box2d._destroyBody(bodyId.index, bodyId.tag);
            throw error;
        }

        const physics = new EntityPhysics2d({
            box2d,
            bodyId,
            material: bodyState.material ?? {},
            shapes: bodyState.shapes,
            shapeSettings,
            enableHitEvents,
            isSleepDisabled: !!bodyState.isSleepDisabled,
        });
        if (bodyState.massData) {
            physics.setMassData(bodyState.massData);
        }
        return physics;
    }

    /** Does nothing if the body was already destroyed. */
    public destroyBody(physics: Readonly<EntityPhysics2d>) {
        const {box2d} = this.requireWorld();
        box2d._destroyBody(physics.bodyId.index, physics.bodyId.tag);
    }

    /**
     * Usually called by {@link EntityStore.addJoint}. Box2D destroys the joint along with either of
     * its bodies.
     */
    public createJoint<const Definition extends JointDefinition2d>({
        bodies,
        definition,
        jointId,
    }: Readonly<{
        bodies: Readonly<
            [
                EntityPhysics2d,
                EntityPhysics2d,
            ]
        >;
        definition: Readonly<Definition>;
        /** Reported back in {@link ContactEvents.strainedJoints}. */
        jointId: number;
    }>) {
        const {box2d, worldId} = this.requireWorld();
        writeJointDefinition(box2d, definition);
        const idPointer = box2d._createJoint(
            worldId,
            box2dJointTypes[definition.type],
            bodies[0].bodyId.index,
            bodies[0].bodyId.tag,
            bodies[1].bodyId.index,
            bodies[1].bodyId.tag,
            jointId,
        );
        const [
            index,
            tag,
        ] = readWasmInt32s(box2d, idPointer, 2);
        return new EntityJoint2d(
            box2d,
            jointId,
            {
                index,
                tag,
            },
            structuredClone(definition) as JointDefinition2d<Definition['type']>,
        );
    }

    /** Does nothing if the joint was already destroyed. */
    public destroyJoint(joint: Readonly<EntityJoint2d>) {
        const {box2d} = this.requireWorld();
        box2d._destroyJoint(joint.box2dJointId.index, joint.box2dJointId.tag);
    }

    /** Advances the world by one step and returns the contact events it produced. */
    public step(stepSeconds: number) {
        const {box2d, worldId} = this.requireWorld();
        const pointer = box2d._step(worldId, stepSeconds, subStepCount);
        const counts = readWasmInt32s(box2d, pointer, 6);
        const [
            startedCount,
            endedCount,
            sensorStartedCount,
            sensorEndedCount,
            hitCount,
            strainedJointCount,
        ] = counts;
        const pairCount = startedCount + endedCount + sensorStartedCount + sensorEndedCount;
        const pairsPointer = pointer + counts.length * Int32Array.BYTES_PER_ELEMENT;
        const pairs = createArray(pairCount, (index): ContactPair => {
            return readWasmInt32s(
                box2d,
                pairsPointer + index * 2 * Int32Array.BYTES_PER_ELEMENT,
                2,
            );
        });
        const hitsPointer = pairsPointer + pairCount * 2 * Int32Array.BYTES_PER_ELEMENT;
        const hits = createArray(hitCount, (index) => {
            const hitPointer = hitsPointer + index * 7 * Int32Array.BYTES_PER_ELEMENT;
            const [
                firstId,
                secondId,
            ] = readWasmInt32s(box2d, hitPointer, 2);
            const [
                pointX,
                pointY,
                normalX,
                normalY,
                approachSpeed,
            ] = readWasmFloat32s(box2d, hitPointer + 2 * Int32Array.BYTES_PER_ELEMENT, 5);
            const point = {
                x: pointX,
                y: pointY,
            };
            return [
                {
                    entityId: firstId,
                    otherEntityId: secondId,
                    hit: {
                        point,
                        normal: {
                            x: -normalX,
                            y: -normalY,
                        },
                        approachSpeed,
                    },
                },
                {
                    entityId: secondId,
                    otherEntityId: firstId,
                    hit: {
                        point,
                        normal: {
                            x: normalX,
                            y: normalY,
                        },
                        approachSpeed,
                    },
                },
            ] satisfies EntityHit<Hit2d>[];
        }).flat();
        const sensorStart = startedCount + endedCount;

        return {
            started: pairs.slice(0, startedCount),
            ended: pairs.slice(startedCount, sensorStart),
            sensorStarted: pairs.slice(sensorStart, sensorStart + sensorStartedCount),
            sensorEnded: pairs.slice(sensorStart + sensorStartedCount),
            hits,
            strainedJoints: readWasmInt32s(
                box2d,
                hitsPointer + hitCount * 7 * Int32Array.BYTES_PER_ELEMENT,
                strainedJointCount,
            ),
        };
    }

    /**
     * Usually called by {@link EntityStore.createSnapshot}. Box2D marks its snapshots as
     * experimental, and their format can change in any new Box2D version.
     */
    public createPhysicsState({
        bodies,
        droppedBodies,
        joints,
    }: Readonly<{
        bodies: ReadonlyArray<Readonly<EntityPhysics2d>>;
        droppedBodies: ReadonlyArray<Readonly<EntityPhysics2d>>;
        joints: ReadonlyArray<Readonly<EntityJoint2d>>;
    }>) {
        const {box2d, worldId} = this.requireWorld();
        const ids = [
            ...[
                ...bodies,
                ...droppedBodies,
            ].map((body) => body.bodyId),
            ...joints.map((joint) => joint.box2dJointId),
        ].flatMap((id) => {
            return [
                id.index,
                id.tag,
            ];
        });
        const idsPointer = box2d._reserveInput(ids.length * Int32Array.BYTES_PER_ELEMENT);
        box2d.HEAP32.set(ids, idsPointer / Int32Array.BYTES_PER_ELEMENT);
        const pointer = box2d._createSnapshot(
            worldId,
            bodies.length,
            droppedBodies.length,
            joints.length,
        );
        const [
            ,
            size,
        ] = readWasmInt32s(box2d, pointer, 2);
        return box2d.HEAPU8.slice(pointer, pointer + size);
    }

    /** Usually called by {@link EntityStore.loadSnapshot}. */
    public assertValidPhysicsState({
        state,
        bodyCount,
        jointCount,
    }: Readonly<{
        state: Uint8Array;
        bodyCount: number;
        jointCount: number;
    }>) {
        const {box2d} = this.requireWorld();
        const pointer = box2d._reserveInput(state.byteLength);
        box2d.HEAPU8.set(state, pointer);
        if (!box2d._isValidSnapshot(state.byteLength)) {
            throw new Error('Invalid physics state: it is not from createPhysicsState.');
        }
        const [
            ,
            ,
            savedBodyCount,
            ,
            savedJointCount,
        ] = readWasmInt32s(box2d, pointer, 5);
        if (savedBodyCount !== bodyCount || savedJointCount !== jointCount) {
            throw new Error(
                `Invalid physics state: it has ${savedBodyCount} bodies and ${savedJointCount} joints, not ${bodyCount} and ${jointCount}.`,
            );
        }
    }

    /**
     * Usually called by {@link EntityStore.loadSnapshot}, after resetting the world.
     *
     * @throws Error if Box2D can't read the state or the world is recording, which leaves the world
     *   unchanged.
     */
    public restorePhysicsState({
        state,
        bodies,
        joints,
    }: Readonly<{
        state: Uint8Array;
        bodies: ReadonlyArray<EntityPhysics2d>;
        joints: ReadonlyArray<EntityJoint2d>;
    }>) {
        const {box2d, worldId} = this.requireWorld();
        if (box2d._isRecording(worldId)) {
            throw new Error('Box2D cannot restore a physics state while the world is recording.');
        }
        /** The C side reads these as int32 values, so they must start 4-byte aligned. */
        const idsOffset = Math.ceil(state.byteLength / Int32Array.BYTES_PER_ELEMENT) * 4;
        const pointer = box2d._reserveInput(
            idsOffset + (bodies.length + joints.length) * Int32Array.BYTES_PER_ELEMENT,
        );
        box2d.HEAPU8.set(state, pointer);
        box2d.HEAP32.set(
            [
                ...bodies.map((body) => body.shapeSettings.entityId),
                ...joints.map((joint) => joint.jointId),
            ],
            (pointer + idsOffset) / Int32Array.BYTES_PER_ELEMENT,
        );
        const restoredPointer = box2d._restoreSnapshot(worldId, state.byteLength);
        if (!restoredPointer) {
            throw new Error('Box2D could not restore the physics state.');
        }
        const restoredIds = readWasmInt32s(
            box2d,
            restoredPointer,
            (bodies.length + joints.length) * 2,
        );
        bodies.forEach((body, index) => {
            makeWritable(body).bodyId = {
                index: assertWrap.isDefined(restoredIds[2 * index]),
                tag: assertWrap.isDefined(restoredIds[2 * index + 1]),
            };
        });
        joints.forEach((joint, index) => {
            makeWritable(joint).box2dJointId = {
                index: assertWrap.isDefined(restoredIds[2 * (bodies.length + index)]),
                tag: assertWrap.isDefined(restoredIds[2 * (bodies.length + index) + 1]),
            };
        });
        box2d._setGravity(worldId, this.gravity.x, this.gravity.y);
        box2d._setHitEventThreshold(worldId, this.hitEventThreshold);
        this.applySettings(worldId);
    }

    /** Draws the world's current state, as Box2D's debug drawing would draw it. */
    public drawDebug(options: Readonly<DebugDrawOptions2d>) {
        const {box2d, worldId} = this.requireWorld();
        writeDebugDrawOptions(box2d, options);
        return readDrawing(box2d, box2d._drawWorld(worldId));
    }

    /** Bodies that are not sleeping, which are the ones each step simulates. */
    public getAwakeBodyCount() {
        const {box2d, worldId} = this.requireWorld();
        return box2d._getAwakeBodyCount(worldId);
    }

    /** How long each part of the last step took, in milliseconds. */
    public getProfile() {
        const {box2d, worldId} = this.requireWorld();
        return readBindingValues(
            profileTemplate,
            readWasmFloat32s(
                box2d,
                box2d._readProfile(worldId),
                getObjectTypedKeys(profileTemplate).length,
            ),
        );
    }

    /** Counts of the world's internal objects and memory, mostly for debugging performance. */
    public getCounters(): PhysicsCounters2d {
        const {box2d, worldId} = this.requireWorld();
        const counterCount = getObjectTypedKeys(countersTemplate).length;
        const numbers = readWasmInt32s(
            box2d,
            box2d._readCounters(worldId),
            counterCount + graphColorCount,
        );
        return {
            ...readBindingValues(countersTemplate, numbers),
            colorCounts: numbers.slice(counterCount),
        };
    }

    /**
     * Starts recording every step and change to the world, for {@link PhysicsReplay2d}. Box2D can't
     * record callbacks, so while recording, the world can't have hooks or shapes that use
     * `oneWayDirection` or `enablePreSolve`. Resetting the world, such as by loading a snapshot,
     * discards the recording.
     *
     * @throws Error if the world is already recording or uses hooks or those shapes.
     */
    public startRecording() {
        const {box2d, worldId} = this.requireWorld();
        const errorMessages: Record<RecordingStart, string | undefined> = {
            [RecordingStart.Started]: undefined,
            [RecordingStart.AlreadyRecording]: 'The physics world is already recording.',
            [RecordingStart.HasHooks]: recordingHooksMessage,
            [RecordingStart.HasPreSolveShapes]: recordingPreSolveMessage,
        };
        const errorMessage =
            errorMessages[assertWrap.isEnumValue(box2d._startRecording(worldId), RecordingStart)];
        if (errorMessage) {
            throw new Error(errorMessage);
        }
    }

    /** Whether the world is recording its steps, see {@link startRecording}. */
    public isRecording() {
        const {box2d, worldId} = this.requireWorld();
        return !!box2d._isRecording(worldId);
    }

    /**
     * Stops recording and returns the recording, for {@link PhysicsReplay2d.create}.
     *
     * @throws Error if the world isn't recording.
     */
    public stopRecording() {
        const {box2d, worldId} = this.requireWorld();
        const pointer = box2d._stopRecording(worldId);
        if (!pointer) {
            throw new Error('The physics world is not recording.');
        }
        const [size] = readWasmInt32s(box2d, pointer, 1);
        const start = pointer + Int32Array.BYTES_PER_ELEMENT;
        return box2d.HEAPU8.slice(start, start + size);
    }

    /** Box2D's hash of the whole world's state. */
    public getStateHash() {
        const {box2d, worldId} = this.requireWorld();
        return BigInt.asUintN(64, box2d._getStateHash(worldId).valueOf());
    }

    /**
     * Finds the closest shape a line from `origin` to `origin + translation` crosses. Misses shapes
     * the line starts inside of.
     */
    public castRay({
        origin,
        translation,
        filter,
    }: Readonly<
        {
            origin: Readonly<Coords>;
            translation: Readonly<Coords>;
        } & CastFilter
    >) {
        const {box2d, worldId} = this.requireWorld();
        const pointer = box2d._castRay(
            worldId,
            origin.x,
            origin.y,
            translation.x,
            translation.y,
            filter?.category ?? allBits,
            filter?.mask ?? allBits,
        );
        return readHit(box2d, pointer);
    }

    /**
     * Sweeps `shape` from `position` to `position + translation` and finds the closest shape it
     * hits. `fraction` is how far it got before touching.
     */
    public castShape({
        shape,
        position,
        rotation,
        translation,
        filter,
    }: Readonly<
        {
            shape: Readonly<CastShapeDefinition>;
            position: Readonly<Coords>;
            translation: Readonly<Coords>;
        } & PartialWithUndefined<{
            /**
             * Radians, clockwise on screen.
             *
             * @default 0
             */
            rotation: number;
        }> &
            CastFilter
    >) {
        const {box2d, worldId} = this.requireWorld();
        const proxy = writeCastShape(box2d, shape);
        const castRotation = makeRotation(box2d, rotation ?? 0);
        const pointer = box2d._castShape(
            worldId,
            proxy.pointCount,
            proxy.radius,
            position.x,
            position.y,
            castRotation.cosine,
            castRotation.sine,
            translation.x,
            translation.y,
            filter?.category ?? allBits,
            filter?.mask ?? allBits,
        );
        return readHit(box2d, pointer);
    }

    /**
     * Finds every entity with a shape whose bounding box overlaps the box from `lowerBound` to
     * `upperBound`, including sensor shapes. Each entity appears once.
     */
    public overlapBox({
        lowerBound,
        upperBound,
        filter,
    }: Readonly<
        {
            lowerBound: Readonly<Coords>;
            upperBound: Readonly<Coords>;
        } & CastFilter
    >) {
        const {box2d, worldId} = this.requireWorld();
        const pointer = box2d._overlapAabb(
            worldId,
            lowerBound.x,
            lowerBound.y,
            upperBound.x,
            upperBound.y,
            filter?.category ?? allBits,
            filter?.mask ?? allBits,
        );
        return readWasmOverlaps(box2d, pointer);
    }

    /**
     * Finds every entity with a shape that overlaps `shape` placed at `position`, including sensor
     * shapes. Each entity appears once.
     */
    public overlapShape({
        shape,
        position,
        rotation,
        filter,
    }: Readonly<
        {
            shape: Readonly<CastShapeDefinition>;
            position: Readonly<Coords>;
        } & PartialWithUndefined<{
            /**
             * Radians, clockwise on screen.
             *
             * @default 0
             */
            rotation: number;
        }> &
            CastFilter
    >) {
        const {box2d, worldId} = this.requireWorld();
        const proxy = writeCastShape(box2d, shape);
        const overlapRotation = makeRotation(box2d, rotation ?? 0);
        const pointer = box2d._overlapShape(
            worldId,
            proxy.pointCount,
            proxy.radius,
            position.x,
            position.y,
            overlapRotation.cosine,
            overlapRotation.sine,
            filter?.category ?? allBits,
            filter?.mask ?? allBits,
        );
        return readWasmOverlaps(box2d, pointer);
    }

    /**
     * Pushes every dynamic body near `position` away from it (or toward it, with a negative
     * `impulsePerLength`). Each body's push grows with how much of its outline faces the
     * explosion.
     */
    public explode({
        position,
        radius,
        falloff,
        impulsePerLength,
        mask,
    }: Readonly<
        {
            position: Readonly<Coords>;
            /** Bodies within this distance get the full push. */
            radius: number;
            /** Game units of push per game unit of outline facing the explosion. */
            impulsePerLength: number;
        } & PartialWithUndefined<{
            /**
             * How far past `radius` the push fades out to nothing.
             *
             * @default 0
             */
            falloff: number;
            /**
             * Only pushes shapes whose collision category is in this mask. Leave it out to push
             * all.
             */
            mask: bigint;
        }>
    >) {
        const {box2d, worldId} = this.requireWorld();
        box2d._explode(
            worldId,
            position.x,
            position.y,
            radius,
            falloff ?? 0,
            impulsePerLength,
            mask ?? allBits,
        );
    }

    /**
     * Sweeps a character mover's `capsule` from `position` along `translation`, sliding past
     * surfaces it grazes, and returns how far it got before hitting something, from 0 to 1.
     */
    public castMover({
        capsule,
        position,
        translation,
        filter,
    }: Readonly<
        {
            capsule: Readonly<MoverCapsule2d>;
            position: Readonly<Coords>;
            translation: Readonly<Coords>;
        } & CastFilter
    >) {
        const {box2d, worldId} = this.requireWorld();
        return box2d._castMover(
            worldId,
            position.x,
            position.y,
            capsule.center1.x,
            capsule.center1.y,
            capsule.center2.x,
            capsule.center2.y,
            capsule.radius,
            translation.x,
            translation.y,
            filter?.category ?? allBits,
            filter?.mask ?? allBits,
        );
    }

    /**
     * Finds the surfaces a character mover's `capsule` at `position` touches, to pass to
     * {@link PhysicsWorld2d.solveMoverPlanes}.
     */
    public collideMover({
        capsule,
        position,
        filter,
    }: Readonly<
        {
            capsule: Readonly<MoverCapsule2d>;
            position: Readonly<Coords>;
        } & CastFilter
    >): MoverPlane2d[] {
        const {box2d, worldId} = this.requireWorld();
        const pointer = box2d._collideMover(
            worldId,
            position.x,
            position.y,
            capsule.center1.x,
            capsule.center1.y,
            capsule.center2.x,
            capsule.center2.y,
            capsule.radius,
            filter?.category ?? allBits,
            filter?.mask ?? allBits,
        );
        const [count] = readWasmInt32s(box2d, pointer, 1);
        return createArray(count, (index) => {
            const planePointer = pointer + (1 + index * 6) * Float32Array.BYTES_PER_ELEMENT;
            const [entityId] = readWasmInt32s(box2d, planePointer, 1);
            const [
                normalX,
                normalY,
                offset,
                pointX,
                pointY,
            ] = readWasmFloat32s(box2d, planePointer + Int32Array.BYTES_PER_ELEMENT, 5);
            return {
                entityId,
                normal: {
                    x: normalX,
                    y: normalY,
                },
                offset,
                point: {
                    x: pointX,
                    y: pointY,
                },
            };
        });
    }

    /**
     * Finds how far a character mover can move toward `targetDelta` without going through `planes`
     * (usually from {@link PhysicsWorld2d.collideMover} at the same position), and removes the parts
     * of `velocity` that push into the planes it pressed against.
     */
    public solveMoverPlanes({
        planes,
        targetDelta,
        velocity,
    }: Readonly<{
        planes: ReadonlyArray<Readonly<MoverCollisionPlane2d>>;
        targetDelta: Readonly<Coords>;
        velocity: Readonly<Coords>;
    }>) {
        const {box2d} = this.requireWorld();
        const values = planes.flatMap((plane) => {
            return [
                plane.normal.x,
                plane.normal.y,
                plane.offset,
                plane.pushLimit ?? Infinity,
                Number(!plane.isSoft),
            ];
        });
        writeInputFloats(box2d, values);
        const pointer = box2d._solveMoverPlanes(
            planes.length,
            targetDelta.x,
            targetDelta.y,
            velocity.x,
            velocity.y,
        );
        const [
            deltaX,
            deltaY,
            velocityX,
            velocityY,
        ] = readWasmFloat32s(box2d, pointer, 4);
        return {
            /** The translation to try, usually through {@link PhysicsWorld2d.castMover}. */
            delta: {
                x: deltaX,
                y: deltaY,
            },
            velocity: {
                x: velocityX,
                y: velocityY,
            },
        };
    }

    /** Destroys the Box2D world. Every later call that needs the world throws. */
    public destroy() {
        if (this.worldId != undefined) {
            this.destroyWorld(this.worldId);
        }
        this.worldId = undefined;
    }
}

/**
 * Plays back a recording from {@link PhysicsWorld2d.stopRecording} in its own world, one step
 * (frame) at a time. Recordings don't save entity ids, so bodies are known by the order they were
 * created in.
 *
 * @category Main
 */
export class PhysicsReplay2d {
    /**
     * Loads the Box2D module matching the recording's `pixelsPerMeter`, because a replay changes
     * its module's length scale to the recording's.
     *
     * @throws Error if Box2D can't read the recording.
     */
    public static async create(recording: Uint8Array) {
        const lengthScale = readRecordingLengthScale(recording);
        if (lengthScale == undefined) {
            throw new Error(invalidRecordingMessage);
        }
        const box2d = await loadBox2d(lengthScale);
        writeWasmInputBytes(box2d, recording);
        const replay = box2d._createReplay(recording.byteLength);
        if (!replay) {
            throw new Error(invalidRecordingMessage);
        }
        return new PhysicsReplay2d(box2d, replay);
    }

    /**
     * Replays the whole recording in a new world and checks that every step matches what was
     * recorded. False for recordings Box2D can't read.
     */
    public static async replaysExactly(recording: Uint8Array) {
        const lengthScale = readRecordingLengthScale(recording);
        if (lengthScale == undefined) {
            return false;
        }
        const box2d = await loadBox2d(lengthScale);
        writeWasmInputBytes(box2d, recording);
        return !!box2d._validateRecording(recording.byteLength);
    }

    protected readonly box2d: Box2dModule;
    protected replay: number | undefined;

    /** Use {@link PhysicsReplay2d.create} instead, which loads Box2D first. */
    protected constructor(box2d: Box2dModule, replay: number) {
        this.box2d = box2d;
        this.replay = replay;
    }

    /** @throws Error if the replay was destroyed. */
    protected requireReplay() {
        if (this.replay == undefined) {
            throw new Error('The physics replay has been destroyed.');
        }
        return {
            box2d: this.box2d,
            replay: this.replay,
        };
    }

    /** Replays the next frame. Returns false, replaying nothing, once at the end. */
    public stepFrame() {
        const {box2d, replay} = this.requireReplay();
        return !!box2d._stepReplayFrame(replay);
    }

    /** Goes back to before the first frame. */
    public restart() {
        const {box2d, replay} = this.requireReplay();
        box2d._restartReplay(replay);
    }

    /**
     * Jumps to just after `frame` was replayed, starting from the closest saved keyframe before it.
     * Frame 0 is before the first frame.
     */
    public seekFrame(frame: number) {
        const {box2d, replay} = this.requireReplay();
        box2d._seekReplayFrame(replay, frame);
    }

    /** Where playback is and how keyframes are being saved. */
    public getStatus() {
        const {box2d, replay} = this.requireReplay();
        const [
            frame,
            isAtEnd,
            divergedFrame,
            keyframeBudgetBytes,
            keyframeMinInterval,
            keyframeInterval,
            keyframeBytes,
        ] = readWasmInt32s(box2d, box2d._readReplayStatus(replay), 7);
        return {
            /** How many frames have been replayed. */
            frame,
            isAtEnd: !!isAtEnd,
            /** The first frame that didn't match the recording, if any. */
            divergedFrame: divergedFrame < 0 ? undefined : divergedFrame,
            /** See {@link PhysicsReplay2d.setKeyframePolicy}. */
            keyframeBudgetBytes,
            keyframeMinInterval,
            /** How many frames apart keyframes are currently saved. */
            keyframeInterval,
            /** Memory the saved keyframes use. */
            keyframeBytes,
        };
    }

    /** What the recording holds and the world settings it was recorded with. */
    public getInfo() {
        const {box2d, replay} = this.requireReplay();
        const [
            frameCount,
            stepSeconds,
            subStepCount,
            pixelsPerMeter,
            lowerX,
            lowerY,
            upperX,
            upperY,
        ] = readWasmFloat32s(box2d, box2d._readReplayInfo(replay), 8);
        return {
            frameCount,
            stepSeconds,
            subStepCount,
            pixelsPerMeter,
            /** Contains every body during the whole recording. */
            bounds: {
                lower: {
                    x: lowerX,
                    y: lowerY,
                },
                upper: {
                    x: upperX,
                    y: upperY,
                },
            },
        };
    }

    /**
     * Seeking replays from the closest keyframe, a saved copy of the world. Keyframes are saved at
     * least `minInterval` frames apart, spreading further apart to keep their memory under
     * `budgetBytes`.
     */
    public setKeyframePolicy({
        budgetBytes,
        minInterval,
    }: Readonly<{
        budgetBytes: number;
        minInterval: number;
    }>) {
        const {box2d, replay} = this.requireReplay();
        box2d._setReplayKeyframePolicy(replay, budgetBytes, minInterval);
    }

    /**
     * Each recorded body, in the order they were created, or undefined for bodies destroyed by the
     * current frame.
     */
    public getBodies() {
        const {box2d, replay} = this.requireReplay();
        const pointer = box2d._readReplayBodies(replay);
        const [count] = readWasmFloat32s(box2d, pointer, 1);
        const values = readWasmFloat32s(box2d, pointer + Float32Array.BYTES_PER_ELEMENT, count * 4);
        return createArray(count, (index): Transform2d | undefined => {
            const [
                exists,
                x,
                y,
                rotation,
            ] = assertWrap.isLengthExactly(values.slice(index * 4, index * 4 + 4), 4);
            return exists
                ? {
                      position: {
                          x,
                          y,
                      },
                      rotation,
                  }
                : undefined;
        });
    }

    /** The world queries made during the last replayed frame. */
    public getFrameQueries() {
        const {box2d, replay} = this.requireReplay();
        const [
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            queryCount,
        ] = readWasmInt32s(box2d, box2d._readReplayStatus(replay), 8);
        return createArray(queryCount, (queryIndex): ReplayQuery2d => {
            const pointer = box2d._readReplayQuery(replay, queryIndex);
            const [
                type,
                categoryLow,
                categoryHigh,
                maskLow,
                maskHigh,
                ,
                ,
                ,
                ,
                ,
                ,
                ,
                ,
                hitCount,
            ] = readWasmInt32s(box2d, pointer, replayQueryLength);
            const [
                ,
                ,
                ,
                ,
                ,
                lowerX,
                lowerY,
                upperX,
                upperY,
                originX,
                originY,
                translationX,
                translationY,
            ] = readWasmFloat32s(box2d, pointer, replayQueryLength);
            const hitsPointer = pointer + replayQueryLength * Int32Array.BYTES_PER_ELEMENT;
            return {
                type: assertWrap.isEnumValue(type, ReplayQueryType2d),
                filter: {
                    category: readFilterBits({
                        low: categoryLow,
                        high: categoryHigh,
                    }),
                    mask: readFilterBits({
                        low: maskLow,
                        high: maskHigh,
                    }),
                },
                bounds: {
                    lower: {
                        x: lowerX,
                        y: lowerY,
                    },
                    upper: {
                        x: upperX,
                        y: upperY,
                    },
                },
                origin: {
                    x: originX,
                    y: originY,
                },
                translation: {
                    x: translationX,
                    y: translationY,
                },
                hits: createArray(hitCount, (hitIndex) => {
                    const hitPointer =
                        hitsPointer +
                        hitIndex * replayQueryHitLength * Int32Array.BYTES_PER_ELEMENT;
                    const [bodyIndex] = readWasmInt32s(box2d, hitPointer, 1);
                    const [
                        ,
                        pointX,
                        pointY,
                        normalX,
                        normalY,
                        fraction,
                    ] = readWasmFloat32s(box2d, hitPointer, replayQueryHitLength);
                    return {
                        bodyIndex: bodyIndex < 0 ? undefined : bodyIndex,
                        point: {
                            x: pointX,
                            y: pointY,
                        },
                        normal: {
                            x: normalX,
                            y: normalY,
                        },
                        fraction,
                    };
                }),
            };
        });
    }

    /**
     * Draws the replayed world, like {@link PhysicsWorld2d.drawDebug}, plus the last replayed
     * frame's queries when `drawFrameQueries` is set.
     */
    public drawDebug({
        drawFrameQueries,
        frameQueryIndex,
        ...options
    }: Readonly<
        DebugDrawOptions2d &
            PartialWithUndefined<{
                drawFrameQueries: boolean;
                /** Draws only this query from {@link PhysicsReplay2d.getFrameQueries}. */
                frameQueryIndex: number;
            }>
    >) {
        const {box2d, replay} = this.requireReplay();
        writeDebugDrawOptions(box2d, options);
        return readDrawing(
            box2d,
            box2d._drawReplay(replay, drawFrameQueries ? (frameQueryIndex ?? -1) : -2),
        );
    }

    /** Releases the replay's world. Every later call throws. */
    public destroy() {
        if (this.replay != undefined) {
            this.box2d._destroyReplay(this.replay);
        }
        this.replay = undefined;
    }
}

const invalidRecordingMessage = 'Invalid recording: it is not from PhysicsWorld2d.stopRecording.';

/** The `lengthScale` in a recording's header, unless the header is missing or invalid. */
function readRecordingLengthScale(recording: Uint8Array) {
    const lengthScale =
        recording.byteLength < recordingHeaderLength
            ? 0
            : new DataView(recording.buffer, recording.byteOffset).getFloat32(12, true);
    return lengthScale > 0 ? lengthScale : undefined;
}

/**
 * Extra shapes that {@link PhysicsGeometry2d} takes, besides every {@link CastShapeDefinition}.
 *
 * @category Main
 */
export enum GeometryShapeType2d {
    /**
     * One segment of a chain, which only collides on its right side looking from `point1` to
     * `point2`. The ghost points are the chain's neighboring points, which smooth collisions at its
     * ends.
     */
    ChainSegment = 'chainSegment',
}

/**
 * A shape that {@link PhysicsGeometry2d} works with.
 *
 * @category Internal
 */
export type GeometryShape2d =
    | CastShapeDefinition
    | {
          type: GeometryShapeType2d.ChainSegment;
          ghost1: Coords;
          point1: Coords;
          point2: Coords;
          ghost2: Coords;
      };

/**
 * A box aligned with the axes.
 *
 * @category Internal
 */
export type Bounds2d = {
    lowerBound: Coords;
    upperBound: Coords;
};

/**
 * Where a ray or shape cast from {@link PhysicsGeometry2d} hit a shape.
 *
 * @category Internal
 */
export type GeometryHit2d = Omit<CastHit2d, 'entityId'>;

/**
 * A shape's motion from `start` to `end` for {@link PhysicsGeometry2d.computeTimeOfImpact}.
 *
 * @category Internal
 */
export type Sweep2d = {
    start: Transform2d;
    end: Transform2d;
} & PartialWithUndefined<{
    /**
     * The point the shape turns around, usually its center of mass, relative to the shape before
     * its rotation.
     *
     * @default {x: 0, y: 0}
     */
    localCenter: Coords;
}>;

/**
 * How {@link PhysicsGeometry2d.computeTimeOfImpact} ended.
 *
 * @category Main
 */
export enum TimeOfImpactState2d {
    Unknown = 'unknown',
    /** Box2D gave up before finding an answer. */
    Failed = 'failed',
    /** The shapes already overlap at the start. */
    Overlapped = 'overlapped',
    Hit = 'hit',
    /** The shapes never touch. */
    Separated = 'separated',
}

/** In the order of Box2D's `b2TOIState`. */
const timeOfImpactStates = [
    TimeOfImpactState2d.Unknown,
    TimeOfImpactState2d.Failed,
    TimeOfImpactState2d.Overlapped,
    TimeOfImpactState2d.Hit,
    TimeOfImpactState2d.Separated,
];

/** The `kind` that `loadGeometryShape` in `bindings.c` reads. */
const geometryKinds: Record<GeometryShape2d['type'], number> = {
    [ShapeType.Circle]: 0,
    [ShapeType.Capsule]: 1,
    [ShapeType.Segment]: 2,
    [ShapeType.Box]: 3,
    [ShapeType.Polygon]: 3,
    [GeometryShapeType2d.ChainSegment]: 4,
};

const identityTransform: Transform2d = {
    position: {
        x: 0,
        y: 0,
    },
    rotation: 0,
};

/**
 * Writes shapes where the next geometry binding reads them, followed by `extraFloats`.
 *
 * @throws Error if a shape is invalid.
 */
function writeGeometryShapes(
    box2d: Box2dModule,
    shapes: ReadonlyArray<Readonly<GeometryShape2d>>,
    extraFloats: ReadonlyArray<number> = [],
) {
    const floats = shapes.flatMap((shape) => {
        const proxy =
            shape.type === GeometryShapeType2d.ChainSegment
                ? {
                      points: [
                          shape.ghost1,
                          shape.point1,
                          shape.point2,
                          shape.ghost2,
                      ],
                      radius: 0,
                  }
                : readCastShapeProxy(shape);
        const offset = shape.type === GeometryShapeType2d.ChainSegment ? undefined : shape.offset;
        return [
            geometryKinds[shape.type],
            proxy.radius,
            proxy.points.length,
            ...createArray(maxPolygonPointCount, (index) => {
                const point = proxy.points[index];
                return [
                    (point?.x ?? 0) + (offset?.x ?? 0),
                    (point?.y ?? 0) + (offset?.y ?? 0),
                ];
            }).flat(),
        ];
    });
    const allFloats = [
        ...floats,
        ...extraFloats,
    ];
    const pointer = box2d._reserveInput(allFloats.length * Float32Array.BYTES_PER_ELEMENT);
    box2d.HEAPF32.set(allFloats, pointer / Float32Array.BYTES_PER_ELEMENT);
}

/** @throws Error if the binding couldn't load a shape, which only happens for flat polygons. */
function requireGeometryOutput(pointer: number) {
    if (!pointer) {
        throw new Error(collinearPolygonMessage);
    }
    return pointer;
}

function readBounds(box2d: Box2dModule, pointer: number): Bounds2d {
    const [
        lowerX,
        lowerY,
        upperX,
        upperY,
    ] = readWasmFloat32s(box2d, pointer, 4);
    return {
        lowerBound: {
            x: lowerX,
            y: lowerY,
        },
        upperBound: {
            x: upperX,
            y: upperY,
        },
    };
}

/** Reads `writeCastOutput` from `bindings.c`. */
function readGeometryHit(box2d: Box2dModule, pointer: number): GeometryHit2d | undefined {
    const [
        isHit,
        pointX,
        pointY,
        normalX,
        normalY,
        fraction,
    ] = readWasmFloat32s(box2d, pointer, 6);
    return isHit
        ? {
              point: {
                  x: pointX,
                  y: pointY,
              },
              normal: {
                  x: normalX,
                  y: normalY,
              },
              fraction,
          }
        : undefined;
}

function writeTransform(box2d: Box2dModule, transform: Readonly<Transform2d> | undefined) {
    const {position, rotation} = transform ?? identityTransform;
    const {cosine, sine} = makeRotation(box2d, rotation);
    return [
        position.x,
        position.y,
        cosine,
        sine,
    ] as const;
}

/** A sweep as `computeTimeOfImpact` in `bindings.c` reads it. */
function writeSweep(box2d: Box2dModule, {start, end, localCenter}: Readonly<Sweep2d>) {
    const [
        startRotation,
        endRotation,
    ] = [
        start,
        end,
    ].map((transform) => {
        return makeRotation(box2d, transform.rotation);
    });
    const center = localCenter ?? identityTransform.position;
    const [
        startCenter,
        endCenter,
    ] = [
        {
            transform: start,
            rotation: assertWrap.isDefined(startRotation),
        },
        {
            transform: end,
            rotation: assertWrap.isDefined(endRotation),
        },
    ].map(({transform, rotation}) => {
        return [
            transform.position.x + rotation.cosine * center.x - rotation.sine * center.y,
            transform.position.y + rotation.sine * center.x + rotation.cosine * center.y,
        ];
    });
    return [
        center.x,
        center.y,
        ...assertWrap.isDefined(startCenter),
        ...assertWrap.isDefined(endCenter),
        assertWrap.isDefined(startRotation).cosine,
        assertWrap.isDefined(startRotation).sine,
        assertWrap.isDefined(endRotation).cosine,
        assertWrap.isDefined(endRotation).sine,
    ];
}

/**
 * A contact between two shapes from {@link PhysicsGeometry2d.collide}.
 *
 * @category Internal
 */
export type Manifold2d = {
    /** Points from shape A toward shape B. */
    normal: Coords;
    /** Empty when the shapes aren't touching. */
    points: {
        /** In world space, halfway between the two surfaces. */
        point: Coords;
        /** Negative when the shapes overlap. */
        separation: number;
        /** Stays the same for the same feature pair as the shapes move. */
        id: number;
    }[];
};

/**
 * Shape math without a world, like Box2D's collision functions: mass, bounds, casts, distances,
 * time of impact, and contacts between single shapes. Every transform defaults to the origin with
 * no rotation.
 *
 * @category Main
 */
export class PhysicsGeometry2d {
    /** Loads Box2D, shared with every world that has the same `pixelsPerMeter`. */
    public static async create(options: Readonly<PhysicsOptions> = {}) {
        return new PhysicsGeometry2d(await loadBox2d(options.pixelsPerMeter ?? 1));
    }

    protected readonly box2d: Box2dModule;

    /** Use {@link PhysicsGeometry2d.create} instead, which loads Box2D first. */
    protected constructor(box2d: Box2dModule) {
        this.box2d = box2d;
    }

    /**
     * The mass that the shape's `material.density` gives it, with its center relative to the
     * shape's origin. Segments have no mass.
     */
    public computeMass(shape: Readonly<GeometryShape2d>): MassData2d {
        writeGeometryShapes(this.box2d, [shape]);
        const [
            mass,
            centerX,
            centerY,
            rotationalInertia,
        ] = readWasmFloat32s(
            this.box2d,
            requireGeometryOutput(
                this.box2d._computeGeometryMass(
                    (shape.type === GeometryShapeType2d.ChainSegment
                        ? undefined
                        : shape.material?.density) ?? 1,
                ),
            ),
            4,
        );
        return {
            mass,
            center: {
                x: centerX,
                y: centerY,
            },
            rotationalInertia,
        };
    }

    /** The smallest box around the shape. */
    public computeBounds({
        shape,
        transform,
    }: Readonly<{
        shape: Readonly<GeometryShape2d>;
        transform?: Readonly<Transform2d> | undefined;
    }>) {
        writeGeometryShapes(this.box2d, [shape]);
        return readBounds(
            this.box2d,
            requireGeometryOutput(
                this.box2d._computeGeometryBounds(...writeTransform(this.box2d, transform)),
            ),
        );
    }

    /** Segments contain no points. */
    public containsPoint({
        shape,
        transform,
        point,
    }: Readonly<{
        shape: Readonly<GeometryShape2d>;
        transform?: Readonly<Transform2d> | undefined;
        point: Readonly<Coords>;
    }>) {
        writeGeometryShapes(this.box2d, [shape]);
        const [isInside] = readWasmInt32s(
            this.box2d,
            requireGeometryOutput(
                this.box2d._containsGeometryPoint(
                    ...writeTransform(this.box2d, transform),
                    point.x,
                    point.y,
                ),
            ),
            1,
        );
        return !!isInside;
    }

    /**
     * Where a ray from `origin` along `translation` first hits the shape. Rays starting inside a
     * solid shape don't hit it, and chain segments only block rays from their right side.
     */
    public castRay({
        shape,
        transform,
        origin,
        translation,
        maxFraction,
    }: Readonly<
        {
            shape: Readonly<GeometryShape2d>;
            origin: Readonly<Coords>;
            translation: Readonly<Coords>;
        } & PartialWithUndefined<{
            transform: Readonly<Transform2d>;
            /**
             * How much of `translation` to check.
             *
             * @default 1
             */
            maxFraction: number;
        }>
    >) {
        writeGeometryShapes(this.box2d, [shape]);
        return readGeometryHit(
            this.box2d,
            requireGeometryOutput(
                this.box2d._castGeometryRay(
                    ...writeTransform(this.box2d, transform),
                    origin.x,
                    origin.y,
                    translation.x,
                    translation.y,
                    maxFraction ?? 1,
                ),
            ),
        );
    }

    /**
     * Where `shapeB` first hits `shapeA` while sweeping along `translation` without turning. A zero
     * fraction means they already touch.
     */
    public castShape({
        shapeA,
        transformA,
        shapeB,
        transformB,
        translation,
        maxFraction,
        canEncroach,
    }: Readonly<
        {
            shapeA: Readonly<GeometryShape2d>;
            shapeB: Readonly<GeometryShape2d>;
            translation: Readonly<Coords>;
        } & PartialWithUndefined<{
            transformA: Readonly<Transform2d>;
            transformB: Readonly<Transform2d>;
            /** @default 1 */
            maxFraction: number;
            /**
             * Lets shapes that already touch move a little closer before counting as a hit, so a
             * shape resting on another can still slide along it. Only works for shapes with a
             * radius.
             */
            canEncroach: boolean;
        }>
    >) {
        writeGeometryShapes(this.box2d, [
            shapeA,
            shapeB,
        ]);
        return readGeometryHit(
            this.box2d,
            requireGeometryOutput(
                this.box2d._castGeometryShape(
                    ...writeTransform(this.box2d, transformA),
                    ...writeTransform(this.box2d, transformB),
                    translation.x,
                    translation.y,
                    maxFraction ?? 1,
                    Number(!!canEncroach),
                ),
            ),
        );
    }

    /** The closest points between two shapes, in world space. 0 distance when they overlap. */
    public computeDistance({
        shapeA,
        transformA,
        shapeB,
        transformB,
        ignoreRadii,
    }: Readonly<
        {
            shapeA: Readonly<GeometryShape2d>;
            shapeB: Readonly<GeometryShape2d>;
        } & PartialWithUndefined<{
            transformA: Readonly<Transform2d>;
            transformB: Readonly<Transform2d>;
            /** Measures between the shapes' cores, as if circles were points and capsules lines. */
            ignoreRadii: boolean;
        }>
    >) {
        writeGeometryShapes(this.box2d, [
            shapeA,
            shapeB,
        ]);
        const [
            pointAX,
            pointAY,
            pointBX,
            pointBY,
            normalX,
            normalY,
            distance,
            iterations,
        ] = readWasmFloat32s(
            this.box2d,
            requireGeometryOutput(
                this.box2d._computeGeometryDistance(
                    ...writeTransform(this.box2d, transformA),
                    ...writeTransform(this.box2d, transformB),
                    Number(!ignoreRadii),
                ),
            ),
            8,
        );
        return {
            pointA: {
                x: pointAX,
                y: pointAY,
            },
            pointB: {
                x: pointBX,
                y: pointBY,
            },
            /** Points from shape A toward shape B. Meaningless when `distance` is 0. */
            normal: {
                x: normalX,
                y: normalY,
            },
            distance,
            /** How many steps Box2D's GJK distance algorithm took. */
            iterations,
        };
    }

    /**
     * The closest points between two line segments. Each fraction is how far along its segment the
     * closest point is, from 0 at `point1` to 1 at `point2`.
     */
    public computeSegmentDistance({
        segment1,
        segment2,
    }: Readonly<{
        segment1: Readonly<{
            point1: Readonly<Coords>;
            point2: Readonly<Coords>;
        }>;
        segment2: Readonly<{
            point1: Readonly<Coords>;
            point2: Readonly<Coords>;
        }>;
    }>) {
        const [
            closest1X,
            closest1Y,
            closest2X,
            closest2Y,
            fraction1,
            fraction2,
            distanceSquared,
        ] = readWasmFloat32s(
            this.box2d,
            this.box2d._computeSegmentDistance(
                segment1.point1.x,
                segment1.point1.y,
                segment1.point2.x,
                segment1.point2.y,
                segment2.point1.x,
                segment2.point1.y,
                segment2.point2.x,
                segment2.point2.y,
            ),
            7,
        );
        return {
            closest1: {
                x: closest1X,
                y: closest1Y,
            },
            closest2: {
                x: closest2X,
                y: closest2Y,
            },
            fraction1,
            fraction2,
            distance: Math.sqrt(distanceSquared),
        };
    }

    /**
     * When two moving and turning shapes first touch, as a fraction of their sweeps. This is how
     * Box2D keeps fast bodies from tunneling.
     */
    public computeTimeOfImpact({
        shapeA,
        sweepA,
        shapeB,
        sweepB,
        maxFraction,
    }: Readonly<
        {
            shapeA: Readonly<GeometryShape2d>;
            sweepA: Readonly<Sweep2d>;
            shapeB: Readonly<GeometryShape2d>;
            sweepB: Readonly<Sweep2d>;
        } & PartialWithUndefined<{
            /** @default 1 */
            maxFraction: number;
        }>
    >) {
        writeGeometryShapes(
            this.box2d,
            [
                shapeA,
                shapeB,
            ],
            [
                ...writeSweep(this.box2d, sweepA),
                ...writeSweep(this.box2d, sweepB),
            ],
        );
        const [
            state,
            pointX,
            pointY,
            normalX,
            normalY,
            fraction,
        ] = readWasmFloat32s(
            this.box2d,
            requireGeometryOutput(this.box2d._computeTimeOfImpact(maxFraction ?? 1)),
            6,
        );
        return {
            state: assertWrap.isDefined(timeOfImpactStates[state]),
            /**
             * Where the shapes touch, in world space, when `state` is
             * {@link TimeOfImpactState2d.Hit}.
             */
            point: {
                x: pointX,
                y: pointY,
            },
            /** Points from shape A toward shape B, when `state` is {@link TimeOfImpactState2d.Hit}. */
            normal: {
                x: normalX,
                y: normalY,
            },
            fraction,
        };
    }

    /**
     * The contact points Box2D's solver would use between two shapes, including speculative ones
     * where the shapes are close but not yet touching. Segments and chain segments never touch each
     * other.
     */
    public collide({
        shapeA,
        transformA,
        shapeB,
        transformB,
    }: Readonly<
        {
            shapeA: Readonly<GeometryShape2d>;
            shapeB: Readonly<GeometryShape2d>;
        } & PartialWithUndefined<{
            transformA: Readonly<Transform2d>;
            transformB: Readonly<Transform2d>;
        }>
    >): Manifold2d {
        writeGeometryShapes(this.box2d, [
            shapeA,
            shapeB,
        ]);
        const pointer = requireGeometryOutput(
            this.box2d._collideGeometry(
                ...writeTransform(this.box2d, transformA),
                ...writeTransform(this.box2d, transformB),
            ),
        );
        const [
            pointCount,
            normalX,
            normalY,
        ] = readWasmFloat32s(this.box2d, pointer, 3);
        const pointFloats = readWasmFloat32s(
            this.box2d,
            pointer + 3 * Float32Array.BYTES_PER_ELEMENT,
            pointCount * 4,
        );
        return {
            normal: {
                x: normalX,
                y: normalY,
            },
            points: createArray(pointCount, (index) => {
                const [
                    x,
                    y,
                    separation,
                    id,
                ] = assertWrap.isLengthExactly(pointFloats.slice(index * 4, index * 4 + 4), 4);
                return {
                    point: {
                        x,
                        y,
                    },
                    separation,
                    id,
                };
            }),
        };
    }

    /**
     * The smallest convex polygon around `points`, in Box2D's order. Undefined when the points all
     * lie on one line or there are more than 8 of them.
     */
    public computeHull(points: ReadonlyArray<Readonly<Coords>>) {
        writePoints(this.box2d, points, undefined);
        const pointer = this.box2d._computeHull(points.length);
        const [count] = readWasmFloat32s(this.box2d, pointer, 1);
        if (!count) {
            return undefined;
        }
        const floats = readWasmFloat32s(
            this.box2d,
            pointer + Float32Array.BYTES_PER_ELEMENT,
            count * 2,
        );
        return createArray(count, (index): Coords => {
            return {
                x: assertWrap.isDefined(floats[index * 2]),
                y: assertWrap.isDefined(floats[index * 2 + 1]),
            };
        });
    }

    /** Creates an empty {@link DynamicTree2d}. */
    public createTree() {
        return new DynamicTree2d(this.box2d, this.box2d._createTree());
    }
}

/** Reads `writeFoundProxies` from `bindings.c`. */
function readFoundProxies(box2d: Box2dModule, pointer: number) {
    const [count] = readWasmInt32s(box2d, pointer, 1);
    return readWasmInt32s(box2d, pointer + Int32Array.BYTES_PER_ELEMENT, count);
}

/**
 * Box2D's dynamic tree: boxes (proxies) sorted for fast overlap and cast queries, like the tree
 * each world keeps its shapes in. Queries find every proxy whose box the query touches, in no
 * particular order. Create one with {@link PhysicsGeometry2d.createTree}.
 *
 * @category Main
 */
export class DynamicTree2d {
    protected readonly box2d: Box2dModule;
    protected tree: number | undefined;
    protected readonly proxyIds = new Set<number>();

    /** Use {@link PhysicsGeometry2d.createTree} instead. */
    constructor(box2d: Box2dModule, tree: number) {
        this.box2d = box2d;
        this.tree = tree;
    }

    /** @throws Error if the tree was destroyed. */
    protected requireTree() {
        if (this.tree == undefined) {
            throw new Error('The dynamic tree has been destroyed.');
        }
        return this.tree;
    }

    /** @throws Error if the tree was destroyed or has no proxy with this id. */
    protected requireProxy(proxyId: number) {
        const tree = this.requireTree();
        if (!this.proxyIds.has(proxyId)) {
            throw new Error(`The dynamic tree has no proxy ${proxyId}.`);
        }
        return tree;
    }

    /** Adds a box and returns its proxy id. Ids of destroyed proxies get reused. */
    public createProxy({
        bounds,
        category,
    }: Readonly<{
        bounds: Readonly<Bounds2d>;
        /**
         * Filters queries: they only find proxies whose category is in their mask.
         *
         * @default every category
         */
        category?: bigint | undefined;
    }>) {
        const proxyId = this.box2d._createTreeProxy(
            this.requireTree(),
            bounds.lowerBound.x,
            bounds.lowerBound.y,
            bounds.upperBound.x,
            bounds.upperBound.y,
            category ?? allBits,
        );
        this.proxyIds.add(proxyId);
        return proxyId;
    }

    /** @throws Error if there is no proxy with this id. */
    public destroyProxy(proxyId: number) {
        this.box2d._destroyTreeProxy(this.requireProxy(proxyId), proxyId);
        this.proxyIds.delete(proxyId);
    }

    /** @throws Error if there is no proxy with this id. */
    public moveProxy({
        proxyId,
        bounds,
    }: Readonly<{
        proxyId: number;
        bounds: Readonly<Bounds2d>;
    }>) {
        this.box2d._moveTreeProxy(
            this.requireProxy(proxyId),
            proxyId,
            bounds.lowerBound.x,
            bounds.lowerBound.y,
            bounds.upperBound.x,
            bounds.upperBound.y,
        );
    }

    /** @throws Error if there is no proxy with this id. */
    public setProxyCategory({
        proxyId,
        category,
    }: Readonly<{
        proxyId: number;
        category: bigint;
    }>) {
        this.box2d._setTreeProxyCategory(this.requireProxy(proxyId), proxyId, category);
    }

    /** @throws Error if there is no proxy with this id. */
    public getProxyCategory(proxyId: number) {
        return BigInt.asUintN(
            64,
            this.box2d._getTreeProxyCategory(this.requireProxy(proxyId), proxyId).valueOf(),
        );
    }

    /**
     * The proxy's box, which can be slightly bigger than the box it was given.
     *
     * @throws Error if there is no proxy with this id.
     */
    public getProxyBounds(proxyId: number) {
        return readBounds(
            this.box2d,
            this.box2d._readTreeProxyBounds(this.requireProxy(proxyId), proxyId),
        );
    }

    /** Every proxy whose box overlaps `bounds`. */
    public queryBounds({
        bounds,
        mask,
    }: Readonly<{
        bounds: Readonly<Bounds2d>;
        /** @default every category */
        mask?: bigint | undefined;
    }>) {
        return readFoundProxies(
            this.box2d,
            this.box2d._queryTree(
                this.requireTree(),
                bounds.lowerBound.x,
                bounds.lowerBound.y,
                bounds.upperBound.x,
                bounds.upperBound.y,
                mask ?? allBits,
            ),
        );
    }

    /** Every proxy whose box the ray from `origin` along `translation` passes through. */
    public castRay({
        origin,
        translation,
        maxFraction,
        mask,
    }: Readonly<
        {
            origin: Readonly<Coords>;
            translation: Readonly<Coords>;
        } & PartialWithUndefined<{
            /** @default 1 */
            maxFraction: number;
            /** @default every category */
            mask: bigint;
        }>
    >) {
        return readFoundProxies(
            this.box2d,
            this.box2d._castTreeRay(
                this.requireTree(),
                origin.x,
                origin.y,
                translation.x,
                translation.y,
                maxFraction ?? 1,
                mask ?? allBits,
            ),
        );
    }

    /** Every proxy whose box `bounds` passes through while sweeping along `translation`. */
    public castBox({
        bounds,
        translation,
        maxFraction,
        mask,
    }: Readonly<
        {
            bounds: Readonly<Bounds2d>;
            translation: Readonly<Coords>;
        } & PartialWithUndefined<{
            /** @default 1 */
            maxFraction: number;
            /** @default every category */
            mask: bigint;
        }>
    >) {
        return readFoundProxies(
            this.box2d,
            this.box2d._castTreeBox(
                this.requireTree(),
                bounds.lowerBound.x,
                bounds.lowerBound.y,
                bounds.upperBound.x,
                bounds.upperBound.y,
                translation.x,
                translation.y,
                maxFraction ?? 1,
                mask ?? allBits,
            ),
        );
    }

    /** The tree's shape and memory use. */
    public getStats() {
        const pointer = this.box2d._readTreeStats(this.requireTree());
        const [
            height,
            areaRatio,
            proxyCount,
            byteCount,
        ] = readWasmFloat32s(this.box2d, pointer, 4);
        return {
            height,
            /** The internal boxes' total area divided by the root's. Lower makes faster queries. */
            areaRatio,
            proxyCount,
            byteCount,
            /** The box around every proxy. */
            rootBounds: readBounds(this.box2d, pointer + 4 * Float32Array.BYTES_PER_ELEMENT),
        };
    }

    /** Releases the tree. Every later call throws. */
    public destroy() {
        if (this.tree != undefined) {
            this.box2d._destroyTree(this.tree);
        }
        this.tree = undefined;
    }
}
