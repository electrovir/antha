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
    makeWritable,
    mapObjectValues,
    omitObjectKeys,
    removeDuplicates,
    type Coords3d,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {
    defineShape,
    enumShape,
    exactShape,
    intersectShape,
    optionalShape,
    partialShape,
    tupleShape,
    unionShape,
} from 'object-shape-tester';
import box3dFactory, {type MainModule as Box3dModule} from './box3d/box3d.mjs';

/**
 * The geometry of one physics shape.
 *
 * @category Main
 */
export enum ShapeType {
    Sphere = 'sphere',
    Box = 'box',
    /** A cylinder with rounded ends, standing along the shape's y axis. */
    Capsule = 'capsule',
    /** The smallest convex shape that wraps a set of points. */
    Hull = 'hull',
    /** Any triangle surface. Only allowed on static bodies. */
    Mesh = 'mesh',
    /** A grid of heights, such as terrain. Only allowed on static bodies. */
    HeightField = 'height-field',
    /**
     * Many shapes that Box3D handles as one, which is faster for large static scenery. Only allowed
     * on static bodies.
     */
    Compound = 'compound',
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
    /**
     * How much the shape resists rolling, usually from 0 to 1. Only spheres and capsules roll.
     *
     * @default 0
     */
    rollingResistance: number;
    /**
     * Moves things along the shape's surface like a conveyor belt, in meters per second relative to
     * the shape's rotation. Only the part along the touching surface applies.
     */
    tangentVelocity: Coords3d;
    /**
     * Tells surfaces apart in the world's `mixFriction` and `mixRestitution` hooks. A whole number
     * from 0 to 16777216.
     *
     * @default 0
     */
    userMaterialId: number;
}>;

/**
 * The part of {@link PhysicsMaterial} that can differ across one shape's surface.
 *
 * @category Internal
 */
export type SurfaceMaterial = Omit<PhysicsMaterial, 'density'>;

/**
 * The rotation setting that every non-round shape has.
 *
 * @category Internal
 */
export type RotatedShapeSettings = PartialWithUndefined<{
    /** Turns the shape around its `offset`, relative to the body's rotation. */
    rotation: Quaternion;
}>;

/**
 * The settings only sphere shapes have.
 *
 * @category Internal
 */
export type SphereGeometry = {
    type: ShapeType.Sphere;
    radius: number;
};

/**
 * The settings only box shapes have.
 *
 * @category Internal
 */
export type BoxGeometry = {
    type: ShapeType.Box;
    width: number;
    height: number;
    depth: number;
} & RotatedShapeSettings;

/**
 * The settings only capsule shapes have.
 *
 * @category Internal
 */
export type CapsuleGeometry = {
    type: ShapeType.Capsule;
    radius: number;
    /** End to end, including both rounded ends. Must be at least `radius * 2`. */
    height: number;
} & RotatedShapeSettings;

/**
 * The settings only convex hull shapes have.
 *
 * @category Internal
 */
export type HullGeometry = {
    type: ShapeType.Hull;
    /** At least 4 points that don't all lie on one plane. */
    points: ReadonlyArray<Readonly<Coords3d>>;
} & RotatedShapeSettings;

/**
 * The settings only triangle mesh shapes have.
 *
 * @category Internal
 */
export type MeshGeometry = {
    type: ShapeType.Mesh;
    vertices: ReadonlyArray<Readonly<Coords3d>>;
    /** Each triangle is three indexes into `vertices`. */
    triangles: ReadonlyArray<
        Readonly<
            [
                number,
                number,
                number,
            ]
        >
    >;
} & PartialWithUndefined<{
    /**
     * A material for each triangle, in triangle order. Values left out fall back to `material`. At
     * most 256 different materials, or 4 in a compound.
     */
    triangleMaterials: ReadonlyArray<Readonly<SurfaceMaterial>>;
    /** Merges vertices that are closer together than this, in meters. */
    weldTolerance: number;
    /** Builds the mesh faster, which suits grid-like meshes but can make collisions slower. */
    useMedianSplit: boolean;
}> &
    RotatedShapeSettings;

/**
 * One shape inside a {@link ShapeType.Compound} shape.
 *
 * @category Internal
 */
export type CompoundChildDefinition = (
    | SphereGeometry
    | BoxGeometry
    | CapsuleGeometry
    | HullGeometry
    | MeshGeometry
) &
    PartialWithUndefined<{
        /** Where the child's center sits relative to the body's position. */
        offset: Coords3d;
        /** Values left out fall back to the compound's `material`. */
        material: SurfaceMaterial;
    }>;

/**
 * One shape attached to an entity's physics body. Lengths are in meters.
 *
 * @category Internal
 */
export type PhysicsShapeDefinition = (
    | SphereGeometry
    | BoxGeometry
    | CapsuleGeometry
    | HullGeometry
    | (MeshGeometry & {
          /**
           * Box3D only checks the first of the triangles a body touches when deciding whether a
           * one-way contact counts, so these can't be one-way.
           */
          oneWayDirection?: undefined;
      })
    | ({
          type: ShapeType.HeightField;
          /**
           * Rows along z, each with one height per column along x. Every row must be the same
           * length, and there must be at least 2 rows and 2 columns. The point at
           * `heights[row][column]` sits at `(column * scale.x, height * scale.y, row * scale.z)`
           * relative to the body's position.
           */
          heights: ReadonlyArray<ReadonlyArray<number>>;
          /** Every component must be positive. */
          scale: Readonly<Coords3d>;
          /** Height fields can't be offset. Move their body instead. */
          offset?: undefined;
          /**
           * Box3D only checks the first of the triangles a body touches when deciding whether a
           * one-way contact counts, so these can't be one-way.
           */
          oneWayDirection?: undefined;
      } & PartialWithUndefined<{
          /**
           * A material for each grid cell, as rows along z of one per column along x, so one less
           * row and column than `heights`. Values left out fall back to `material`. At most 255
           * different materials.
           */
          cellMaterials: ReadonlyArray<ReadonlyArray<Readonly<SurfaceMaterial>>>;
          /** Grid cells with no surface, which things fall through. */
          holes: ReadonlyArray<
              Readonly<{
                  row: number;
                  column: number;
              }>
          >;
          /**
           * Box3D stores heights compressed within this range and clamps heights outside it. Give
           * height fields that sit next to each other the same range so their edges line up
           * exactly.
           *
           * @default the lowest and highest of `heights`
           */
          heightRange: Readonly<{
              minimum: number;
              maximum: number;
          }>;
          /** Turns the height field's surface upside down, so it collides from below. */
          isUpsideDown: boolean;
      }>)
    | {
          type: ShapeType.Compound;
          /** At least 1 child. */
          children: ReadonlyArray<Readonly<CompoundChildDefinition>>;
          /** Compounds can't be offset. Offset their children instead. */
          offset?: undefined;
          /** Box3D compounds can't be sensors. */
          isSensor?: undefined;
          /** Compounds can't be one-way. */
          oneWayDirection?: undefined;
      }
) &
    PartialWithUndefined<{
        /** Where the shape's center sits relative to the body's position. */
        offset: Coords3d;
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
        oneWayDirection: Coords3d;
        /** Asks the world's `customFilter` hook whether this shape may touch each shape it meets. */
        enableCustomFiltering: boolean;
        /** Runs the world's `preSolve` hook for this shape's contacts. */
        enablePreSolve: boolean;
        /**
         * Overrides the collision filter between shapes with the same non-zero group: positive
         * groups always collide and negative groups never do, such as the parts of one ragdoll.
         */
        collisionGroup: number;
        /**
         * Scales the push {@link PhysicsWorld3d.explode} gives this shape. 0 ignores explosions.
         *
         * @default 1
         */
        explosionScale: number;
    }>;

/**
 * A shape that {@link PhysicsWorld3d.castShape} can sweep through the world.
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
export type CastShapeType = ShapeType.Sphere | ShapeType.Box | ShapeType.Capsule | ShapeType.Hull;

type CompoundChildType = CompoundChildDefinition['type'];

/**
 * The closest shape a ray or shape cast hit.
 *
 * @category Internal
 */
export type CastHit3d = {
    /** The entity whose shape was hit. */
    entityId: number;
    /** Where the hit happened, in world space. */
    point: Coords3d;
    /** The hit surface's direction, pointing back toward the cast. */
    normal: Coords3d;
    /** How far along `translation` the hit happened, from 0 to 1. */
    fraction: number;
};

/**
 * A collision reported to the `contactHit` entity hook.
 *
 * @category Internal
 */
export type Hit3d = {
    /** Where the shapes hit, in world space. */
    point: Coords3d;
    /** Points from the other entity toward this one. */
    normal: Coords3d;
    /** How fast the shapes were closing in on each other, in meters per second. Always positive. */
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
 * the same point for both centers to make a sphere.
 *
 * @category Internal
 */
export type MoverCapsule3d = {
    center1: Coords3d;
    center2: Coords3d;
    radius: number;
};

/**
 * A surface touching a character mover, found by {@link PhysicsWorld3d.collideMover}. The plane is
 * relative to the mover's position.
 *
 * @category Internal
 */
export type MoverPlane3d = {
    /** The entity whose shape the mover touches. */
    entityId: number;
    /** Points out of the surface, toward the mover. */
    normal: Coords3d;
    /** How deep the mover overlaps the shape along `normal`. 0 when they only touch. */
    offset: number;
    /** The closest point on the touched shape, in world space. */
    point: Coords3d;
};

/**
 * A plane that {@link PhysicsWorld3d.solveMoverPlanes} keeps a character mover out of.
 *
 * @category Internal
 */
export type MoverCollisionPlane3d = Pick<MoverPlane3d, 'normal' | 'offset'> &
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
        /** Stops the body from moving along or turning around the locked world axes. */
        motionLocks: Partial<MotionLocks3d>;
    }>;

/**
 * Which world axes a body can't move along (`linear`) or turn around (`angular`).
 *
 * @category Internal
 */
export type MotionLocks3d = BodyState['motionLocks'];

/**
 * A rotation as a unit quaternion.
 *
 * @category Internal
 */
export type Quaternion = BodyState['rotation'];

const coordsShapeInit = {
    x: 0,
    y: 0,
    z: 0,
};

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
    tangentVelocity: optionalShape(coordsShapeInit, {
        alsoUndefined: true,
    }),
    userMaterialId: optionalShape(0, {
        alsoUndefined: true,
    }),
};

const physicsMaterialShapeInit = {
    density: optionalShape(0, {
        alsoUndefined: true,
    }),
    ...surfaceMaterialShapeInit,
};

const offsetShapeInit = {
    offset: optionalShape(coordsShapeInit, {
        alsoUndefined: true,
    }),
};

const rotationShapeInit = {
    rotation: optionalShape(
        {
            x: 0,
            y: 0,
            z: 0,
            w: 1,
        },
        {
            alsoUndefined: true,
        },
    ),
};

const sphereGeometryShape = defineShape({
    type: exactShape(ShapeType.Sphere),
    radius: 0,
});

const boxGeometryShape = defineShape({
    type: exactShape(ShapeType.Box),
    width: 0,
    height: 0,
    depth: 0,
    ...rotationShapeInit,
});

const capsuleGeometryShape = defineShape({
    type: exactShape(ShapeType.Capsule),
    radius: 0,
    height: 0,
    ...rotationShapeInit,
});

const hullGeometryShape = defineShape({
    type: exactShape(ShapeType.Hull),
    points: [
        coordsShapeInit,
    ],
    ...rotationShapeInit,
});

const meshGeometryShape = defineShape({
    type: exactShape(ShapeType.Mesh),
    vertices: [
        coordsShapeInit,
    ],
    triangles: [
        tupleShape(0, 0, 0),
    ],
    triangleMaterials: optionalShape(
        [
            surfaceMaterialShapeInit,
        ],
        {
            alsoUndefined: true,
        },
    ),
    weldTolerance: optionalShape(0, {
        alsoUndefined: true,
    }),
    useMedianSplit: optionalShape(false, {
        alsoUndefined: true,
    }),
    ...rotationShapeInit,
});

const shapeSettingsShapeInit = {
    material: optionalShape(physicsMaterialShapeInit, {
        alsoUndefined: true,
    }),
    collisionGroup: optionalShape(0, {
        alsoUndefined: true,
    }),
    explosionScale: optionalShape(0, {
        alsoUndefined: true,
    }),
    enableCustomFiltering: optionalShape(false, {
        alsoUndefined: true,
    }),
    enablePreSolve: optionalShape(false, {
        alsoUndefined: true,
    }),
};

const sensorShapeSettingsShape = defineShape({
    ...shapeSettingsShapeInit,
    ...offsetShapeInit,
    isSensor: optionalShape(false, {
        alsoUndefined: true,
    }),
});

const oneWayShapeSettingsShape = defineShape({
    oneWayDirection: optionalShape(coordsShapeInit, {
        alsoUndefined: true,
    }),
});

const compoundChildSettingsShape = defineShape({
    ...offsetShapeInit,
    material: optionalShape(surfaceMaterialShapeInit, {
        alsoUndefined: true,
    }),
});

/**
 * Shape definition for {@link PhysicsShapeDefinition}.
 *
 * @category Internal
 */
export const physicsShapeDefinitionShape = unionShape(
    intersectShape(sphereGeometryShape, sensorShapeSettingsShape, oneWayShapeSettingsShape),
    intersectShape(boxGeometryShape, sensorShapeSettingsShape, oneWayShapeSettingsShape),
    intersectShape(capsuleGeometryShape, sensorShapeSettingsShape, oneWayShapeSettingsShape),
    intersectShape(hullGeometryShape, sensorShapeSettingsShape, oneWayShapeSettingsShape),
    intersectShape(meshGeometryShape, sensorShapeSettingsShape),
    intersectShape(
        defineShape({
            type: exactShape(ShapeType.HeightField),
            heights: [
                [
                    0,
                ],
            ],
            scale: coordsShapeInit,
            cellMaterials: optionalShape(
                [
                    [
                        surfaceMaterialShapeInit,
                    ],
                ],
                {
                    alsoUndefined: true,
                },
            ),
            holes: optionalShape(
                [
                    {
                        row: 0,
                        column: 0,
                    },
                ],
                {
                    alsoUndefined: true,
                },
            ),
            heightRange: optionalShape(
                {
                    minimum: 0,
                    maximum: 0,
                },
                {
                    alsoUndefined: true,
                },
            ),
            isUpsideDown: optionalShape(false, {
                alsoUndefined: true,
            }),
            isSensor: optionalShape(false, {
                alsoUndefined: true,
            }),
        }),
        defineShape(shapeSettingsShapeInit),
    ),
    intersectShape(
        defineShape({
            type: exactShape(ShapeType.Compound),
            children: [
                unionShape(
                    intersectShape(sphereGeometryShape, compoundChildSettingsShape),
                    intersectShape(boxGeometryShape, compoundChildSettingsShape),
                    intersectShape(capsuleGeometryShape, compoundChildSettingsShape),
                    intersectShape(hullGeometryShape, compoundChildSettingsShape),
                    intersectShape(meshGeometryShape, compoundChildSettingsShape),
                ),
            ],
        }),
        defineShape(shapeSettingsShapeInit),
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
    type: enumShape(BodyType, BodyType.Static),
    gravityScale: 1,
    linearDamping: 0,
    angularDamping: 0,
    /** Meters per second. */
    sleepThreshold: 0,
    isSleepDisabled: false,
    enableHitEvents: false,
    isDisabled: false,
    isBullet: false,
    motionLocks: {
        linearX: false,
        linearY: false,
        linearZ: false,
        angularX: false,
        angularY: false,
        angularZ: false,
    },
    /**
     * Material values from {@link EntityPhysics3d.setMaterial}, used on every shape in place of the
     * values in the shape definitions.
     */
    material: physicsMaterialShapeInit,
    /** Shapes from {@link EntityPhysics3d.setShapes}, used in place of the physics definition's. */
    shapes: optionalShape(
        [
            physicsShapeDefinitionShape,
        ],
        {
            alsoUndefined: true,
        },
    ),
    /** From {@link EntityPhysics3d.setMassData}, used in place of the mass from the shapes. */
    massData: optionalShape(
        {
            mass: 0,
            /** In body space. */
            center: coordsShapeInit,
            /**
             * The inertia tensor around `center`, one column per axis. A shape lined up with the
             * body's axes only has values in `x.x`, `y.y`, and `z.z`.
             */
            rotationalInertia: {
                x: coordsShapeInit,
                y: coordsShapeInit,
                z: coordsShapeInit,
            },
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
export type InitialBodyState = PartialWithUndefined<BodyState>;

/**
 * A body's mass, where its center of mass is, and how hard it is to spin around each axis.
 *
 * @category Internal
 */
export type MassData3d = NonNullable<BodyState['massData']>;

/**
 * A position and rotation.
 *
 * @category Internal
 */
export type Transform3d = {
    position: Coords3d;
    rotation: Quaternion;
};

/**
 * A body's or joint's id in Box3D, which is 8 bytes and so is split across two numbers.
 *
 * @category Internal
 */
export type Box3dId = {
    index: number;
    tag: number;
};

/** The values of Box3D's `b3BodyType` enum. */
const box3dBodyTypes: Record<BodyType, number> = {
    [BodyType.Static]: 0,
    [BodyType.Kinematic]: 1,
    [BodyType.Dynamic]: 2,
};

const subStepCount = 4;

/** The largest 32-bit float, which Box3D's default drawing bounds reach to. */
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
            z: -maxFloat32,
        },
        upper: {
            x: maxFloat32,
            y: maxFloat32,
            z: maxFloat32,
        },
    },
    /** Scales the length of drawn contact and friction forces. */
    forceScale: 1,
    /** Scales the size of drawn joints. */
    jointScale: 1,
    drawShapes: false,
    drawJoints: false,
    /** Draws joint details, such as limits and anchor frames. */
    drawJointExtras: false,
    /** Draws each shape's bounding box. */
    drawBounds: false,
    /** Draws each dynamic body's center of mass. */
    drawMass: false,
    drawBodyNames: false,
    drawContacts: false,
    /** Colors contacts and joints by the solver batch (graph color) they are solved in. */
    drawGraphColors: false,
    /** Labels contact points with their feature ids. */
    drawContactFeatures: false,
    drawContactNormals: false,
    drawContactForces: false,
    drawFrictionForces: false,
    /** Draws the bounding box of each island of touching bodies. */
    drawIslands: false,
    /** Draws contact points on the first shape of each contact instead of the second. */
    drawAnchorA: false,
};

/**
 * What {@link PhysicsWorld3d.drawDebug} draws. Nothing is drawn unless enabled.
 *
 * @category Internal
 */
export type DebugDrawOptions3d = PartialWithUndefined<
    typeof debugDrawTemplate & {
        /** Only draws shapes in one of these collision categories. */
        mask: bigint;
    }
>;

/**
 * A shape as Box3D's debug drawing draws it, broken into spheres, capsules, and triangles. Points
 * are in the frame of the shape's body, so place them with `transform`.
 *
 * @category Internal
 */
export type DebugShape3d = {
    /**
     * The shape's entity id. In {@link PhysicsReplay3d.drawDebug}, its body's place in
     * {@link PhysicsReplay3d.getBodies} instead.
     */
    owner: number;
    transform: Transform3d;
    color: number;
    /** Box3D's `b3DebugMaterial`: how shiny to draw the shape. */
    material: number;
    spheres: {
        center: Coords3d;
        radius: number;
    }[];
    capsules: {
        start: Coords3d;
        end: Coords3d;
        radius: number;
    }[];
    /** Wound counterclockwise when seen from outside. */
    triangles: [
        Coords3d,
        Coords3d,
        Coords3d,
    ][];
};

/**
 * Everything Box3D's debug drawing drew, in world space. Colors are `0xRRGGBB`, and `alpha` is from
 * 0 (clear) to 1.
 *
 * @category Internal
 */
export type DebugDrawing3d = {
    shapes: DebugShape3d[];
    segments: {
        start: Coords3d;
        end: Coords3d;
        color: number;
    }[];
    /** Body and joint frames, drawn at a length of your choosing. */
    transforms: Transform3d[];
    points: {
        position: Coords3d;
        /** In pixels, not meters. */
        size: number;
        color: number;
    }[];
    spheres: {
        center: Coords3d;
        radius: number;
        color: number;
        alpha: number;
    }[];
    capsules: {
        start: Coords3d;
        end: Coords3d;
        radius: number;
        color: number;
        alpha: number;
    }[];
    bounds: {
        lower: Coords3d;
        upper: Coords3d;
        color: number;
    }[];
    /** Boxes reaching `extents` from their center along each axis of `transform`. */
    boxes: {
        extents: Coords3d;
        transform: Transform3d;
        color: number;
    }[];
    strings: {
        position: Coords3d;
        text: string;
        color: number;
    }[];
};

/** The values of the `DrawKind` enum in bindings.c. */
enum DrawKind {
    Shape,
    Segment,
    Transform,
    Point,
    Sphere,
    Capsule,
    Bounds,
    Box,
    String,
}

/** Reads numbers in order out of a drawing. */
type DrawingReader = {
    next(): number;
    nextCoords(): Coords3d;
    nextTransform(): Transform3d;
};

const drawingReaders: Record<
    DrawKind,
    (reader: Readonly<DrawingReader>, drawing: Readonly<DebugDrawing3d>) => void
> = {
    [DrawKind.Shape](reader, drawing) {
        drawing.shapes.push({
            owner: reader.next(),
            transform: reader.nextTransform(),
            color: reader.next(),
            material: reader.next(),
            spheres: createArray(reader.next(), () => {
                return {
                    center: reader.nextCoords(),
                    radius: reader.next(),
                };
            }),
            capsules: createArray(reader.next(), () => {
                return {
                    start: reader.nextCoords(),
                    end: reader.nextCoords(),
                    radius: reader.next(),
                };
            }),
            triangles: createArray(reader.next(), () => {
                return [
                    reader.nextCoords(),
                    reader.nextCoords(),
                    reader.nextCoords(),
                ];
            }),
        });
    },
    [DrawKind.Segment](reader, drawing) {
        drawing.segments.push({
            start: reader.nextCoords(),
            end: reader.nextCoords(),
            color: reader.next(),
        });
    },
    [DrawKind.Transform](reader, drawing) {
        drawing.transforms.push(reader.nextTransform());
    },
    [DrawKind.Point](reader, drawing) {
        drawing.points.push({
            position: reader.nextCoords(),
            size: reader.next(),
            color: reader.next(),
        });
    },
    [DrawKind.Sphere](reader, drawing) {
        drawing.spheres.push({
            center: reader.nextCoords(),
            radius: reader.next(),
            color: reader.next(),
            alpha: reader.next(),
        });
    },
    [DrawKind.Capsule](reader, drawing) {
        drawing.capsules.push({
            start: reader.nextCoords(),
            end: reader.nextCoords(),
            radius: reader.next(),
            color: reader.next(),
            alpha: reader.next(),
        });
    },
    [DrawKind.Bounds](reader, drawing) {
        drawing.bounds.push({
            lower: reader.nextCoords(),
            upper: reader.nextCoords(),
            color: reader.next(),
        });
    },
    [DrawKind.Box](reader, drawing) {
        drawing.boxes.push({
            extents: reader.nextCoords(),
            transform: reader.nextTransform(),
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
};

/** Writes the drawing options and returns the collision mask to draw. */
function writeDebugDrawOptions(
    box3d: Box3dModule,
    {mask, ...options}: Readonly<DebugDrawOptions3d>,
) {
    writeInput(box3d, {
        floats: flattenBindingValues(debugDrawTemplate, {
            ...debugDrawTemplate,
            ...filterObject(options, (key, value) => value != undefined),
        }),
    });
    return mask ?? allBits;
}

/** Reads the drawing a `drawWorld` or `drawReplay` binding call returned. */
function readDrawing(box3d: Box3dModule, pointer: number): DebugDrawing3d {
    const [
        start,
        count,
    ] = readWasmInt32s(box3d, pointer, 2);
    const values = box3d.HEAPF32.subarray(
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
                z: reader.next(),
            };
        },
        nextTransform() {
            return {
                position: reader.nextCoords(),
                rotation: {
                    x: reader.next(),
                    y: reader.next(),
                    z: reader.next(),
                    w: reader.next(),
                },
            };
        },
    };
    const drawing: DebugDrawing3d = {
        shapes: [],
        segments: [],
        transforms: [],
        points: [],
        spheres: [],
        capsules: [],
        bounds: [],
        boxes: [],
        strings: [],
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
export type PhysicsProfile3d = typeof profileTemplate;

/**
 * In the order of Box3D's `b3Counters`, up to its graph color counts.
 *
 * @category Internal
 */
export const countersTemplate = {
    bodyCount: 0,
    shapeCount: 0,
    contactCount: 0,
    jointCount: 0,
    islandCount: 0,
    /** Bytes of Box3D's step stack used by the last step. */
    stackUsed: 0,
    /** Bytes Box3D's step stack has room for. */
    arenaCapacity: 0,
    /** Height of the tree holding static shapes. */
    staticTreeHeight: 0,
    /** Height of the tallest tree holding moving shapes. */
    treeHeight: 0,
    /** Separating axis tests the last step ran between convex shapes. */
    satCallCount: 0,
    /** Separating axis tests the last step skipped by reusing the last step's result. */
    satCacheHitCount: 0,
    /** Memory Box3D has allocated. */
    byteCount: 0,
    taskCount: 0,
};

/**
 * In the order of Box3D's `b3Counters`, after its manifold counts.
 *
 * @category Internal
 */
export const laterCountersTemplate = {
    /** Contacts the last step checked for collision. */
    awakeContactCount: 0,
    /** Contacts the last step reused the points of. */
    recycledContactCount: 0,
    /** The most iterations one distance calculation took in the last step. */
    distanceIterations: 0,
    /** The most iterations one push back of a continuous collision took in the last step. */
    pushBackIterations: 0,
    /** The most iterations one time of impact root search took in the last step. */
    rootIterations: 0,
};

/**
 * The size of a world's simulation.
 *
 * @category Internal
 */
export type PhysicsCounters3d = typeof countersTemplate &
    typeof laterCountersTemplate & {
        /**
         * How many contacts and joints are in each solver batch (graph color), the last being
         * overflow.
         */
        colorCounts: number[];
        /** How many contacts have each number of manifolds, the last including any more. */
        manifoldCounts: number[];
    };

/** Box3D's `B3_GRAPH_COLOR_COUNT`. */
const graphColorCount = 24;
/** Box3D's `B3_CONTACT_MANIFOLD_COUNT_BUCKETS`. */
const manifoldCountBuckets = 8;

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
 * Which world query a recording saw. Values match Box3D's `b3RecQueryType`.
 *
 * @category Internal
 */
export enum ReplayQueryType3d {
    OverlapBounds,
    OverlapShape,
    CastRay,
    CastShape,
    CastRayClosest,
    CastMover,
    CollideMover,
}

/**
 * A world query made during one recorded frame, and what it found.
 *
 * @category Internal
 */
export type ReplayQuery3d = {
    type: ReplayQueryType3d;
    filter: CollisionFilter;
    /** In world space, and swept along the whole cast for casts. */
    bounds: {
        lower: Coords3d;
        upper: Coords3d;
    };
    origin: Coords3d;
    translation: Coords3d;
    hits: {
        /**
         * The hit body's place in the order the recording's bodies were created, matching
         * {@link PhysicsReplay3d.getBodies}. Undefined when the body no longer exists.
         */
        bodyIndex: number | undefined;
        point: Coords3d;
        normal: Coords3d;
        fraction: number;
    }[];
};

/** The int32 values `readReplayQuery` in bindings.c writes before each query's hits. */
const replayQueryLength = 18;
/** The int32 values `readReplayQuery` in bindings.c writes for each hit. */
const replayQueryHitLength = 8;

/**
 * Callbacks the world runs while stepping. See {@link PhysicsWorld3d.setHooks}.
 *
 * @category Internal
 */
export type WorldHooks3d = WorldHooks<Coords3d>;

/**
 * The Box3D WebAssembly module, plus the hooks its C bindings call back into.
 *
 * @category Internal
 */
export type LoadedBox3d = Box3dModule & {
    /** Read by bindings.c, keyed by world id. */
    anthaWorldHooks: Map<number, () => WorldHooks3d>;
};

const box3dModule = box3dFactory().then((box3d): LoadedBox3d => {
    return Object.assign(box3d, {
        anthaWorldHooks: new Map<number, () => WorldHooks3d>(),
    });
});

function readCoords3d(box3d: Box3dModule, pointer: number) {
    const [
        x,
        y,
        z,
    ] = readWasmFloat32s(box3d, pointer, 3);
    return {
        x,
        y,
        z,
    };
}

type InputSegment = PartialWithUndefined<{
    floats: ReadonlyArray<number>;
    integers: ReadonlyArray<number>;
}>;

/**
 * Writes array inputs where the next binding call reads them: each segment's floats then its
 * integers, one segment after another.
 */
function writeInput(box3d: Box3dModule, ...segments: ReadonlyArray<Readonly<InputSegment>>) {
    const valueCount = segments.reduce((count, segment) => {
        return count + (segment.floats?.length ?? 0) + (segment.integers?.length ?? 0);
    }, 0);
    const pointer = box3d._reserveInput(valueCount * 4);
    segments.reduce((start, segment) => {
        const floats = segment.floats ?? [];
        const integers = segment.integers ?? [];
        box3d.HEAPF32.set(floats, start);
        box3d.HEAP32.set(integers, start + floats.length);
        return start + floats.length + integers.length;
    }, pointer / 4);
}

/** Same as `b3RotateVector`. */
function rotateVector(rotation: Readonly<Quaternion>, vector: Readonly<Coords3d>) {
    const twiceCross = {
        x: 2 * (rotation.y * vector.z - rotation.z * vector.y),
        y: 2 * (rotation.z * vector.x - rotation.x * vector.z),
        z: 2 * (rotation.x * vector.y - rotation.y * vector.x),
    };
    return {
        x:
            vector.x +
            rotation.w * twiceCross.x +
            rotation.y * twiceCross.z -
            rotation.z * twiceCross.y,
        y:
            vector.y +
            rotation.w * twiceCross.y +
            rotation.z * twiceCross.x -
            rotation.x * twiceCross.z,
        z:
            vector.z +
            rotation.w * twiceCross.z +
            rotation.x * twiceCross.y -
            rotation.y * twiceCross.x,
    };
}

type ShapePlacement = Readonly<
    PartialWithUndefined<{
        offset: Readonly<Coords3d>;
        rotation: Readonly<Quaternion>;
    }>
>;

/** Moves a point from a shape's own frame into its body's frame. */
function placePoint({offset, rotation}: ShapePlacement, point: Readonly<Coords3d>) {
    const rotated = rotation ? rotateVector(rotation, point) : point;
    return {
        x: rotated.x + (offset?.x ?? 0),
        y: rotated.y + (offset?.y ?? 0),
        z: rotated.z + (offset?.z ?? 0),
    };
}

function flattenPoints(points: ReadonlyArray<Readonly<Coords3d>>, placement: ShapePlacement) {
    return points.flatMap((point) => {
        const placed = placePoint(placement, point);
        return [
            placed.x,
            placed.y,
            placed.z,
        ];
    });
}

/** A capsule's end centers in its body's frame. */
function placeCapsule(shape: Readonly<CapsuleGeometry> & ShapePlacement) {
    const halfSegment = shape.height / 2 - shape.radius;
    return [
        placePoint(shape, {
            x: 0,
            y: -halfSegment,
            z: 0,
        }),
        placePoint(shape, {
            x: 0,
            y: halfSegment,
            z: 0,
        }),
    ] as const;
}

/**
 * The 7 values `loadSurfaceMaterial` in `bindings.c` reads, taking each from the first material
 * that has it. NaN leaves it to the shape definition.
 */
function flattenSurfaceMaterial(materials: ReadonlyArray<Readonly<SurfaceMaterial> | undefined>) {
    const friction = materials.find((material) => material?.friction != undefined)?.friction;
    const restitution = materials.find(
        (material) => material?.restitution != undefined,
    )?.restitution;
    const rollingResistance = materials.find(
        (material) => material?.rollingResistance != undefined,
    )?.rollingResistance;
    const tangentVelocity = materials.find(
        (material) => material?.tangentVelocity != undefined,
    )?.tangentVelocity;
    const userMaterialId = materials.find(
        (material) => material?.userMaterialId != undefined,
    )?.userMaterialId;
    return [
        friction ?? Number.NaN,
        restitution ?? Number.NaN,
        rollingResistance ?? Number.NaN,
        tangentVelocity?.x ?? Number.NaN,
        tangentVelocity?.y ?? Number.NaN,
        tangentVelocity?.z ?? Number.NaN,
        userMaterialId ?? Number.NaN,
    ];
}

/**
 * Flattens per-triangle or per-cell materials into the distinct ones Box3D stores and each one's
 * index into them. `override` values replace theirs and `fallback` values fill in theirs.
 */
function indexSurfaceMaterials({
    materials,
    override,
    fallback,
}: Readonly<
    {
        materials: ReadonlyArray<Readonly<SurfaceMaterial>>;
    } & PartialWithUndefined<{
        override: Readonly<SurfaceMaterial>;
        fallback: Readonly<SurfaceMaterial>;
    }>
>) {
    const flattened = materials.map((material) => {
        return flattenSurfaceMaterial([
            override,
            material,
            fallback,
        ]);
    });
    const keys = flattened.map((values) => values.join(','));
    const distinctKeys = removeDuplicates(keys);
    return {
        materials: distinctKeys.flatMap((key) => {
            return assertWrap.isDefined(flattened[keys.indexOf(key)]);
        }),
        materialCount: distinctKeys.length,
        indexes: keys.map((key) => distinctKeys.indexOf(key)),
    };
}

/** How many distinct materials Box3D would store for these. */
function countSurfaceMaterials(materials: ReadonlyArray<Readonly<SurfaceMaterial>>) {
    return indexSurfaceMaterials({
        materials,
    }).materialCount;
}

const allBits = 2n ** 64n - 1n;

/** Box3D's `B3_MAX_SHAPE_CAST_POINTS`. */
const maxCastPointCount = 64;

function readHit(box3d: Box3dModule, pointer: number): CastHit3d | undefined {
    const [
        isHit,
        entityId,
    ] = readWasmInt32s(box3d, pointer, 2);
    if (!isHit) {
        return undefined;
    }
    const [
        pointX,
        pointY,
        pointZ,
        normalX,
        normalY,
        normalZ,
        fraction,
    ] = readWasmFloat32s(box3d, pointer + 2 * Int32Array.BYTES_PER_ELEMENT, 7);
    return {
        entityId,
        point: {
            x: pointX,
            y: pointY,
            z: pointZ,
        },
        normal: {
            x: normalX,
            y: normalY,
            z: normalZ,
        },
        fraction,
    };
}

/** The bit for each motion lock, as `loadMotionLocks` in `bindings.c` reads them. */
const motionLockBits: Record<keyof MotionLocks3d, number> = {
    linearX: 1,
    linearY: 2,
    linearZ: 4,
    angularX: 8,
    angularY: 16,
    angularZ: 32,
};

function writeMotionLocks(motionLocks: Readonly<Partial<MotionLocks3d>>) {
    return getObjectTypedKeys(motionLockBits).reduce((bits, lock) => {
        return motionLocks[lock] ? bits | motionLockBits[lock] : bits;
    }, 0);
}

function readBodyType(box3dType: number) {
    return assertWrap.isDefined(
        getObjectTypedKeys(box3dBodyTypes).find((bodyType) => {
            return box3dBodyTypes[bodyType] === box3dType;
        }),
    );
}

function readSettings(box3d: Box3dModule, bodyId: Readonly<Box3dId>) {
    const pointer = box3d._readSettings(bodyId.index, bodyId.tag);
    const [
        type,
        isEnabled,
        isBullet,
        isAwake,
        motionLocks,
    ] = readWasmInt32s(box3d, pointer, 5);
    const [
        gravityScale,
        linearDamping,
        angularDamping,
        sleepThreshold,
    ] = readWasmFloat32s(box3d, pointer + 5 * Int32Array.BYTES_PER_ELEMENT, 4);
    return {
        type: readBodyType(type),
        isDisabled: !isEnabled,
        isBullet: !!isBullet,
        isAwake: !!isAwake,
        /** `mapObjectValues` would type this as all `true` or all `false`. */
        motionLocks: mapObjectValues(motionLockBits, (lock, bit) => {
            return !!(motionLocks & bit);
        }) satisfies Record<keyof MotionLocks3d, boolean> as MotionLocks3d,
        gravityScale,
        linearDamping,
        angularDamping,
        sleepThreshold,
    };
}

function flattenCoords3d(coords: Readonly<Coords3d>) {
    return [
        coords.x,
        coords.y,
        coords.z,
    ];
}

/** Undefined goes back to the mass from the body's shapes. */
function writeMassData(
    box3d: Box3dModule,
    bodyId: Readonly<Box3dId>,
    massData: Readonly<MassData3d> | undefined,
) {
    writeInput(box3d, {
        floats: massData
            ? [
                  massData.mass,
                  ...flattenCoords3d(massData.center),
                  ...flattenCoords3d(massData.rotationalInertia.x),
                  ...flattenCoords3d(massData.rotationalInertia.y),
                  ...flattenCoords3d(massData.rotationalInertia.z),
              ]
            : [
                  Number.NaN,
              ],
    });
    box3d._setMassData(bodyId.index, bodyId.tag);
}

/** Reads `writeMassData` from `bindings.c`. */
function readMassData(box3d: Box3dModule, pointer: number): MassData3d {
    const [mass] = readWasmFloat32s(box3d, pointer, 1);
    const [
        center,
        columnX,
        columnY,
        columnZ,
    ] = createArray(4, (index) => {
        return readCoords3d(box3d, pointer + (1 + 3 * index) * Float32Array.BYTES_PER_ELEMENT);
    });
    return {
        mass,
        center: assertWrap.isDefined(center),
        rotationalInertia: {
            x: assertWrap.isDefined(columnX),
            y: assertWrap.isDefined(columnY),
            z: assertWrap.isDefined(columnZ),
        },
    };
}

function assertValidMassData({mass, rotationalInertia}: Readonly<MassData3d>) {
    const isInvalid = [
        mass,
        rotationalInertia.x.x,
        rotationalInertia.y.y,
        rotationalInertia.z.z,
    ].some((value) => {
        return Number.isNaN(value) || value < 0;
    });
    if (isInvalid) {
        throw new Error(
            `Mass and the rotational inertia's x.x, y.y, and z.z must be 0 or more, got ${mass}, ${rotationalInertia.x.x}, ${rotationalInertia.y.y}, and ${rotationalInertia.z.z}.`,
        );
    }
}

function readMotion(box3d: Box3dModule, bodyId: Readonly<Box3dId>) {
    const pointer = box3d._readBody(bodyId.index, bodyId.tag);
    const [
        x,
        y,
        z,
        rotationX,
        rotationY,
        rotationZ,
        rotationW,
        velocityX,
        velocityY,
        velocityZ,
        angularVelocityX,
        angularVelocityY,
        angularVelocityZ,
    ] = readWasmFloat32s(box3d, pointer, 13);
    return {
        position: {
            x,
            y,
            z,
        },
        rotation: {
            x: rotationX,
            y: rotationY,
            z: rotationZ,
            w: rotationW,
        },
        velocity: {
            x: velocityX,
            y: velocityY,
            z: velocityZ,
        },
        angularVelocity: {
            x: angularVelocityX,
            y: angularVelocityY,
            z: angularVelocityZ,
        },
    };
}

type ShapeCreatorParams<Shape extends PhysicsShapeDefinition> = {
    box3d: Box3dModule;
    bodyId: Readonly<Box3dId>;
    shape: Readonly<Shape>;
    materialOverride: Readonly<PhysicsMaterial>;
};

/** Box3D's `B3_HEIGHT_FIELD_HOLE`. */
const heightFieldHole = 255;

/** The most distinct triangle materials a mesh can have, since Box3D stores their indexes as bytes. */
const maxMeshMaterialCount = 256;

/** One less than {@link maxMeshMaterialCount}, since {@link heightFieldHole} is reserved. */
const maxHeightFieldMaterialCount = 255;

/** Box3D's `B3_MAX_COMPOUND_MESH_MATERIALS`. */
const maxCompoundMeshMaterialCount = 4;

/** Writes a mesh's geometry and materials as `createMesh` in `bindings.c` reads them. */
function flattenMesh({
    shape,
    materialOverride,
    fallbackMaterial,
}: Readonly<{
    shape: Readonly<MeshGeometry> & ShapePlacement;
    materialOverride: Readonly<SurfaceMaterial>;
    /** Used for every triangle when the mesh has no triangle materials. */
    fallbackMaterial: Readonly<SurfaceMaterial> | undefined;
}>) {
    const indexed = indexSurfaceMaterials({
        materials: shape.triangleMaterials ?? [
            {},
        ],
        override: materialOverride,
        fallback: fallbackMaterial,
    });
    return {
        ...indexed,
        vertices: flattenPoints(shape.vertices, shape),
        triangles: shape.triangles.flat(),
    };
}

const shapeCreators: {
    [Type in ShapeType]: (
        params: Readonly<ShapeCreatorParams<Extract<PhysicsShapeDefinition, {type: Type}>>>,
    ) => void;
} = {
    [ShapeType.Sphere]({box3d, bodyId, shape}) {
        const center = placePoint(shape, {
            x: 0,
            y: 0,
            z: 0,
        });
        box3d._addSphere(bodyId.index, bodyId.tag, center.x, center.y, center.z, shape.radius);
    },
    [ShapeType.Box]({box3d, bodyId, shape}) {
        const rotation = shape.rotation ?? bodyStateShape.default.rotation;
        box3d._addBox(
            bodyId.index,
            bodyId.tag,
            shape.offset?.x ?? 0,
            shape.offset?.y ?? 0,
            shape.offset?.z ?? 0,
            rotation.x,
            rotation.y,
            rotation.z,
            rotation.w,
            shape.width / 2,
            shape.height / 2,
            shape.depth / 2,
        );
    },
    [ShapeType.Capsule]({box3d, bodyId, shape}) {
        const [
            center1,
            center2,
        ] = placeCapsule(shape);
        box3d._addCapsule(
            bodyId.index,
            bodyId.tag,
            center1.x,
            center1.y,
            center1.z,
            center2.x,
            center2.y,
            center2.z,
            shape.radius,
        );
    },
    [ShapeType.Hull]({box3d, bodyId, shape}) {
        writeInput(box3d, {
            floats: flattenPoints(shape.points, shape),
        });
        if (!box3d._addHull(bodyId.index, bodyId.tag, shape.points.length)) {
            throw new Error('Hull points must not all lie on one plane.');
        }
    },
    [ShapeType.Mesh]({box3d, bodyId, shape, materialOverride}) {
        const mesh = flattenMesh({
            shape,
            materialOverride,
            fallbackMaterial: undefined,
        });
        const hasTriangleMaterials = !!shape.triangleMaterials;
        writeInput(
            box3d,
            {
                floats: mesh.vertices,
                integers: mesh.triangles,
            },
            hasTriangleMaterials
                ? {
                      floats: mesh.materials,
                      integers: mesh.indexes,
                  }
                : {},
        );
        box3d._addMesh(
            bodyId.index,
            bodyId.tag,
            shape.vertices.length,
            shape.triangles.length,
            hasTriangleMaterials ? mesh.materialCount : 0,
            shape.weldTolerance ?? Number.NaN,
            Number(!!shape.useMedianSplit),
        );
    },
    [ShapeType.HeightField]({box3d, bodyId, shape, materialOverride}) {
        const cells = shape.cellMaterials
            ? indexSurfaceMaterials({
                  materials: shape.cellMaterials.flat(),
                  override: materialOverride,
              })
            : undefined;
        const columnCount = assertWrap.isDefined(shape.heights[0]).length;
        const holeIndexes = (shape.holes ?? []).map((hole) => {
            return hole.row * (columnCount - 1) + hole.column;
        });
        const hasCellValues = !!cells || !!holeIndexes.length;
        writeInput(
            box3d,
            {
                floats: shape.heights.flat(),
            },
            hasCellValues
                ? {
                      floats: cells?.materials ?? [],
                      integers: createArray(
                          (columnCount - 1) * (shape.heights.length - 1),
                          (cellIndex) => {
                              return holeIndexes.includes(cellIndex)
                                  ? heightFieldHole
                                  : (cells?.indexes[cellIndex] ?? 0);
                          },
                      ),
                  }
                : {},
        );
        box3d._addHeightField(
            bodyId.index,
            bodyId.tag,
            columnCount,
            shape.heights.length,
            shape.scale.x,
            shape.scale.y,
            shape.scale.z,
            cells?.materialCount ?? 0,
            Number(!!holeIndexes.length),
            shape.heightRange?.minimum ?? Number.NaN,
            shape.heightRange?.maximum ?? Number.NaN,
            Number(!!shape.isUpsideDown),
        );
    },
    [ShapeType.Compound]({box3d, bodyId, shape, materialOverride}) {
        writeInput(
            box3d,
            ...shape.children.flatMap((child) => {
                return (
                    compoundChildWriters[
                        child.type
                    ] satisfies (typeof compoundChildWriters)[CompoundChildType] as (
                        params: Readonly<CompoundChildWriterParams<CompoundChildDefinition>>,
                    ) => InputSegment[]
                )({
                    child,
                    materialOverride,
                });
            }),
        );
        if (!box3d._addCompound(bodyId.index, bodyId.tag, shape.children.length)) {
            throw new Error('Compound hulls and meshes must be valid.');
        }
    },
};

type CompoundChildWriterParams<Child extends CompoundChildDefinition> = {
    child: Readonly<Child>;
    materialOverride: Readonly<SurfaceMaterial>;
};

/** The values of `CompoundChildKind` in `bindings.c`. */
const compoundChildKinds: Record<CompoundChildType, number> = {
    [ShapeType.Sphere]: 0,
    [ShapeType.Capsule]: 1,
    [ShapeType.Box]: 2,
    [ShapeType.Hull]: 3,
    [ShapeType.Mesh]: 4,
};

/** Writes each kind of compound child as `addCompound` in `bindings.c` reads it. */
const compoundChildWriters: {
    [Type in CompoundChildType]: (
        params: Readonly<CompoundChildWriterParams<Extract<CompoundChildDefinition, {type: Type}>>>,
    ) => InputSegment[];
} = {
    [ShapeType.Sphere]({child, materialOverride}) {
        const center = placePoint(child, {
            x: 0,
            y: 0,
            z: 0,
        });
        return [
            {
                floats: [
                    compoundChildKinds[child.type],
                    ...flattenSurfaceMaterial([
                        materialOverride,
                        child.material,
                    ]),
                    center.x,
                    center.y,
                    center.z,
                    child.radius,
                ],
            },
        ];
    },
    [ShapeType.Capsule]({child, materialOverride}) {
        const [
            center1,
            center2,
        ] = placeCapsule(child);
        return [
            {
                floats: [
                    compoundChildKinds[child.type],
                    ...flattenSurfaceMaterial([
                        materialOverride,
                        child.material,
                    ]),
                    center1.x,
                    center1.y,
                    center1.z,
                    center2.x,
                    center2.y,
                    center2.z,
                    child.radius,
                ],
            },
        ];
    },
    [ShapeType.Box]({child, materialOverride}) {
        const rotation = child.rotation ?? bodyStateShape.default.rotation;
        return [
            {
                floats: [
                    compoundChildKinds[child.type],
                    ...flattenSurfaceMaterial([
                        materialOverride,
                        child.material,
                    ]),
                    child.offset?.x ?? 0,
                    child.offset?.y ?? 0,
                    child.offset?.z ?? 0,
                    rotation.x,
                    rotation.y,
                    rotation.z,
                    rotation.w,
                    child.width / 2,
                    child.height / 2,
                    child.depth / 2,
                ],
            },
        ];
    },
    [ShapeType.Hull]({child, materialOverride}) {
        return [
            {
                floats: [
                    compoundChildKinds[child.type],
                    ...flattenSurfaceMaterial([
                        materialOverride,
                        child.material,
                    ]),
                    child.points.length,
                    ...flattenPoints(child.points, child),
                ],
            },
        ];
    },
    [ShapeType.Mesh]({child, materialOverride}) {
        const mesh = flattenMesh({
            shape: child,
            materialOverride,
            fallbackMaterial: child.material,
        });
        return [
            {
                floats: [
                    compoundChildKinds[child.type],
                    child.vertices.length,
                    child.triangles.length,
                    mesh.materialCount,
                    child.weldTolerance ?? Number.NaN,
                    Number(!!child.useMedianSplit),
                    ...mesh.materials,
                    ...mesh.vertices,
                ],
                integers: mesh.triangles,
            },
            mesh.materialCount > 1
                ? {
                      integers: mesh.indexes,
                  }
                : {},
        ];
    },
};

/**
 * Adds shapes to a body. Values in `materialOverride` replace the shapes' own material values.
 *
 * @throws Error if Box3D rejects a hull or compound. Call {@link assertValidShapes} first to catch
 *   the rest.
 */
function addShapes({
    box3d,
    bodyId,
    shapes,
    materialOverride,
    filter,
    entityId,
    enableHitEvents,
}: Readonly<{
    box3d: Box3dModule;
    bodyId: Readonly<Box3dId>;
    shapes: ReadonlyArray<Readonly<PhysicsShapeDefinition>>;
    materialOverride: Readonly<PhysicsMaterial>;
    filter: Readonly<CollisionFilter>;
    entityId: number;
    enableHitEvents: boolean;
}>) {
    shapes.forEach((shape) => {
        const tangentVelocity = materialOverride.tangentVelocity ?? shape.material?.tangentVelocity;
        box3d._setShapeDefinition(
            filter.category,
            filter.mask,
            shape.collisionGroup ?? 0,
            entityId,
            materialOverride.density ?? shape.material?.density ?? Number.NaN,
            materialOverride.friction ?? shape.material?.friction ?? Number.NaN,
            materialOverride.restitution ?? shape.material?.restitution ?? Number.NaN,
            materialOverride.rollingResistance ?? shape.material?.rollingResistance ?? Number.NaN,
            tangentVelocity?.x ?? Number.NaN,
            tangentVelocity?.y ?? Number.NaN,
            tangentVelocity?.z ?? Number.NaN,
            materialOverride.userMaterialId ?? shape.material?.userMaterialId ?? Number.NaN,
            shape.explosionScale ?? Number.NaN,
            Number(!!shape.isSensor),
            Number(enableHitEvents),
            Number(!!shape.enableCustomFiltering),
            Number(!!shape.enablePreSolve),
            shape.oneWayDirection?.x ?? Number.NaN,
            shape.oneWayDirection?.y ?? Number.NaN,
            shape.oneWayDirection?.z ?? Number.NaN,
        );
        createShape({
            box3d,
            bodyId,
            shape,
            materialOverride,
        });
    });
}

function createShape(params: Readonly<ShapeCreatorParams<PhysicsShapeDefinition>>) {
    (
        shapeCreators[params.shape.type] satisfies (typeof shapeCreators)[ShapeType] as (
            params: Readonly<ShapeCreatorParams<PhysicsShapeDefinition>>,
        ) => void
    )(params);
}

/**
 * Throws for a geometry Box3D would reject or crash on.
 *
 * @throws Error describing what is invalid.
 */
function assertValidGeometry(
    shape: Readonly<PhysicsShapeDefinition | CompoundChildDefinition>,
    maxMaterialCount: number,
) {
    assertValidUserMaterialId(shape.material ?? {});
    const sizes: Partial<Record<'radius' | 'width' | 'height' | 'depth', number>> =
        shape.type === ShapeType.Sphere ||
        shape.type === ShapeType.Box ||
        shape.type === ShapeType.Capsule
            ? shape
            : {};
    const invalidSizeKey = (
        [
            'radius',
            'width',
            'height',
            'depth',
        ] as const
    ).find((key) => {
        return key in sizes && !(Number.isFinite(sizes[key]) && Number(sizes[key]) > 0);
    });
    if (invalidSizeKey) {
        throw new Error(
            `A ${shape.type} shape's ${invalidSizeKey} must be a finite number above 0, got ${String(sizes[invalidSizeKey])}.`,
        );
    } else if (shape.type === ShapeType.Capsule && shape.height < shape.radius * 2) {
        throw new Error(
            `Capsule height (${shape.height}) must be at least twice its radius (${shape.radius}).`,
        );
    } else if (shape.type === ShapeType.Hull && shape.points.length < 4) {
        throw new Error(`A hull needs at least 4 points, got ${shape.points.length}.`);
    } else if (shape.type === ShapeType.Mesh) {
        const vertexCount = shape.vertices.length;
        if (vertexCount < 3 || !shape.triangles.length) {
            throw new Error('A mesh needs at least 3 vertices and 1 triangle.');
        }
        const invalidIndex = shape.triangles
            .flat()
            .find((index) => !Number.isInteger(index) || index < 0 || index >= vertexCount);
        if (invalidIndex != undefined) {
            throw new Error(
                `Mesh triangle index ${invalidIndex} is not a vertex index from 0 to ${vertexCount - 1}.`,
            );
        } else if (
            shape.triangleMaterials &&
            shape.triangleMaterials.length !== shape.triangles.length
        ) {
            throw new Error(
                `A mesh with ${shape.triangles.length} triangles needs ${shape.triangles.length} triangle materials, got ${shape.triangleMaterials.length}.`,
            );
        }
        shape.triangleMaterials?.forEach(assertValidUserMaterialId);
        const materialCount = countSurfaceMaterials(shape.triangleMaterials ?? []);
        if (materialCount > maxMaterialCount) {
            throw new Error(
                `This mesh can have at most ${maxMaterialCount} different triangle materials, got ${materialCount}.`,
            );
        }
    }
}

/** Box3D stores `userMaterialId` as 64 bits, but the bindings pass it as a float. */
const maxUserMaterialId = 2 ** 24;

function assertValidUserMaterialId(material: Readonly<Pick<SurfaceMaterial, 'userMaterialId'>>) {
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
 * Throws for shapes Box3D would reject or crash on, before any of them are created.
 *
 * @throws Error describing the first invalid shape.
 */
function assertValidShapes({
    shapes,
    bodyType,
    isRecording,
}: Readonly<{
    shapes: ReadonlyArray<Readonly<PhysicsShapeDefinition>>;
    bodyType: BodyType;
    isRecording: boolean;
}>) {
    shapes.forEach((shape) => {
        if (isRecording && (shape.oneWayDirection || shape.enablePreSolve)) {
            throw new Error(recordingPreSolveMessage);
        } else if (
            bodyType !== BodyType.Static &&
            (shape.type === ShapeType.Mesh ||
                shape.type === ShapeType.HeightField ||
                shape.type === ShapeType.Compound)
        ) {
            throw new Error(`A ${shape.type} shape is only allowed on a static body.`);
        }
        assertValidShape(shape);
    });
}

/** @throws Error describing what is invalid about the shape. */
function assertValidShape(shape: Readonly<PhysicsShapeDefinition>) {
    assertValidGeometry(shape, maxMeshMaterialCount);
    if (shape.type === ShapeType.HeightField) {
        assertValidHeightField(shape);
    } else if (shape.type === ShapeType.Compound) {
        if (!shape.children.length) {
            throw new Error('A compound needs at least 1 child.');
        }
        shape.children.forEach((child) => {
            assertValidGeometry(child, maxCompoundMeshMaterialCount);
        });
    }
}

/** @throws Error describing what is invalid about the height field. */
function assertValidHeightField(
    shape: Readonly<Extract<PhysicsShapeDefinition, {type: ShapeType.HeightField}>>,
) {
    const columnCount = shape.heights[0]?.length ?? 0;
    if (
        shape.heights.length < 2 ||
        columnCount < 2 ||
        shape.heights.some((row) => row.length !== columnCount)
    ) {
        throw new Error(
            'Height field heights must be at least 2 rows of the same length, each at least 2 long.',
        );
    } else if (shape.scale.x <= 0 || shape.scale.y <= 0 || shape.scale.z <= 0) {
        throw new Error('Every height field scale component must be positive.');
    } else if (
        shape.cellMaterials &&
        (shape.cellMaterials.length !== shape.heights.length - 1 ||
            shape.cellMaterials.some((row) => row.length !== columnCount - 1))
    ) {
        throw new Error(
            `Height field cell materials must be ${shape.heights.length - 1} rows of ${columnCount - 1}, one less than the heights each way.`,
        );
    } else if (shape.heightRange && shape.heightRange.minimum > shape.heightRange.maximum) {
        throw new Error(
            `Height field height range minimum (${shape.heightRange.minimum}) must not be above its maximum (${shape.heightRange.maximum}).`,
        );
    }
    shape.cellMaterials?.flat().forEach(assertValidUserMaterialId);
    const materialCount = countSurfaceMaterials(shape.cellMaterials?.flat() ?? []);
    if (materialCount > maxHeightFieldMaterialCount) {
        throw new Error(
            `A height field can have at most ${maxHeightFieldMaterialCount} different cell materials, got ${materialCount}.`,
        );
    }
    const invalidHole = shape.holes?.find((hole) => {
        return (
            !Number.isInteger(hole.row) ||
            !Number.isInteger(hole.column) ||
            hole.row < 0 ||
            hole.column < 0 ||
            hole.row >= shape.heights.length - 1 ||
            hole.column >= columnCount - 1
        );
    });
    if (invalidHole) {
        throw new Error(
            `Height field hole at row ${invalidHole.row}, column ${invalidHole.column} is not a cell.`,
        );
    }
}

/** Points in the cast shape's own frame, plus the radius that rounds them. */
const castShapeProxies: {
    [Type in CastShapeType]: (shape: Readonly<Extract<CastShapeDefinition, {type: Type}>>) => {
        points: Coords3d[];
        radius: number;
    };
} = {
    [ShapeType.Sphere](shape) {
        return {
            points: [
                {
                    x: 0,
                    y: 0,
                    z: 0,
                },
            ],
            radius: shape.radius,
        };
    },
    [ShapeType.Box](shape) {
        return {
            points: createArray(8, (corner) => {
                return {
                    x: (corner & 1 ? 1 : -1) * (shape.width / 2),
                    y: (corner & 2 ? 1 : -1) * (shape.height / 2),
                    z: (corner & 4 ? 1 : -1) * (shape.depth / 2),
                };
            }),
            radius: 0,
        };
    },
    [ShapeType.Capsule](shape) {
        const halfSegment = shape.height / 2 - shape.radius;
        return {
            points: [
                {
                    x: 0,
                    y: -halfSegment,
                    z: 0,
                },
                {
                    x: 0,
                    y: halfSegment,
                    z: 0,
                },
            ],
            radius: shape.radius,
        };
    },
    [ShapeType.Hull](shape) {
        return {
            points: [...shape.points],
            radius: 0,
        };
    },
};

function castShapeProxy(shape: Readonly<CastShapeDefinition>) {
    return (
        castShapeProxies[shape.type] satisfies (shape: any) => unknown as (
            shape: Readonly<CastShapeDefinition>,
        ) => ReturnType<(typeof castShapeProxies)[CastShapeType]>
    )(shape);
}

/** @throws Error if the shape has too many points for Box3D. */
function readCastShapeProxy(shape: Readonly<CastShapeDefinition>) {
    const proxy = castShapeProxy(shape);
    if (proxy.points.length > maxCastPointCount) {
        throw new Error(
            `A cast shape can have at most ${maxCastPointCount} points, got ${proxy.points.length}.`,
        );
    }
    return proxy;
}

/**
 * Writes a cast or overlap shape's points where the next binding call reads them.
 *
 * @returns The number of points written.
 * @throws Error if the shape has too many points for Box3D.
 */
function writeCastShape(box3d: Box3dModule, shape: Readonly<CastShapeDefinition>) {
    const {points} = readCastShapeProxy(shape);
    writeInput(box3d, {
        floats: flattenPoints(points, shape),
    });
    return points.length;
}

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

    protected readonly box3d: Box3dModule;
    /** The Box3D body this controls. */
    public readonly bodyId: Readonly<Box3dId>;
    /** See `material` in {@link BodyState}. */
    protected material: Readonly<PhysicsMaterial>;
    /** See `shapes` in {@link BodyState}. */
    protected shapes: ReadonlyArray<Readonly<PhysicsShapeDefinition>> | undefined;
    /** Shape settings that {@link EntityPhysics3d.setShapes} reuses for new shapes. */
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
    protected massData: Readonly<MassData3d> | undefined = undefined;

    constructor({
        box3d,
        bodyId,
        material,
        shapes,
        shapeSettings,
        enableHitEvents,
        isSleepDisabled,
    }: Readonly<
        Pick<EntityPhysics3d, 'bodyId'> & {
            box3d: Box3dModule;
            material: Readonly<PhysicsMaterial>;
            shapes: ReadonlyArray<Readonly<PhysicsShapeDefinition>> | undefined;
            shapeSettings: EntityPhysics3d['shapeSettings'];
            enableHitEvents: boolean;
            isSleepDisabled: boolean;
        }
    >) {
        this.box3d = box3d;
        this.bodyId = bodyId;
        this.material = material;
        this.shapes = shapes;
        this.shapeSettings = shapeSettings;
        this.enableHitEvents = enableHitEvents;
        this.isSleepDisabled = isSleepDisabled;
        this.currentTransform = this.readTransform();
        this.previousTransform = this.currentTransform;
    }

    /** Reads the body's current transform from Box3D. */
    protected readTransform(): Transform3d {
        const body = readMotion(this.box3d, this.bodyId);
        return {
            position: body.position,
            rotation: body.rotation,
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

    /** Sets the position and rotation together, since Box3D has no way to set only one. */
    protected setTransform({position, rotation}: Readonly<Transform3d>) {
        this.box3d._setTransform(
            this.bodyId.index,
            this.bodyId.tag,
            position.x,
            position.y,
            position.z,
            rotation.x,
            rotation.y,
            rotation.z,
            rotation.w,
        );
        this.snapTransform();
    }

    /** Meters. */
    public getPosition() {
        return readMotion(this.box3d, this.bodyId).position;
    }

    /** Teleports the body. Its view jumps straight there instead of sliding. */
    public setPosition(position: Readonly<Coords3d>) {
        this.setTransform({
            position,
            rotation: this.getRotation(),
        });
    }

    /** Box3D stores rotations in 32-bit floats, so this can differ slightly from the one last set. */
    public getRotation() {
        return readMotion(this.box3d, this.bodyId).rotation;
    }

    /** Turns the body instantly. Its view jumps straight there instead of turning. */
    public setRotation(rotation: Readonly<Quaternion>) {
        this.setTransform({
            position: this.getPosition(),
            rotation,
        });
    }

    /** Meters per second. */
    public getVelocity() {
        return readMotion(this.box3d, this.bodyId).velocity;
    }

    /** Meters per second. */
    public setVelocity(velocity: Readonly<Coords3d>) {
        this.box3d._setVelocity(
            this.bodyId.index,
            this.bodyId.tag,
            velocity.x,
            velocity.y,
            velocity.z,
        );
    }

    /** Radians per second around each axis. */
    public getAngularVelocity() {
        return readMotion(this.box3d, this.bodyId).angularVelocity;
    }

    /** Radians per second around each axis. */
    public setAngularVelocity(angularVelocity: Readonly<Coords3d>) {
        this.box3d._setAngularVelocity(
            this.bodyId.index,
            this.bodyId.tag,
            angularVelocity.x,
            angularVelocity.y,
            angularVelocity.z,
        );
    }

    /**
     * Pushes the body's center during the next step only. Box3D clears forces after each step, so
     * call this every step (from `update()`) for a constant push.
     */
    public applyForce(force: Readonly<Coords3d>) {
        this.box3d._applyForce(this.bodyId.index, this.bodyId.tag, force.x, force.y, force.z);
    }

    /** Changes the body's velocity immediately, by `impulse / mass`. */
    public applyImpulse(impulse: Readonly<Coords3d>) {
        this.box3d._applyImpulse(
            this.bodyId.index,
            this.bodyId.tag,
            impulse.x,
            impulse.y,
            impulse.z,
        );
    }

    /** Total mass in kilograms. Always 0 for static and kinematic bodies. */
    public getMass() {
        return this.box3d._getMass(this.bodyId.index, this.bodyId.tag);
    }

    /**
     * Same as {@link EntityPhysics3d.applyForce} but pushes at `point` (in world space) instead of
     * the center, so it also spins the body.
     */
    public applyForceAtPoint({
        force,
        point,
    }: Readonly<{
        force: Readonly<Coords3d>;
        point: Readonly<Coords3d>;
    }>) {
        this.box3d._applyForceAtPoint(
            this.bodyId.index,
            this.bodyId.tag,
            force.x,
            force.y,
            force.z,
            point.x,
            point.y,
            point.z,
        );
    }

    /**
     * Same as {@link EntityPhysics3d.applyImpulse} but pushes at `point` (in world space) instead of
     * the center, so it also spins the body.
     */
    public applyImpulseAtPoint({
        impulse,
        point,
    }: Readonly<{
        impulse: Readonly<Coords3d>;
        point: Readonly<Coords3d>;
    }>) {
        this.box3d._applyImpulseAtPoint(
            this.bodyId.index,
            this.bodyId.tag,
            impulse.x,
            impulse.y,
            impulse.z,
            point.x,
            point.y,
            point.z,
        );
    }

    /**
     * Twists the body around each world axis during the next step only, in newton-meters. Call this
     * every step for a constant twist.
     */
    public applyTorque(torque: Readonly<Coords3d>) {
        this.box3d._applyTorque(this.bodyId.index, this.bodyId.tag, torque.x, torque.y, torque.z);
    }

    /** Changes the body's angular velocity immediately, scaled by its rotational inertia. */
    public applyAngularImpulse(impulse: Readonly<Coords3d>) {
        this.box3d._applyAngularImpulse(
            this.bodyId.index,
            this.bodyId.tag,
            impulse.x,
            impulse.y,
            impulse.z,
        );
    }

    /** Converts a point relative to the body (its position and rotation) into world space. */
    public getWorldPoint(localPoint: Readonly<Coords3d>) {
        return readCoords3d(
            this.box3d,
            this.box3d._getWorldPoint(
                this.bodyId.index,
                this.bodyId.tag,
                localPoint.x,
                localPoint.y,
                localPoint.z,
            ),
        );
    }

    /** Converts a world space point into one relative to the body (its position and rotation). */
    public getLocalPoint(worldPoint: Readonly<Coords3d>) {
        return readCoords3d(
            this.box3d,
            this.box3d._getLocalPoint(
                this.bodyId.index,
                this.bodyId.tag,
                worldPoint.x,
                worldPoint.y,
                worldPoint.z,
            ),
        );
    }

    /** Rotates a direction from the body's frame into world space. Ignores the body's position. */
    public getWorldVector(localVector: Readonly<Coords3d>) {
        return readCoords3d(
            this.box3d,
            this.box3d._getWorldVector(
                this.bodyId.index,
                this.bodyId.tag,
                localVector.x,
                localVector.y,
                localVector.z,
            ),
        );
    }

    /** Rotates a world space direction into the body's frame. Ignores the body's position. */
    public getLocalVector(worldVector: Readonly<Coords3d>) {
        return readCoords3d(
            this.box3d,
            this.box3d._getLocalVector(
                this.bodyId.index,
                this.bodyId.tag,
                worldVector.x,
                worldVector.y,
                worldVector.z,
            ),
        );
    }

    /**
     * The velocity, in meters per second, of a world space point moving with the body, including
     * its spin.
     */
    public getPointVelocity(worldPoint: Readonly<Coords3d>) {
        return readCoords3d(
            this.box3d,
            this.box3d._getPointVelocity(
                this.bodyId.index,
                this.bodyId.tag,
                worldPoint.x,
                worldPoint.y,
                worldPoint.z,
            ),
        );
    }

    /**
     * Every shape this body touches or is about to touch, as of the last step. `normal` points away
     * from the other shape, toward this body. `separation` is the gap between them, negative while
     * they overlap.
     */
    public getContacts() {
        const pointer = this.box3d._readContacts(this.bodyId.index, this.bodyId.tag);
        const [count] = readWasmFloat32s(this.box3d, pointer, 1);
        const contactsPointer = pointer + Float32Array.BYTES_PER_ELEMENT;

        return createArray(count, (contactIndex) => {
            const [
                normalX,
                normalY,
                normalZ,
                separation,
                otherType,
            ] = readWasmFloat32s(
                this.box3d,
                contactsPointer + contactIndex * 5 * Float32Array.BYTES_PER_ELEMENT,
                5,
            );
            return {
                normal: {
                    x: normalX,
                    y: normalY,
                    z: normalZ,
                },
                separation,
                otherBodyType: readBodyType(otherType),
            };
        });
    }

    /** Static bodies never move, kinematic bodies move only by their velocity. */
    public getType() {
        return readSettings(this.box3d, this.bodyId).type;
    }

    /**
     * Changing a static body to dynamic gives it mass from its shapes, or from
     * {@link EntityPhysics3d.setMassData}.
     */
    public setType(type: BodyType) {
        this.box3d._setBodyType(this.bodyId.index, this.bodyId.tag, box3dBodyTypes[type]);
        this.reapplyMassData();
    }

    /** A disabled body stays where it is, touches nothing, and isn't found by queries. */
    public isEnabled() {
        return !readSettings(this.box3d, this.bodyId).isDisabled;
    }

    /** See {@link EntityPhysics3d.isEnabled}. */
    public setEnabled(isEnabled: boolean) {
        this.box3d._setEnabled(this.bodyId.index, this.bodyId.tag, Number(isEnabled));
    }

    /** See `isBullet` in {@link EntityPhysicsDefinition}. */
    public isBullet() {
        return readSettings(this.box3d, this.bodyId).isBullet;
    }

    /** See `isBullet` in {@link EntityPhysicsDefinition}. */
    public setBullet(isBullet: boolean) {
        this.box3d._setBullet(this.bodyId.index, this.bodyId.tag, Number(isBullet));
    }

    /**
     * A body that has stayed still for a while falls asleep and skips simulation until something
     * touches it or one of its methods moves it.
     */
    public isAwake() {
        return readSettings(this.box3d, this.bodyId).isAwake;
    }

    /** Putting a body to sleep also stops it. */
    public setAwake(isAwake: boolean) {
        this.box3d._setAwake(this.bodyId.index, this.bodyId.tag, Number(isAwake));
    }

    /** See `gravityScale` in {@link EntityPhysicsDefinition}. */
    public getGravityScale() {
        return readSettings(this.box3d, this.bodyId).gravityScale;
    }

    /** See `gravityScale` in {@link EntityPhysicsDefinition}. */
    public setGravityScale(gravityScale: number) {
        this.box3d._setGravityScale(this.bodyId.index, this.bodyId.tag, gravityScale);
    }

    /** See `motionLocks` in {@link EntityPhysicsDefinition}. */
    public getMotionLocks() {
        return readSettings(this.box3d, this.bodyId).motionLocks;
    }

    /** Locks left out are unlocked. */
    public setMotionLocks(motionLocks: Readonly<Partial<MotionLocks3d>>) {
        this.box3d._setMotionLocks(
            this.bodyId.index,
            this.bodyId.tag,
            writeMotionLocks(motionLocks),
        );
    }

    /**
     * Sets the velocity that brings a kinematic body to `position` and `rotation` by the end of a
     * step of `stepSeconds`, so that it pushes what it moves into instead of teleporting through
     * it. Leave out `rotation` to keep the current one.
     */
    public setTargetTransform({
        position,
        rotation,
        stepSeconds,
    }: Readonly<
        {
            position: Readonly<Coords3d>;
            stepSeconds: number;
        } & PartialWithUndefined<{
            rotation: Readonly<Quaternion>;
        }>
    >) {
        const targetRotation = rotation ?? this.getRotation();
        this.box3d._setTargetTransform(
            this.bodyId.index,
            this.bodyId.tag,
            position.x,
            position.y,
            position.z,
            targetRotation.x,
            targetRotation.y,
            targetRotation.z,
            targetRotation.w,
            stepSeconds,
        );
    }

    /** Material values from earlier {@link EntityPhysics3d.setMaterial} calls. */
    public getMaterial(): PhysicsMaterial {
        return {
            ...this.material,
        };
    }

    /**
     * Changes the material of every shape on the body, including every triangle, cell, and compound
     * child material. Values left out keep their current value, and changing `density` recomputes
     * the body's mass.
     */
    public setMaterial(material: Readonly<PhysicsMaterial>) {
        assertValidUserMaterialId(material);
        this.material = {
            ...this.material,
            ...filterObject(material, (key, value) => {
                return value != undefined;
            }),
        };
        const shapes = this.shapes ?? this.shapeSettings.definitionShapes;
        /** Box3D can't change a compound's materials after creating it. */
        if (shapes.some((shape) => shape.type === ShapeType.Compound)) {
            this.replaceShapes(shapes);
            this.addShapes(shapes);
            return;
        }
        this.box3d._setMaterial(
            this.bodyId.index,
            this.bodyId.tag,
            material.density ?? Number.NaN,
            material.friction ?? Number.NaN,
            material.restitution ?? Number.NaN,
            material.rollingResistance ?? Number.NaN,
            material.tangentVelocity?.x ?? Number.NaN,
            material.tangentVelocity?.y ?? Number.NaN,
            material.tangentVelocity?.z ?? Number.NaN,
            material.userMaterialId ?? Number.NaN,
        );
        if (material.density != undefined) {
            this.reapplyMassData();
        }
    }

    /** The body's shapes, from its physics definition until {@link EntityPhysics3d.setShapes}. */
    public getShapes(): PhysicsShapeDefinition[] {
        return structuredClone([...(this.shapes ?? this.shapeSettings.definitionShapes)]);
    }

    /**
     * Replaces every shape on the body and recomputes its mass. Materials from
     * {@link EntityPhysics3d.setMaterial} still apply to the new shapes.
     *
     * @throws Error if a shape is invalid, keeping the current shapes.
     */
    public setShapes(shapes: ReadonlyArray<Readonly<PhysicsShapeDefinition>>) {
        assertValidShapes({
            shapes,
            bodyType: this.getType(),
            isRecording: !!this.box3d._isRecordingBody(this.bodyId.index, this.bodyId.tag),
        });
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
        this.box3d._removeShapes(this.bodyId.index, this.bodyId.tag);
        this.updateSleepEnabled(shapes);
    }

    /** Lets the body sleep only when sleep is not disabled and it has shapes. */
    protected updateSleepEnabled(shapes: ReadonlyArray<Readonly<PhysicsShapeDefinition>>) {
        /** See the matching `createBody` argument. */
        this.box3d._setSleepEnabled(
            this.bodyId.index,
            this.bodyId.tag,
            Number(!this.isSleepDisabled && !!shapes.length),
        );
    }

    /** Box3D recomputes the mass after every shape, density, or type change. */
    protected reapplyMassData() {
        if (this.massData && this.getType() === BodyType.Dynamic) {
            writeMassData(this.box3d, this.bodyId, this.massData);
        }
    }

    /** Adds shapes with this body's material, filter, and hit events, then reapplies its mass data. */
    protected addShapes(shapes: ReadonlyArray<Readonly<PhysicsShapeDefinition>>) {
        addShapes({
            box3d: this.box3d,
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
        return readSettings(this.box3d, this.bodyId).linearDamping;
    }

    /** See `linearDamping` in {@link EntityPhysicsDefinition}. */
    public setLinearDamping(linearDamping: number) {
        this.box3d._setDamping(
            this.bodyId.index,
            this.bodyId.tag,
            linearDamping,
            this.getAngularDamping(),
        );
    }

    /** See `linearDamping` in {@link EntityPhysicsDefinition}. */
    public getAngularDamping() {
        return readSettings(this.box3d, this.bodyId).angularDamping;
    }

    /** See `linearDamping` in {@link EntityPhysicsDefinition}. */
    public setAngularDamping(angularDamping: number) {
        this.box3d._setDamping(
            this.bodyId.index,
            this.bodyId.tag,
            this.getLinearDamping(),
            angularDamping,
        );
    }

    /**
     * The speed in meters per second that the body must stay under before it can fall asleep.
     * Defaults to Box3D's 0.05.
     */
    public getSleepThreshold() {
        return readSettings(this.box3d, this.bodyId).sleepThreshold;
    }

    /** See {@link EntityPhysics3d.getSleepThreshold}. */
    public setSleepThreshold(sleepThreshold: number) {
        this.box3d._setSleepThreshold(this.bodyId.index, this.bodyId.tag, sleepThreshold);
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

    /** See {@link EntityPhysics3d.areHitEventsEnabled}. */
    public setHitEventsEnabled(isEnabled: boolean) {
        this.box3d._setHitEvents(this.bodyId.index, this.bodyId.tag, Number(isEnabled));
        this.enableHitEvents = isEnabled;
    }

    /** The mass data in use, whether from the body's shapes or {@link EntityPhysics3d.setMassData}. */
    public getMassData() {
        return readMassData(
            this.box3d,
            this.box3d._readMassData(this.bodyId.index, this.bodyId.tag),
        );
    }

    /**
     * Replaces the mass the body's shapes give it, until called with `undefined`. The replacement
     * survives shape, density, and type changes, but only applies while the body is dynamic.
     *
     * @throws Error if the mass or a diagonal inertia value is negative or NaN.
     */
    public setMassData(massData: Readonly<MassData3d> | undefined) {
        if (massData) {
            assertValidMassData(massData);
        }
        this.massData = massData && structuredClone(massData);
        if (!massData) {
            writeMassData(this.box3d, this.bodyId, undefined);
        }
        this.reapplyMassData();
    }

    /**
     * Same as {@link EntityPhysics3d.getPointVelocity} but takes a point in body space, so it
     * follows the body.
     */
    public getLocalPointVelocity(localPoint: Readonly<Coords3d>) {
        return readCoords3d(
            this.box3d,
            this.box3d._getLocalPointVelocity(
                this.bodyId.index,
                this.bodyId.tag,
                localPoint.x,
                localPoint.y,
                localPoint.z,
            ),
        );
    }

    /**
     * A world space box around every shape on the body. A body without shapes gets a box around its
     * position.
     */
    public getBounds() {
        const pointer = this.box3d._computeBounds(this.bodyId.index, this.bodyId.tag);
        return {
            lowerBound: readCoords3d(this.box3d, pointer),
            upperBound: readCoords3d(this.box3d, pointer + 3 * Float32Array.BYTES_PER_ELEMENT),
        };
    }

    /**
     * Pushes the body during the next step as if air were blowing at `wind` (meters per second),
     * harder on shapes that show the wind more area. `drag` is how much the body's own velocity
     * counts against the wind: 0 ignores it, and 1 means a body already moving with the wind feels
     * none. `lift` also pushes tilted shapes sideways to the wind. `maxSpeed` caps the relative
     * wind speed, which Box3D needs to stay stable. Only spheres, capsules, boxes, and hulls on a
     * dynamic body catch wind, so call this every step for steady wind.
     */
    public applyWind({
        wind,
        drag,
        lift,
        maxSpeed,
    }: Readonly<
        {
            wind: Readonly<Coords3d>;
            drag: number;
            maxSpeed: number;
        } & PartialWithUndefined<{
            /** @default 0 */
            lift: number;
        }>
    >) {
        this.box3d._applyWind(
            this.bodyId.index,
            this.bodyId.tag,
            wind.x,
            wind.y,
            wind.z,
            drag,
            lift ?? 0,
            maxSpeed,
        );
    }

    /**
     * Same as {@link PhysicsWorld3d.castRay} but only hits this body's shapes, whatever their
     * filter.
     */
    public castRay({
        origin,
        translation,
    }: Readonly<{
        origin: Readonly<Coords3d>;
        translation: Readonly<Coords3d>;
    }>) {
        return readHit(
            this.box3d,
            this.box3d._castBodyRay(
                this.bodyId.index,
                this.bodyId.tag,
                origin.x,
                origin.y,
                origin.z,
                translation.x,
                translation.y,
                translation.z,
            ),
        );
    }

    /**
     * The point on the body's spheres, capsules, boxes, and hulls closest to `target`, in world
     * space. A target inside one of them is its own closest point. Undefined for a body without any
     * of those shapes.
     */
    public getClosestPoint(target: Readonly<Coords3d>): Coords3d | undefined {
        const pointer = this.box3d._getClosestPoint(
            this.bodyId.index,
            this.bodyId.tag,
            target.x,
            target.y,
            target.z,
        );
        const [hasShapes] = readWasmFloat32s(this.box3d, pointer, 1);
        return hasShapes
            ? readCoords3d(this.box3d, pointer + Float32Array.BYTES_PER_ELEMENT)
            : undefined;
    }

    /** Every entity inside this body's sensor shapes as of the last step. Each entity appears once. */
    public getSensorOverlaps() {
        return readWasmOverlaps(
            this.box3d,
            this.box3d._readSensorOverlaps(this.bodyId.index, this.bodyId.tag),
        );
    }

    /** Reads everything about the body that changes as it moves or that its methods can change. */
    public getState(): BodyState {
        return {
            ...readMotion(this.box3d, this.bodyId),
            ...omitObjectKeys(readSettings(this.box3d, this.bodyId), ['isAwake']),
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
    /**
     * A spring that turns body B to keep its frame's z axis parallel to frame A's, such as to keep
     * a body upright.
     */
    Parallel = 'parallel',
    /** Keeps two points a set distance apart, optionally as a spring, like a rope or a strut. */
    Distance = 'distance',
    /** Only stops the two bodies from colliding with each other. */
    Filter = 'filter',
    /** Drives body B toward a target velocity and offset relative to body A. */
    Motor = 'motor',
    /** Lets body B slide along frame A's x axis without turning. */
    Prismatic = 'prismatic',
    /** Lets the bodies turn around their frames' shared z axis, like a hinge. */
    Revolute = 'revolute',
    /** Lets the bodies turn freely around a shared point, like a ball and socket. */
    Spherical = 'spherical',
    /** Holds the bodies together, optionally with some flex. */
    Weld = 'weld',
    /**
     * Body A is the chassis and body B the wheel, which spins around frame B's z axis and slides
     * along frame A's x axis on its suspension. It can also steer around frame A's x axis.
     */
    Wheel = 'wheel',
}

/** The values of Box3D's `b3JointType` enum. */
const box3dJointTypes: Record<JointType, number> = {
    [JointType.Parallel]: 0,
    [JointType.Distance]: 1,
    [JointType.Filter]: 2,
    [JointType.Motor]: 3,
    [JointType.Prismatic]: 4,
    [JointType.Revolute]: 5,
    [JointType.Spherical]: 6,
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
            z: 0,
        },
        rotation: {
            x: 0,
            y: 0,
            z: 0,
            w: 1,
        },
    },
    frameB: {
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
 * reorder them. Angles are in radians and lengths in meters.
 *
 * @category Internal
 */
export const jointTypeSettings = {
    [JointType.Parallel]: {
        hertz: 0,
        dampingRatio: 0,
        maxTorque: 0,
    },
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
            z: 0,
        },
        maxVelocityForce: 0,
        angularVelocity: {
            x: 0,
            y: 0,
            z: 0,
        },
        maxVelocityTorque: 0,
        linearHertz: 0,
        linearDampingRatio: 0,
        maxSpringForce: 0,
        angularHertz: 0,
        angularDampingRatio: 0,
        maxSpringTorque: 0,
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
    [JointType.Spherical]: {
        enableSpring: false,
        hertz: 0,
        dampingRatio: 0,
        /** The rotation of frame B relative to frame A that the spring turns toward. */
        targetRotation: {
            x: 0,
            y: 0,
            z: 0,
            w: 1,
        },
        /** Limits how far frame B's z axis can tilt away from frame A's. */
        enableConeLimit: false,
        coneAngle: 0,
        /** Limits how far frame B can turn around its own z axis. */
        enableTwistLimit: false,
        lowerTwistAngle: 0,
        upperTwistAngle: 0,
        enableMotor: false,
        maxMotorTorque: 0,
        /** Radians per second around each axis. */
        motorVelocity: {
            x: 0,
            y: 0,
            z: 0,
        },
    },
    [JointType.Weld]: {
        linearHertz: 0,
        angularHertz: 0,
        linearDampingRatio: 0,
        angularDampingRatio: 0,
    },
    [JointType.Wheel]: {
        enableSuspensionSpring: false,
        suspensionHertz: 0,
        suspensionDampingRatio: 0,
        enableSuspensionLimit: false,
        lowerSuspensionLimit: 0,
        upperSuspensionLimit: 0,
        enableSpinMotor: false,
        maxSpinTorque: 0,
        /** Radians per second. */
        spinSpeed: 0,
        /** Without steering, the wheel always faces forward. */
        enableSteering: false,
        steeringHertz: 0,
        steeringDampingRatio: 0,
        targetSteeringAngle: 0,
        maxSteeringTorque: 0,
        enableSteeringLimit: false,
        lowerSteeringLimit: 0,
        upperSteeringLimit: 0,
    },
} satisfies Record<JointType, object>;

/**
 * The settings of a joint, for {@link EntityJoint3d.update}. Leave a setting out for Box3D's
 * default.
 *
 * @category Internal
 */
export type JointSettings3d<Type extends JointType = JointType> = {
    [ThisType in Type]: PartialWithUndefined<
        typeof baseJointSettings & (typeof jointTypeSettings)[ThisType]
    >;
}[Type];

/**
 * How to connect two bodies with a joint. Leave a setting out for Box3D's default.
 *
 * @category Internal
 */
export type JointDefinition3d<Type extends JointType = JointType> = {
    [ThisType in Type]: {
        type: ThisType;
    } & JointSettings3d<ThisType>;
}[Type];

/**
 * Shape definition for {@link JointDefinition3d}.
 *
 * @category Internal
 */
export const jointDefinition3dShape = unionShape(
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
 * What {@link EntityJoint3d.read} reads for every joint type, in the order the bindings write it.
 *
 * @category Internal
 */
export const baseJointReading = {
    /** The force the joint applied to body B in the last step. */
    constraintForce: {
        x: 0,
        y: 0,
        z: 0,
    },
    constraintTorque: {
        x: 0,
        y: 0,
        z: 0,
    },
    /** How far apart the joint's frames have been pulled, in meters. */
    linearSeparation: 0,
    /** How far the joint's frames have been twisted apart, in radians. */
    angularSeparation: 0,
};

/**
 * What {@link EntityJoint3d.read} adds for each joint type, in the order the bindings write it.
 *
 * @category Internal
 */
export const jointTypeReadings = {
    [JointType.Parallel]: {},
    [JointType.Distance]: {
        length: 0,
        motorForce: 0,
    },
    [JointType.Filter]: {},
    [JointType.Motor]: {},
    [JointType.Prismatic]: {
        translation: 0,
        speed: 0,
        motorForce: 0,
    },
    [JointType.Revolute]: {
        angle: 0,
        motorTorque: 0,
    },
    [JointType.Spherical]: {
        coneAngle: 0,
        twistAngle: 0,
        motorTorque: {
            x: 0,
            y: 0,
            z: 0,
        },
    },
    [JointType.Weld]: {},
    [JointType.Wheel]: {
        spinSpeed: 0,
        spinTorque: 0,
        steeringAngle: 0,
        steeringTorque: 0,
    },
} satisfies Record<JointType, object>;

/**
 * What a joint is doing right now, from {@link EntityJoint3d.read}.
 *
 * @category Internal
 */
export type JointReading3d<Type extends JointType = JointType> = {
    [ThisType in Type]: typeof baseJointReading & (typeof jointTypeReadings)[ThisType];
}[Type];

/** Writes a joint definition where the next joint binding call reads it. */
function writeJointDefinition(
    box3d: Box3dModule,
    definition: Readonly<Pick<JointDefinition3d, 'type'>>,
) {
    writeInput(box3d, {
        floats: flattenBindingValues(
            {
                ...baseJointSettings,
                ...jointTypeSettings[definition.type],
            },
            definition,
        ),
    });
}

/**
 * A joint between two entities' bodies. Create one with {@link EntityStore.addJoint}.
 *
 * @category Internal
 */
export class EntityJoint3d<Type extends JointType = JointType>
    implements EntityJoint<JointDefinition3d<Type>>
{
    constructor(
        protected readonly box3d: Box3dModule,
        /** The id the entity store gave this joint. */
        public readonly jointId: number,
        /** The Box3D joint this controls. */
        public readonly box3dJointId: Readonly<Box3dId>,
        protected definition: JointDefinition3d<Type>,
    ) {}

    /** The joint's settings, including every {@link EntityJoint3d.update}. */
    public getDefinition(): JointDefinition3d<Type> {
        return structuredClone(this.definition);
    }

    /** Changes some of the joint's settings and wakes its bodies. */
    public update(settings: Readonly<JointSettings3d<Type>>) {
        this.definition = {
            ...this.definition,
            ...settings,
        };
        writeJointDefinition(this.box3d, this.definition);
        this.box3d._updateJoint(
            this.box3dJointId.index,
            this.box3dJointId.tag,
            box3dJointTypes[this.definition.type],
        );
    }

    /** Reads what the joint did in the last step. */
    public read() {
        const pointer = this.box3d._readJoint(
            this.box3dJointId.index,
            this.box3dJointId.tag,
            box3dJointTypes[this.definition.type],
        );
        return readBindingValues<JointReading3d>(
            {
                ...baseJointReading,
                ...jointTypeReadings[this.definition.type],
            },
            readWasmFloat32s(this.box3d, pointer, 13),
        ) satisfies JointReading3d as JointReading3d<Type>;
    }
}

/**
 * The world settings in the order the bindings read them, so don't reorder them.
 *
 * @category Internal
 */
export const worldSettingsTemplate = {
    /** Meters per second. Slower collisions don't bounce, so resting bodies can settle. */
    restitutionThreshold: 0,
    /** Cycles per second. Stiffer contacts push overlapping shapes apart faster but can jitter. */
    contactHertz: 0,
    /** Lower values push overlapping shapes apart more energetically. */
    contactDampingRatio: 0,
    /** Meters per second. The fastest that contacts push overlapping shapes apart. */
    contactSpeed: 0,
    /** Meters per second. No body moves faster. */
    maximumLinearSpeed: 0,
    /**
     * Meters. Touching shapes reuse their contact points until they move this far apart, and 0
     * recomputes the points every step.
     */
    contactRecycleDistance: 0,
    /** Keeps every body awake, overriding each body's own sleep setting. */
    isSleepDisabled: false,
    /** Lets fast bodies tunnel through static bodies for a minor speedup. */
    isContinuousDisabled: false,
    /** Makes stacks much less stable for no speedup. Box3D offers this for testing. */
    isWarmStartingDisabled: false,
};

/**
 * Settings for a whole {@link PhysicsWorld3d}, which keeps them through {@link PhysicsWorld3d.reset}.
 * Snapshots don't include them.
 *
 * @category Internal
 */
export type WorldSettings3d = typeof worldSettingsTemplate;

function assertValidWorldSettings(settings: Readonly<WorldSettings3d>) {
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
    }
}

/**
 * A Box3D world. Create one with {@link PhysicsWorld3d.create}.
 *
 * @category Internal
 */
export class PhysicsWorld3d
    implements
        PhysicsWorld<
            EntityPhysicsDefinition,
            EntityPhysics3d,
            InitialBodyState,
            Hit3d,
            JointDefinition3d,
            EntityJoint3d
        >
{
    /** Loads Box3D (shared by every world) and creates a world. */
    public static async create() {
        return new PhysicsWorld3d(await box3dModule);
    }

    /** Validates {@link BodyState} entries in snapshots. */
    public readonly bodyStateShape = bodyStateShape;
    /** Validates {@link JointDefinition3d} entries in snapshots. */
    public readonly jointDefinitionShape = jointDefinition3dShape;
    protected readonly box3d: LoadedBox3d;
    protected worldId: number | undefined;
    protected gravity: Coords3d = {
        x: 0,
        y: 0,
        z: 0,
    };
    protected hitEventThreshold = 1;
    protected settings: WorldSettings3d;
    protected hooks: WorldHooks3d = {};

    /** Use {@link PhysicsWorld3d.create} instead, which loads Box3D first. */
    protected constructor(box3d: LoadedBox3d) {
        this.box3d = box3d;
        this.settings = readBindingValues(
            worldSettingsTemplate,
            readWasmFloat32s(
                box3d,
                box3d._readDefaultWorldSettings(),
                flattenBindingValues(worldSettingsTemplate, undefined).length,
            ),
        );
        this.createWorld();
    }

    /** Creates the Box3D world. */
    protected createWorld() {
        const worldId = this.box3d._createWorld(this.gravity.x, this.gravity.y, this.gravity.z);
        this.worldId = worldId;
        this.box3d._setHitEventThreshold(worldId, this.hitEventThreshold);
        this.applySettings(worldId);
        this.box3d.anthaWorldHooks.set(worldId, () => {
            return this.hooks;
        });
        this.applyHooks(worldId);
    }

    /** Tells the bindings which of {@link hooks} are set, so they only call the ones that are. */
    protected applyHooks(worldId: number) {
        this.box3d._setHooks(
            worldId,
            Number(!!this.hooks.customFilter),
            Number(!!this.hooks.preSolve),
            Number(!!this.hooks.mixFriction),
            Number(!!this.hooks.mixRestitution),
        );
    }

    /** Destroys the native world and forgets its hooks. */
    protected destroyWorld(worldId: number) {
        this.box3d._destroyWorld(worldId);
        this.box3d.anthaWorldHooks.delete(worldId);
    }

    /** Writes {@link settings} into the native world. */
    protected applySettings(worldId: number) {
        writeInput(this.box3d, {
            floats: flattenBindingValues(worldSettingsTemplate, this.settings),
        });
        this.box3d._setWorldSettings(worldId);
    }

    /** @throws Error if the world was destroyed. */
    protected requireWorld() {
        if (this.worldId == undefined) {
            throw new Error('The physics world has been destroyed.');
        }
        return this.worldId;
    }

    /**
     * Sets the acceleration applied to every dynamic body, in meters per second squared. +y is up.
     *
     * @default {x: 0, y: 0, z: 0}
     */
    public setGravity(gravity: Readonly<Coords3d>) {
        const worldId = this.requireWorld();
        this.gravity = {
            ...gravity,
        };
        this.box3d._setGravity(worldId, gravity.x, gravity.y, gravity.z);
    }

    /** Meters per second squared. */
    public getGravity() {
        return {
            ...this.gravity,
        };
    }

    /**
     * Sets how fast, in meters per second, two shapes must close in on each other for their
     * collision to reach the `contactHit` entity hook.
     *
     * @default 1
     */
    public setHitEventThreshold(speed: number) {
        this.box3d._setHitEventThreshold(this.requireWorld(), speed);
        this.hitEventThreshold = speed;
    }

    /** Meters per second. */
    public getHitEventThreshold() {
        return this.hitEventThreshold;
    }

    /** Settings left out keep their current values. Every world starts with Box3D's defaults. */
    public setSettings(settings: Readonly<Partial<WorldSettings3d>>) {
        const worldId = this.requireWorld();
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
    public setHooks(hooks: Readonly<WorldHooks3d>) {
        const worldId = this.requireWorld();
        const merged = {
            ...this.hooks,
            ...hooks,
        };
        if (this.box3d._isRecording(worldId) && Object.values(merged).some(check.isFunction)) {
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
        this.destroyWorld(this.requireWorld());
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
        const worldId = this.requireWorld();
        const shapes = bodyState.shapes ?? definition?.shapes ?? [];
        const bodyType = bodyState.type || definition?.type || BodyType.Static;
        assertValidShapes({
            shapes,
            bodyType,
            isRecording: !!this.box3d._isRecording(worldId),
        });
        if (bodyState.massData) {
            assertValidMassData(bodyState.massData);
        }
        const position = bodyState.position ?? bodyStateShape.default.position;
        const rotation = bodyState.rotation ?? bodyStateShape.default.rotation;
        const velocity = bodyState.velocity ?? bodyStateShape.default.velocity;
        const angularVelocity = bodyState.angularVelocity ?? bodyStateShape.default.angularVelocity;
        const idPointer = this.box3d._createBody(
            worldId,
            box3dBodyTypes[bodyType],
            position.x,
            position.y,
            position.z,
            rotation.x,
            rotation.y,
            rotation.z,
            rotation.w,
            velocity.x,
            velocity.y,
            velocity.z,
            angularVelocity.x,
            angularVelocity.y,
            angularVelocity.z,
            bodyState.linearDamping ?? definition?.linearDamping ?? 0,
            bodyState.angularDamping ?? definition?.angularDamping ?? 0,
            bodyState.gravityScale ??
                definition?.gravityScale ??
                bodyStateShape.default.gravityScale,
            writeMotionLocks(bodyState.motionLocks ?? definition?.motionLocks ?? {}),
            Number(bodyState.isBullet ?? !!definition?.isBullet),
            Number(!(bodyState.isDisabled ?? definition?.isDisabled)),
            /**
             * Box3D judges whether a body is still by how fast its shapes move, so a body without
             * shapes always looks still. It soon falls asleep and loses its velocity.
             */
            Number(!bodyState.isSleepDisabled && !!shapes.length),
            bodyState.sleepThreshold ?? Number.NaN,
            entityId,
        );
        const [
            index,
            tag,
        ] = readWasmInt32s(this.box3d, idPointer, 2);
        const bodyId = {
            index,
            tag,
        };

        const enableHitEvents = bodyState.enableHitEvents ?? !!definition?.enableHitEvents;
        try {
            addShapes({
                box3d: this.box3d,
                bodyId,
                shapes,
                materialOverride: bodyState.material ?? {},
                filter,
                entityId,
                enableHitEvents,
            });
        } catch (error) {
            this.box3d._destroyBody(bodyId.index, bodyId.tag);
            throw error;
        }

        const physics = new EntityPhysics3d({
            box3d: this.box3d,
            bodyId,
            material: bodyState.material ?? {},
            shapes: bodyState.shapes,
            shapeSettings: {
                filter,
                entityId,
                definitionShapes: definition?.shapes ?? [],
            },
            enableHitEvents,
            isSleepDisabled: !!bodyState.isSleepDisabled,
        });
        if (bodyState.massData) {
            physics.setMassData(bodyState.massData);
        }
        return physics;
    }

    /** Does nothing if the body was already destroyed. */
    public destroyBody(physics: Readonly<EntityPhysics3d>) {
        this.requireWorld();
        this.box3d._destroyBody(physics.bodyId.index, physics.bodyId.tag);
    }

    /**
     * Usually called by {@link EntityStore.addJoint}. Box3D destroys the joint along with either of
     * its bodies.
     */
    public createJoint<const Definition extends JointDefinition3d>({
        bodies,
        definition,
        jointId,
    }: Readonly<{
        bodies: Readonly<
            [
                EntityPhysics3d,
                EntityPhysics3d,
            ]
        >;
        definition: Readonly<Definition>;
        /** Reported back in {@link ContactEvents.strainedJoints}. */
        jointId: number;
    }>) {
        const worldId = this.requireWorld();
        writeJointDefinition(this.box3d, definition);
        const idPointer = this.box3d._createJoint(
            worldId,
            box3dJointTypes[definition.type],
            bodies[0].bodyId.index,
            bodies[0].bodyId.tag,
            bodies[1].bodyId.index,
            bodies[1].bodyId.tag,
            jointId,
        );
        const [
            index,
            tag,
        ] = readWasmInt32s(this.box3d, idPointer, 2);
        return new EntityJoint3d(
            this.box3d,
            jointId,
            {
                index,
                tag,
            },
            structuredClone(definition) as JointDefinition3d<Definition['type']>,
        );
    }

    /** Does nothing if the joint was already destroyed. */
    public destroyJoint(joint: Readonly<EntityJoint3d>) {
        this.requireWorld();
        this.box3d._destroyJoint(joint.box3dJointId.index, joint.box3dJointId.tag);
    }

    /**
     * Usually called by {@link EntityStore.createSnapshot}. Box3D's own format for this is internal
     * (its replay uses it), so it can change in any new Box3D version.
     */
    public createPhysicsState({
        bodies,
        droppedBodies,
        joints,
    }: Readonly<{
        bodies: ReadonlyArray<Readonly<EntityPhysics3d>>;
        droppedBodies: ReadonlyArray<Readonly<EntityPhysics3d>>;
        joints: ReadonlyArray<Readonly<EntityJoint3d>>;
    }>) {
        const worldId = this.requireWorld();
        const ids = [
            ...[
                ...bodies,
                ...droppedBodies,
            ].map((body) => body.bodyId),
            ...joints.map((joint) => joint.box3dJointId),
        ].flatMap((id) => {
            return [
                id.index,
                id.tag,
            ];
        });
        const idsPointer = this.box3d._reserveInput(ids.length * Int32Array.BYTES_PER_ELEMENT);
        this.box3d.HEAP32.set(ids, idsPointer / Int32Array.BYTES_PER_ELEMENT);
        const pointer = this.box3d._createSnapshot(
            worldId,
            bodies.length,
            droppedBodies.length,
            joints.length,
        );
        const [
            ,
            size,
        ] = readWasmInt32s(this.box3d, pointer, 2);
        return this.box3d.HEAPU8.slice(pointer, pointer + size);
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
        this.requireWorld();
        const pointer = this.box3d._reserveInput(state.byteLength);
        this.box3d.HEAPU8.set(state, pointer);
        if (!this.box3d._isValidSnapshot(state.byteLength)) {
            throw new Error('Invalid physics state: it is not from createPhysicsState.');
        }
        const [
            ,
            ,
            savedBodyCount,
            ,
            savedJointCount,
        ] = readWasmInt32s(this.box3d, pointer, 5);
        if (savedBodyCount !== bodyCount || savedJointCount !== jointCount) {
            throw new Error(
                `Invalid physics state: it has ${savedBodyCount} bodies and ${savedJointCount} joints, not ${bodyCount} and ${jointCount}.`,
            );
        }
    }

    /**
     * Usually called by {@link EntityStore.loadSnapshot}, after resetting the world.
     *
     * @throws Error if Box3D can't read the state or the world is recording, which leaves the world
     *   unchanged.
     */
    public restorePhysicsState({
        state,
        bodies,
        joints,
    }: Readonly<{
        state: Uint8Array;
        bodies: ReadonlyArray<EntityPhysics3d>;
        joints: ReadonlyArray<EntityJoint3d>;
    }>) {
        const worldId = this.requireWorld();
        if (this.box3d._isRecording(worldId)) {
            throw new Error('Box3D cannot restore a physics state while the world is recording.');
        }
        /** The C side reads these as int32 values, so they must start 4-byte aligned. */
        const idsOffset = Math.ceil(state.byteLength / Int32Array.BYTES_PER_ELEMENT) * 4;
        const pointer = this.box3d._reserveInput(
            idsOffset + (bodies.length + joints.length) * Int32Array.BYTES_PER_ELEMENT,
        );
        this.box3d.HEAPU8.set(state, pointer);
        this.box3d.HEAP32.set(
            [
                ...bodies.map((body) => body.shapeSettings.entityId),
                ...joints.map((joint) => joint.jointId),
            ],
            (pointer + idsOffset) / Int32Array.BYTES_PER_ELEMENT,
        );
        const restoredPointer = this.box3d._restoreSnapshot(worldId, state.byteLength);
        if (!restoredPointer) {
            throw new Error('Box3D could not restore the physics state.');
        }
        const restoredIds = readWasmInt32s(
            this.box3d,
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
            makeWritable(joint).box3dJointId = {
                index: assertWrap.isDefined(restoredIds[2 * (bodies.length + index)]),
                tag: assertWrap.isDefined(restoredIds[2 * (bodies.length + index) + 1]),
            };
        });
        this.box3d._setGravity(worldId, this.gravity.x, this.gravity.y, this.gravity.z);
        this.box3d._setHitEventThreshold(worldId, this.hitEventThreshold);
        this.applySettings(worldId);
    }

    /** Advances the world by one step and returns the contact events it produced. */
    public step(stepSeconds: number) {
        const pointer = this.box3d._step(this.requireWorld(), stepSeconds, subStepCount);
        const counts = readWasmInt32s(this.box3d, pointer, 6);
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
                this.box3d,
                pairsPointer + index * 2 * Int32Array.BYTES_PER_ELEMENT,
                2,
            );
        });
        const hitsPointer = pairsPointer + pairCount * 2 * Int32Array.BYTES_PER_ELEMENT;
        const hits = createArray(hitCount, (index) => {
            const hitPointer = hitsPointer + index * 9 * Int32Array.BYTES_PER_ELEMENT;
            const [
                firstId,
                secondId,
            ] = readWasmInt32s(this.box3d, hitPointer, 2);
            const [
                pointX,
                pointY,
                pointZ,
                normalX,
                normalY,
                normalZ,
                approachSpeed,
            ] = readWasmFloat32s(this.box3d, hitPointer + 2 * Int32Array.BYTES_PER_ELEMENT, 7);
            const point = {
                x: pointX,
                y: pointY,
                z: pointZ,
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
                            z: -normalZ,
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
                            z: normalZ,
                        },
                        approachSpeed,
                    },
                },
            ] satisfies EntityHit<Hit3d>[];
        }).flat();
        const sensorStart = startedCount + endedCount;

        return {
            started: pairs.slice(0, startedCount),
            ended: pairs.slice(startedCount, sensorStart),
            sensorStarted: pairs.slice(sensorStart, sensorStart + sensorStartedCount),
            sensorEnded: pairs.slice(sensorStart + sensorStartedCount),
            hits,
            strainedJoints: readWasmInt32s(
                this.box3d,
                hitsPointer + hitCount * 9 * Int32Array.BYTES_PER_ELEMENT,
                strainedJointCount,
            ),
        };
    }

    /** Draws the world's current state, as Box3D's debug drawing would draw it. */
    public drawDebug(options: Readonly<DebugDrawOptions3d>) {
        const worldId = this.requireWorld();
        const mask = writeDebugDrawOptions(this.box3d, options);
        return readDrawing(this.box3d, this.box3d._drawWorld(worldId, mask));
    }

    /** Bodies that are not sleeping, which are the ones each step simulates. */
    public getAwakeBodyCount() {
        return this.box3d._getAwakeBodyCount(this.requireWorld());
    }

    /** How long each part of the last step took, in milliseconds. */
    public getProfile() {
        return readBindingValues(
            profileTemplate,
            readWasmFloat32s(
                this.box3d,
                this.box3d._readProfile(this.requireWorld()),
                getObjectTypedKeys(profileTemplate).length,
            ),
        );
    }

    /** Counts of the world's internal objects and memory, mostly for debugging performance. */
    public getCounters(): PhysicsCounters3d {
        const counterCount = getObjectTypedKeys(countersTemplate).length;
        const manifoldStart = counterCount + graphColorCount;
        const laterStart = manifoldStart + manifoldCountBuckets;
        const numbers = readWasmInt32s(
            this.box3d,
            this.box3d._readCounters(this.requireWorld()),
            laterStart + getObjectTypedKeys(laterCountersTemplate).length,
        );
        return {
            ...readBindingValues(countersTemplate, numbers),
            ...readBindingValues(laterCountersTemplate, numbers.slice(laterStart)),
            colorCounts: numbers.slice(counterCount, manifoldStart),
            manifoldCounts: numbers.slice(manifoldStart, laterStart),
        };
    }

    /**
     * Starts recording every step and change to the world, for {@link PhysicsReplay3d}. Box3D can't
     * record callbacks, so while recording, the world can't have hooks or shapes that use
     * `oneWayDirection` or `enablePreSolve`. Resetting the world, such as by loading a snapshot,
     * discards the recording.
     *
     * @throws Error if the world is already recording or uses hooks or those shapes.
     */
    public startRecording() {
        const errorMessages: Record<RecordingStart, string | undefined> = {
            [RecordingStart.Started]: undefined,
            [RecordingStart.AlreadyRecording]: 'The physics world is already recording.',
            [RecordingStart.HasHooks]: recordingHooksMessage,
            [RecordingStart.HasPreSolveShapes]: recordingPreSolveMessage,
        };
        const errorMessage =
            errorMessages[
                assertWrap.isEnumValue(
                    this.box3d._startRecording(this.requireWorld()),
                    RecordingStart,
                )
            ];
        if (errorMessage) {
            throw new Error(errorMessage);
        }
    }

    /** Whether the world is recording its steps, see {@link startRecording}. */
    public isRecording() {
        return !!this.box3d._isRecording(this.requireWorld());
    }

    /**
     * Stops recording and returns the recording, for {@link PhysicsReplay3d.create}.
     *
     * @throws Error if the world isn't recording.
     */
    public stopRecording() {
        const pointer = this.box3d._stopRecording(this.requireWorld());
        if (!pointer) {
            throw new Error('The physics world is not recording.');
        }
        const [size] = readWasmInt32s(this.box3d, pointer, 1);
        const start = pointer + Int32Array.BYTES_PER_ELEMENT;
        return this.box3d.HEAPU8.slice(start, start + size);
    }

    /**
     * Finds the closest shape a line from `origin` to `origin + translation` crosses, in meters.
     * Misses shapes the line starts inside of.
     */
    public castRay({
        origin,
        translation,
        filter,
    }: Readonly<
        {
            origin: Readonly<Coords3d>;
            translation: Readonly<Coords3d>;
        } & CastFilter
    >) {
        const pointer = this.box3d._castRay(
            this.requireWorld(),
            origin.x,
            origin.y,
            origin.z,
            translation.x,
            translation.y,
            translation.z,
            filter?.category ?? allBits,
            filter?.mask ?? allBits,
        );
        return readHit(this.box3d, pointer);
    }

    /**
     * Sweeps `shape` from `position` to `position + translation`, in meters, and finds the closest
     * shape it hits. `fraction` is how far it got before touching.
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
            position: Readonly<Coords3d>;
            translation: Readonly<Coords3d>;
        } & PartialWithUndefined<{
            /** @default no rotation */
            rotation: Readonly<Quaternion>;
        }> &
            CastFilter
    >) {
        const quaternion = rotation ?? bodyStateShape.default.rotation;
        const pointer = this.box3d._castShape(
            this.requireWorld(),
            writeCastShape(this.box3d, shape),
            castShapeProxy(shape).radius,
            position.x,
            position.y,
            position.z,
            quaternion.x,
            quaternion.y,
            quaternion.z,
            quaternion.w,
            translation.x,
            translation.y,
            translation.z,
            filter?.category ?? allBits,
            filter?.mask ?? allBits,
        );
        return readHit(this.box3d, pointer);
    }

    /**
     * Finds every entity with a shape whose bounding box overlaps the box from `lowerBound` to
     * `upperBound`, in meters, including sensor shapes. Each entity appears once.
     */
    public overlapBox({
        lowerBound,
        upperBound,
        filter,
    }: Readonly<
        {
            lowerBound: Readonly<Coords3d>;
            upperBound: Readonly<Coords3d>;
        } & CastFilter
    >) {
        const pointer = this.box3d._overlapAabb(
            this.requireWorld(),
            lowerBound.x,
            lowerBound.y,
            lowerBound.z,
            upperBound.x,
            upperBound.y,
            upperBound.z,
            filter?.category ?? allBits,
            filter?.mask ?? allBits,
        );
        return readWasmOverlaps(this.box3d, pointer);
    }

    /**
     * Finds every entity with a shape that overlaps `shape` placed at `position`, in meters,
     * including sensor shapes. Each entity appears once.
     */
    public overlapShape({
        shape,
        position,
        rotation,
        filter,
    }: Readonly<
        {
            shape: Readonly<CastShapeDefinition>;
            position: Readonly<Coords3d>;
        } & PartialWithUndefined<{
            /** @default no rotation */
            rotation: Readonly<Quaternion>;
        }> &
            CastFilter
    >) {
        const quaternion = rotation ?? bodyStateShape.default.rotation;
        const pointer = this.box3d._overlapShape(
            this.requireWorld(),
            writeCastShape(this.box3d, shape),
            castShapeProxy(shape).radius,
            position.x,
            position.y,
            position.z,
            quaternion.x,
            quaternion.y,
            quaternion.z,
            quaternion.w,
            filter?.category ?? allBits,
            filter?.mask ?? allBits,
        );
        return readWasmOverlaps(this.box3d, pointer);
    }

    /**
     * Pushes every dynamic body near `position` away from it (or toward it, with a negative
     * `impulsePerArea`). Each body's push grows with how much of its surface faces the explosion.
     */
    public explode({
        position,
        radius,
        falloff,
        impulsePerArea,
        mask,
    }: Readonly<
        {
            position: Readonly<Coords3d>;
            /** Bodies within this many meters get the full push. */
            radius: number;
            /** Newton-seconds of push per square meter of surface facing the explosion. */
            impulsePerArea: number;
        } & PartialWithUndefined<{
            /**
             * How many meters past `radius` the push fades out to nothing.
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
        this.box3d._explode(
            this.requireWorld(),
            position.x,
            position.y,
            position.z,
            radius,
            falloff ?? 0,
            impulsePerArea,
            mask ?? allBits,
        );
    }

    /**
     * Sweeps a character mover's `capsule` from `position` along `translation`, in meters, sliding
     * past surfaces it grazes, and returns how far it got before hitting something, from 0 to 1.
     */
    public castMover({
        capsule,
        position,
        translation,
        filter,
    }: Readonly<
        {
            capsule: Readonly<MoverCapsule3d>;
            position: Readonly<Coords3d>;
            translation: Readonly<Coords3d>;
        } & CastFilter
    >) {
        return this.box3d._castMover(
            this.requireWorld(),
            position.x,
            position.y,
            position.z,
            capsule.center1.x,
            capsule.center1.y,
            capsule.center1.z,
            capsule.center2.x,
            capsule.center2.y,
            capsule.center2.z,
            capsule.radius,
            translation.x,
            translation.y,
            translation.z,
            filter?.category ?? allBits,
            filter?.mask ?? allBits,
        );
    }

    /**
     * Finds the surfaces a character mover's `capsule` at `position` touches, to pass to
     * {@link PhysicsWorld3d.solveMoverPlanes}.
     */
    public collideMover({
        capsule,
        position,
        filter,
    }: Readonly<
        {
            capsule: Readonly<MoverCapsule3d>;
            position: Readonly<Coords3d>;
        } & CastFilter
    >): MoverPlane3d[] {
        const pointer = this.box3d._collideMover(
            this.requireWorld(),
            position.x,
            position.y,
            position.z,
            capsule.center1.x,
            capsule.center1.y,
            capsule.center1.z,
            capsule.center2.x,
            capsule.center2.y,
            capsule.center2.z,
            capsule.radius,
            filter?.category ?? allBits,
            filter?.mask ?? allBits,
        );
        const [count] = readWasmInt32s(this.box3d, pointer, 1);
        return createArray(count, (index) => {
            const planePointer = pointer + (1 + index * 8) * Float32Array.BYTES_PER_ELEMENT;
            const [entityId] = readWasmInt32s(this.box3d, planePointer, 1);
            const [
                normalX,
                normalY,
                normalZ,
                offset,
                pointX,
                pointY,
                pointZ,
            ] = readWasmFloat32s(this.box3d, planePointer + Int32Array.BYTES_PER_ELEMENT, 7);
            return {
                entityId,
                normal: {
                    x: normalX,
                    y: normalY,
                    z: normalZ,
                },
                offset,
                /** Box3D gives the point relative to the mover's position. */
                point: {
                    x: pointX + position.x,
                    y: pointY + position.y,
                    z: pointZ + position.z,
                },
            };
        });
    }

    /**
     * Finds how far a character mover can move toward `targetDelta` without going through `planes`
     * (usually from {@link PhysicsWorld3d.collideMover} at the same position), and removes the parts
     * of `velocity` that push into the planes it pressed against.
     */
    public solveMoverPlanes({
        planes,
        targetDelta,
        velocity,
    }: Readonly<{
        planes: ReadonlyArray<Readonly<MoverCollisionPlane3d>>;
        targetDelta: Readonly<Coords3d>;
        velocity: Readonly<Coords3d>;
    }>) {
        this.requireWorld();
        writeInput(this.box3d, {
            floats: planes.flatMap((plane) => {
                return [
                    plane.normal.x,
                    plane.normal.y,
                    plane.normal.z,
                    plane.offset,
                    plane.pushLimit ?? Infinity,
                    Number(!plane.isSoft),
                ];
            }),
        });
        const pointer = this.box3d._solveMoverPlanes(
            planes.length,
            targetDelta.x,
            targetDelta.y,
            targetDelta.z,
            velocity.x,
            velocity.y,
            velocity.z,
        );
        const [
            deltaX,
            deltaY,
            deltaZ,
            velocityX,
            velocityY,
            velocityZ,
        ] = readWasmFloat32s(this.box3d, pointer, 6);
        return {
            /** The translation to try, usually through {@link PhysicsWorld3d.castMover}. */
            delta: {
                x: deltaX,
                y: deltaY,
                z: deltaZ,
            },
            velocity: {
                x: velocityX,
                y: velocityY,
                z: velocityZ,
            },
        };
    }

    /** Destroys the Box3D world. Every later call that needs the world throws. */
    public destroy() {
        if (this.worldId != undefined) {
            this.destroyWorld(this.worldId);
        }
        this.worldId = undefined;
    }
}

/**
 * Plays back a recording from {@link PhysicsWorld3d.stopRecording} in its own world, one step
 * (frame) at a time. Recordings don't save entity ids, so bodies are known by the order they were
 * created in.
 *
 * @category Main
 */
export class PhysicsReplay3d {
    /** @throws Error if Box3D can't read the recording. */
    public static async create(recording: Uint8Array) {
        const box3d = await box3dModule;
        writeWasmInputBytes(box3d, recording);
        const replay = box3d._createReplay(recording.byteLength);
        if (!replay) {
            throw new Error(invalidRecordingMessage);
        }
        return new PhysicsReplay3d(box3d, replay);
    }

    /**
     * Replays the whole recording in a new world and checks that every step matches what was
     * recorded. False for recordings Box3D can't read.
     */
    public static async replaysExactly(recording: Uint8Array) {
        const box3d = await box3dModule;
        writeWasmInputBytes(box3d, recording);
        return !!box3d._validateRecording(recording.byteLength);
    }

    protected readonly box3d: Box3dModule;
    protected replay: number | undefined;

    /** Use {@link PhysicsReplay3d.create} instead, which loads Box3D first. */
    protected constructor(box3d: Box3dModule, replay: number) {
        this.box3d = box3d;
        this.replay = replay;
    }

    /** @throws Error if the replay was destroyed. */
    protected requireReplay() {
        if (this.replay == undefined) {
            throw new Error('The physics replay has been destroyed.');
        }
        return this.replay;
    }

    /** Replays the next frame. Returns false, replaying nothing, once at the end. */
    public stepFrame() {
        return !!this.box3d._stepReplayFrame(this.requireReplay());
    }

    /** Goes back to before the first frame. */
    public restart() {
        this.box3d._restartReplay(this.requireReplay());
    }

    /**
     * Jumps to just after `frame` was replayed, starting from the closest saved keyframe before it.
     * Frame 0 is before the first frame.
     */
    public seekFrame(frame: number) {
        this.box3d._seekReplayFrame(this.requireReplay(), frame);
    }

    /** Where playback is and how keyframes are being saved. */
    public getStatus() {
        const [
            frame,
            isAtEnd,
            divergedFrame,
            keyframeBudgetBytes,
            keyframeMinInterval,
            keyframeInterval,
            keyframeBytes,
        ] = readWasmInt32s(this.box3d, this.box3d._readReplayStatus(this.requireReplay()), 7);
        return {
            /** How many frames have been replayed. */
            frame,
            isAtEnd: !!isAtEnd,
            /** The first frame that didn't match the recording, if any. */
            divergedFrame: divergedFrame < 0 ? undefined : divergedFrame,
            /** See {@link PhysicsReplay3d.setKeyframePolicy}. */
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
        const [
            frameCount,
            stepSeconds,
            subStepCount,
            lowerX,
            lowerY,
            lowerZ,
            upperX,
            upperY,
            upperZ,
        ] = readWasmFloat32s(this.box3d, this.box3d._readReplayInfo(this.requireReplay()), 9);
        return {
            frameCount,
            stepSeconds,
            subStepCount,
            /** Contains every body during the whole recording. */
            bounds: {
                lower: {
                    x: lowerX,
                    y: lowerY,
                    z: lowerZ,
                },
                upper: {
                    x: upperX,
                    y: upperY,
                    z: upperZ,
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
        this.box3d._setReplayKeyframePolicy(this.requireReplay(), budgetBytes, minInterval);
    }

    /**
     * Each recorded body, in the order they were created, or undefined for bodies destroyed by the
     * current frame.
     */
    public getBodies() {
        const pointer = this.box3d._readReplayBodies(this.requireReplay());
        const [count] = readWasmFloat32s(this.box3d, pointer, 1);
        const values = readWasmFloat32s(
            this.box3d,
            pointer + Float32Array.BYTES_PER_ELEMENT,
            count * 8,
        );
        return createArray(count, (index): Transform3d | undefined => {
            const [
                exists,
                x,
                y,
                z,
                rotationX,
                rotationY,
                rotationZ,
                rotationW,
            ] = assertWrap.isLengthExactly(values.slice(index * 8, index * 8 + 8), 8);
            return exists
                ? {
                      position: {
                          x,
                          y,
                          z,
                      },
                      rotation: {
                          x: rotationX,
                          y: rotationY,
                          z: rotationZ,
                          w: rotationW,
                      },
                  }
                : undefined;
        });
    }

    /**
     * The world queries made before the last replayed frame's step. Queries made after the
     * recording's last step only appear once {@link PhysicsReplay3d.stepFrame} returns false.
     */
    public getFrameQueries() {
        const replay = this.requireReplay();
        const [
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            queryCount,
        ] = readWasmInt32s(this.box3d, this.box3d._readReplayStatus(replay), 8);
        return createArray(queryCount, (queryIndex): ReplayQuery3d => {
            const pointer = this.box3d._readReplayQuery(replay, queryIndex);
            const [
                type,
                categoryLow,
                categoryHigh,
                maskLow,
                maskHigh,
            ] = readWasmInt32s(this.box3d, pointer, 5);
            const [
                lowerX,
                lowerY,
                lowerZ,
                upperX,
                upperY,
                upperZ,
                originX,
                originY,
                originZ,
                translationX,
                translationY,
                translationZ,
            ] = readWasmFloat32s(this.box3d, pointer + 5 * Float32Array.BYTES_PER_ELEMENT, 12);
            const [hitCount] = readWasmInt32s(
                this.box3d,
                pointer + (replayQueryLength - 1) * Int32Array.BYTES_PER_ELEMENT,
                1,
            );
            const hitsPointer = pointer + replayQueryLength * Int32Array.BYTES_PER_ELEMENT;
            return {
                type: assertWrap.isEnumValue(type, ReplayQueryType3d),
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
                        z: lowerZ,
                    },
                    upper: {
                        x: upperX,
                        y: upperY,
                        z: upperZ,
                    },
                },
                origin: {
                    x: originX,
                    y: originY,
                    z: originZ,
                },
                translation: {
                    x: translationX,
                    y: translationY,
                    z: translationZ,
                },
                hits: createArray(hitCount, (hitIndex) => {
                    const hitPointer =
                        hitsPointer +
                        hitIndex * replayQueryHitLength * Int32Array.BYTES_PER_ELEMENT;
                    const [bodyIndex] = readWasmInt32s(this.box3d, hitPointer, 1);
                    const [
                        pointX,
                        pointY,
                        pointZ,
                        normalX,
                        normalY,
                        normalZ,
                        fraction,
                    ] = readWasmFloat32s(this.box3d, hitPointer + Int32Array.BYTES_PER_ELEMENT, 7);
                    return {
                        bodyIndex: bodyIndex < 0 ? undefined : bodyIndex,
                        point: {
                            x: pointX,
                            y: pointY,
                            z: pointZ,
                        },
                        normal: {
                            x: normalX,
                            y: normalY,
                            z: normalZ,
                        },
                        fraction,
                    };
                }),
            };
        });
    }

    /**
     * Draws the replayed world, like {@link PhysicsWorld3d.drawDebug}, plus the last replayed
     * frame's queries when `drawFrameQueries` is set. Shape owners are body indexes from
     * {@link PhysicsReplay3d.getBodies}, or -1 for shapes not on a recorded body.
     */
    public drawDebug({
        drawFrameQueries,
        frameQueryIndex,
        highlightedFrameQueryIndex,
        ...options
    }: Readonly<
        DebugDrawOptions3d &
            PartialWithUndefined<{
                drawFrameQueries: boolean;
                /** Draws only this query from {@link PhysicsReplay3d.getFrameQueries}. */
                frameQueryIndex: number;
                /** Draws this query from {@link PhysicsReplay3d.getFrameQueries} highlighted. */
                highlightedFrameQueryIndex: number;
            }>
    >) {
        const replay = this.requireReplay();
        const mask = writeDebugDrawOptions(this.box3d, options);
        return readDrawing(
            this.box3d,
            this.box3d._drawReplay(
                replay,
                mask,
                drawFrameQueries ? (frameQueryIndex ?? -1) : -2,
                highlightedFrameQueryIndex ?? -1,
            ),
        );
    }

    /** Releases the replay's world. Every later call throws. */
    public destroy() {
        if (this.replay != undefined) {
            this.box3d._destroyReplay(this.replay);
        }
        this.replay = undefined;
    }
}

const invalidRecordingMessage = 'Invalid recording: it is not from PhysicsWorld3d.stopRecording.';

/**
 * A box aligned with the axes.
 *
 * @category Internal
 */
export type Bounds3d = {
    lowerBound: Coords3d;
    upperBound: Coords3d;
};

/**
 * Where a ray or shape cast from {@link PhysicsGeometry3d} hit a shape.
 *
 * @category Internal
 */
export type GeometryHit3d = Omit<CastHit3d, 'entityId'> & {
    /** Which triangle of a mesh or height field was hit, including a mesh inside a compound. */
    triangleIndex: number;
    /** Which child of a compound was hit. */
    childIndex: number;
};

/**
 * A shape's motion from `start` to `end` for {@link PhysicsGeometry3d.computeTimeOfImpact}.
 *
 * @category Internal
 */
export type Sweep3d = {
    start: Transform3d;
    end: Transform3d;
} & PartialWithUndefined<{
    /**
     * The point the shape turns around, usually its center of mass, relative to the shape before
     * its rotation.
     *
     * @default {x: 0, y: 0, z: 0}
     */
    localCenter: Coords3d;
}>;

/**
 * How {@link PhysicsGeometry3d.computeTimeOfImpact} ended.
 *
 * @category Main
 */
export enum TimeOfImpactState3d {
    Unknown = 'unknown',
    /** Box3D gave up before finding an answer. */
    Failed = 'failed',
    /** The shapes already overlap at the start. */
    Overlapped = 'overlapped',
    Hit = 'hit',
    /** The shapes never touch. */
    Separated = 'separated',
}

/** In the order of Box3D's `b3TOIState`. */
const timeOfImpactStates = [
    TimeOfImpactState3d.Unknown,
    TimeOfImpactState3d.Failed,
    TimeOfImpactState3d.Overlapped,
    TimeOfImpactState3d.Hit,
    TimeOfImpactState3d.Separated,
];

/**
 * A contact between two shapes from {@link PhysicsGeometry3d.collide}.
 *
 * @category Internal
 */
export type Manifold3d = {
    /** Points from shape A toward shape B. */
    normal: Coords3d;
    /** Empty when the shapes aren't touching. */
    points: {
        /** In world space. */
        point: Coords3d;
        /** Negative when the shapes overlap. */
        separation: number;
        /** Stays the same for the same feature pair as the shapes move. */
        id: number;
    }[];
};

/**
 * A triangle of a mesh or height field from {@link PhysicsGeometry3d.queryTriangles}.
 *
 * @category Internal
 */
export type GeometryTriangle3d = {
    triangleIndex: number;
    /** In world space. */
    corners: [
        Coords3d,
        Coords3d,
        Coords3d,
    ];
};

/**
 * Filters which proxies a {@link DynamicTree3d} query finds, by their category.
 *
 * @category Internal
 */
export type TreeFilter3d = PartialWithUndefined<{
    /** @default every category */
    mask: bigint;
    /** Only finds proxies whose category has every bit of `mask`, instead of any bit. */
    requireAllBits: boolean;
}>;

const identityTransform: Transform3d = {
    position: {
        x: 0,
        y: 0,
        z: 0,
    },
    rotation: bodyStateShape.default.rotation,
};

/** The body ids that the shape creators in `bindings.c` read as geometry slots instead of bodies. */
const geometrySlotIds: ReadonlyArray<Readonly<Box3dId>> = [
    {
        index: -1,
        tag: 0,
    },
    {
        index: -2,
        tag: 0,
    },
];

/** Reads a transform as `loadInputTransform` in `bindings.c` does. */
function flattenTransform(transform: Readonly<Transform3d> | undefined) {
    const {position, rotation} = transform ?? identityTransform;
    return [
        ...flattenCoords3d(position),
        rotation.x,
        rotation.y,
        rotation.z,
        rotation.w,
    ];
}

function flattenBounds(bounds: Readonly<Bounds3d>) {
    return [
        ...flattenCoords3d(bounds.lowerBound),
        ...flattenCoords3d(bounds.upperBound),
    ];
}

/**
 * A cast shape's points in world space.
 *
 * @throws Error if the shape has too many points for Box3D.
 */
function placeCastShape(
    shape: Readonly<CastShapeDefinition>,
    transform: Readonly<Transform3d> | undefined,
) {
    const {points, radius} = readCastShapeProxy(shape);
    const {position, rotation} = transform ?? identityTransform;
    return {
        floats: points.flatMap((point) => {
            return flattenCoords3d(
                placePoint(
                    {
                        offset: position,
                        rotation,
                    },
                    placePoint(shape, point),
                ),
            );
        }),
        pointCount: points.length,
        radius,
    };
}

/** Reads a sweep as `loadSweep` in `bindings.c` does. */
function flattenSweep({start, end, localCenter}: Readonly<Sweep3d>) {
    const center = localCenter ?? identityTransform.position;
    return [
        ...flattenCoords3d(center),
        ...[
            start,
            end,
        ].flatMap((transform) => {
            return flattenCoords3d(
                placePoint(
                    {
                        offset: transform.position,
                        rotation: transform.rotation,
                    },
                    center,
                ),
            );
        }),
        ...[
            start,
            end,
        ].flatMap(({rotation}) => {
            return [
                rotation.x,
                rotation.y,
                rotation.z,
                rotation.w,
            ];
        }),
    ];
}

function readBounds(box3d: Box3dModule, pointer: number): Bounds3d {
    return {
        lowerBound: readCoords3d(box3d, pointer),
        upperBound: readCoords3d(box3d, pointer + 3 * Float32Array.BYTES_PER_ELEMENT),
    };
}

/** Reads `writeCastOutput` from `bindings.c`. */
function readGeometryHit(box3d: Box3dModule, pointer: number): GeometryHit3d | undefined {
    const [isHit] = readWasmFloat32s(box3d, pointer, 1);
    if (!isHit) {
        return undefined;
    }
    const [
        fraction,
        triangleIndex,
        childIndex,
    ] = readWasmFloat32s(box3d, pointer + 7 * Float32Array.BYTES_PER_ELEMENT, 3);
    return {
        point: readCoords3d(box3d, pointer + Float32Array.BYTES_PER_ELEMENT),
        normal: readCoords3d(box3d, pointer + 4 * Float32Array.BYTES_PER_ELEMENT),
        fraction,
        triangleIndex,
        childIndex,
    };
}

/** Reads `writeManifold` from `bindings.c`. */
function readManifold(box3d: Box3dModule, pointer: number): Manifold3d {
    const [pointCount] = readWasmFloat32s(box3d, pointer, 1);
    return {
        normal: readCoords3d(box3d, pointer + Float32Array.BYTES_PER_ELEMENT),
        points: createArray(pointCount, (index) => {
            const pointPointer = pointer + (4 + 5 * index) * Float32Array.BYTES_PER_ELEMENT;
            const [separation] = readWasmFloat32s(
                box3d,
                pointPointer + 3 * Float32Array.BYTES_PER_ELEMENT,
                1,
            );
            const [id] = readWasmInt32s(
                box3d,
                pointPointer + 4 * Float32Array.BYTES_PER_ELEMENT,
                1,
            );
            return {
                point: readCoords3d(box3d, pointPointer),
                separation,
                id,
            };
        }),
    };
}

function readPoints({
    box3d,
    pointer,
    count,
}: Readonly<{
    box3d: Box3dModule;
    pointer: number;
    count: number;
}>) {
    return createArray(count, (index) => {
        return readCoords3d(box3d, pointer + 3 * index * Float32Array.BYTES_PER_ELEMENT);
    });
}

/** Reads `writeHullPoints` from `bindings.c`. */
function readHullPoints(box3d: Box3dModule, pointer: number) {
    const [count] = readWasmFloat32s(box3d, pointer, 1);
    return readPoints({
        box3d,
        pointer: pointer + Float32Array.BYTES_PER_ELEMENT,
        count,
    });
}

/** Reads `writeMeshData` from `bindings.c`. */
function readMesh(
    box3d: Box3dModule,
    pointer: number,
): Extract<PhysicsShapeDefinition, {type: ShapeType.Mesh}> {
    const [
        vertexCount,
        triangleCount,
    ] = readWasmFloat32s(box3d, pointer, 2);
    const indexes = readWasmFloat32s(
        box3d,
        pointer + (2 + 3 * vertexCount) * Float32Array.BYTES_PER_ELEMENT,
        3 * triangleCount,
    );
    return {
        type: ShapeType.Mesh,
        vertices: readPoints({
            box3d,
            pointer: pointer + 2 * Float32Array.BYTES_PER_ELEMENT,
            count: vertexCount,
        }),
        triangles: createArray(triangleCount, (index) => {
            return assertWrap.isLengthExactly(indexes.slice(3 * index, 3 * index + 3), 3);
        }),
    };
}

/** Reads `writeHeightFieldData` from `bindings.c`. */
function readHeightField(
    box3d: Box3dModule,
    pointer: number,
    scale: Readonly<Coords3d>,
): Extract<PhysicsShapeDefinition, {type: ShapeType.HeightField}> {
    const [
        rowCount,
        columnCount,
        minimum,
        maximum,
    ] = readWasmFloat32s(box3d, pointer, 4);
    const heights = readWasmFloat32s(
        box3d,
        pointer + 4 * Float32Array.BYTES_PER_ELEMENT,
        rowCount * columnCount,
    );
    const cellColumnCount = columnCount - 1;
    const isHole = readWasmFloat32s(
        box3d,
        pointer + (4 + heights.length) * Float32Array.BYTES_PER_ELEMENT,
        (rowCount - 1) * cellColumnCount,
    );
    const holes = isHole.flatMap((hole, cellIndex) => {
        return hole
            ? [
                  {
                      row: Math.floor(cellIndex / cellColumnCount),
                      column: cellIndex % cellColumnCount,
                  },
              ]
            : [];
    });
    return {
        type: ShapeType.HeightField,
        heights: createArray(rowCount, (row) => {
            return heights.slice(row * columnCount, (row + 1) * columnCount);
        }),
        scale: {
            ...scale,
        },
        heightRange: {
            minimum,
            maximum,
        },
        ...(holes.length
            ? {
                  holes,
              }
            : {}),
    };
}

/** @throws Error naming the first value that isn't a positive number. */
function assertPositive(values: Readonly<Record<string, number>>) {
    getObjectTypedEntries(values).forEach(
        ([
            name,
            value,
        ]) => {
            if (Number.isNaN(value) || value <= 0) {
                throw new Error(`${name} must be positive, got ${value}.`);
            }
        },
    );
}

/** @throws Error naming the first value that isn't a positive whole number. */
function assertPositiveWholeNumbers(values: Readonly<Record<string, number>>) {
    getObjectTypedEntries(values).forEach(
        ([
            name,
            value,
        ]) => {
            if (!Number.isInteger(value) || value < 1) {
                throw new Error(`${name} must be a positive whole number, got ${value}.`);
            }
        },
    );
}

/** @throws Error unless `value` is a whole number from `minimum` to `maximum`. */
function assertWholeNumberInRange({
    name,
    value,
    minimum,
    maximum,
}: Readonly<{
    name: string;
    value: number;
    minimum: number;
    maximum: number;
}>) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new Error(
            `${name} must be a whole number from ${minimum} to ${maximum}, got ${value}.`,
        );
    }
}

/** Box3D's `B3_HULL_LIMIT`. */
const maxHullVertexCount = 255;

/**
 * Shape math without a world, like Box3D's collision functions: mass, bounds, overlaps, casts,
 * distances, time of impact, and contacts between single shapes, plus the shape builders from
 * Box3D's samples. Every transform defaults to the origin with no rotation. Shapes keep their
 * `offset` and `rotation`, relative to their transform.
 *
 * @category Main
 */
export class PhysicsGeometry3d {
    /** Loads Box3D, shared with every world. */
    public static async create() {
        return new PhysicsGeometry3d(await box3dModule);
    }

    protected readonly box3d: Box3dModule;

    /** Use {@link PhysicsGeometry3d.create} instead, which loads Box3D first. */
    protected constructor(box3d: Box3dModule) {
        this.box3d = box3d;
    }

    /**
     * Loads shapes where the geometry bindings read them, which uses the input buffer, so call it
     * before writing any other input.
     *
     * @throws Error if a shape is invalid.
     */
    protected loadShapes(shapes: ReadonlyArray<Readonly<PhysicsShapeDefinition>>) {
        shapes.forEach((shape, slotIndex) => {
            assertValidShape(shape);
            createShape({
                box3d: this.box3d,
                bodyId: assertWrap.isDefined(geometrySlotIds[slotIndex]),
                shape,
                materialOverride: {},
            });
        });
    }

    /** The mass that the shape's `material.density` gives it, with its center in the shape's frame. */
    public computeMass(shape: Readonly<CastShapeDefinition>) {
        this.loadShapes([shape]);
        return readMassData(
            this.box3d,
            this.box3d._computeGeometryMass(shape.material?.density ?? 1),
        );
    }

    /** The smallest box around the shape. */
    public computeBounds({
        shape,
        transform,
    }: Readonly<{
        shape: Readonly<PhysicsShapeDefinition>;
        transform?: Readonly<Transform3d> | undefined;
    }>) {
        this.loadShapes([shape]);
        writeInput(this.box3d, {
            floats: flattenTransform(transform),
        });
        return readBounds(this.box3d, this.box3d._computeGeometryBounds());
    }

    /** Whether `shapeB` overlaps `shapeA`. */
    public overlap({
        shapeA,
        transformA,
        shapeB,
        transformB,
    }: Readonly<
        {
            shapeA: Readonly<PhysicsShapeDefinition>;
            shapeB: Readonly<CastShapeDefinition>;
        } & PartialWithUndefined<{
            transformA: Readonly<Transform3d>;
            transformB: Readonly<Transform3d>;
        }>
    >) {
        this.loadShapes([shapeA]);
        const placed = placeCastShape(shapeB, transformB);
        writeInput(this.box3d, {
            floats: [
                ...flattenTransform(transformA),
                ...placed.floats,
            ],
        });
        return !!this.box3d._overlapGeometry(placed.pointCount, placed.radius);
    }

    /** Where a ray from `origin` along `translation` first hits the shape. */
    public castRay({
        shape,
        transform,
        origin,
        translation,
        maxFraction,
        isHollow,
    }: Readonly<
        {
            shape: Readonly<PhysicsShapeDefinition>;
            origin: Readonly<Coords3d>;
            translation: Readonly<Coords3d>;
        } & PartialWithUndefined<{
            transform: Readonly<Transform3d>;
            /**
             * How much of `translation` to check.
             *
             * @default 1
             */
            maxFraction: number;
            /**
             * Treats a sphere as a shell, so a ray starting inside it hits it on the way out. Other
             * shapes ignore this.
             */
            isHollow: boolean;
        }>
    >) {
        this.loadShapes([shape]);
        writeInput(this.box3d, {
            floats: [
                ...flattenTransform(transform),
                ...flattenCoords3d(origin),
                ...flattenCoords3d(translation),
                maxFraction ?? 1,
            ],
        });
        return readGeometryHit(this.box3d, this.box3d._castGeometryRay(Number(!!isHollow)));
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
            shapeA: Readonly<PhysicsShapeDefinition>;
            shapeB: Readonly<CastShapeDefinition>;
            translation: Readonly<Coords3d>;
        } & PartialWithUndefined<{
            transformA: Readonly<Transform3d>;
            transformB: Readonly<Transform3d>;
            /** @default 1 */
            maxFraction: number;
            /**
             * When `shapeB` starts overlapping `shapeA` by less than its radius, lets it keep
             * moving until its core gets a little closer instead of hitting at fraction 0. Box3D's
             * character mover uses this so rounded shapes can slide along the ground.
             */
            canEncroach: boolean;
        }>
    >) {
        this.loadShapes([shapeA]);
        const placed = placeCastShape(shapeB, transformB);
        writeInput(this.box3d, {
            floats: [
                ...flattenTransform(transformA),
                ...flattenCoords3d(translation),
                maxFraction ?? 1,
                ...placed.floats,
            ],
        });
        return readGeometryHit(
            this.box3d,
            this.box3d._castGeometryShape(placed.pointCount, placed.radius, Number(!!canEncroach)),
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
            shapeA: Readonly<CastShapeDefinition>;
            shapeB: Readonly<CastShapeDefinition>;
        } & PartialWithUndefined<{
            transformA: Readonly<Transform3d>;
            transformB: Readonly<Transform3d>;
            /** Measures between the shapes' cores, as if spheres were points and capsules lines. */
            ignoreRadii: boolean;
        }>
    >) {
        this.loadShapes([
            shapeA,
            shapeB,
        ]);
        writeInput(this.box3d, {
            floats: [
                ...flattenTransform(transformA),
                ...flattenTransform(transformB),
            ],
        });
        const pointer = this.box3d._computeGeometryDistance(Number(!ignoreRadii));
        const [
            distance,
            iterations,
        ] = readWasmFloat32s(this.box3d, pointer + 9 * Float32Array.BYTES_PER_ELEMENT, 2);
        return {
            pointA: readCoords3d(this.box3d, pointer),
            pointB: readCoords3d(this.box3d, pointer + 3 * Float32Array.BYTES_PER_ELEMENT),
            /** Points from shape A toward shape B. Meaningless when `distance` is 0. */
            normal: readCoords3d(this.box3d, pointer + 6 * Float32Array.BYTES_PER_ELEMENT),
            distance,
            /** How many steps Box3D's GJK distance algorithm took. */
            iterations,
        };
    }

    /**
     * When two moving and turning shapes first touch, as a fraction of their sweeps. This is how
     * Box3D keeps fast bodies from tunneling.
     */
    public computeTimeOfImpact({
        shapeA,
        sweepA,
        shapeB,
        sweepB,
        maxFraction,
    }: Readonly<
        {
            shapeA: Readonly<CastShapeDefinition>;
            sweepA: Readonly<Sweep3d>;
            shapeB: Readonly<CastShapeDefinition>;
            sweepB: Readonly<Sweep3d>;
        } & PartialWithUndefined<{
            /** @default 1 */
            maxFraction: number;
        }>
    >) {
        this.loadShapes([
            shapeA,
            shapeB,
        ]);
        writeInput(this.box3d, {
            floats: [
                ...flattenSweep(sweepA),
                ...flattenSweep(sweepB),
                maxFraction ?? 1,
            ],
        });
        const pointer = this.box3d._computeTimeOfImpact();
        const [state] = readWasmFloat32s(this.box3d, pointer, 1);
        const [
            fraction,
            distance,
        ] = readWasmFloat32s(this.box3d, pointer + 7 * Float32Array.BYTES_PER_ELEMENT, 2);
        return {
            state: assertWrap.isDefined(timeOfImpactStates[state]),
            /**
             * Where the shapes touch, in world space, when `state` is
             * {@link TimeOfImpactState3d.Hit}.
             */
            point: readCoords3d(this.box3d, pointer + Float32Array.BYTES_PER_ELEMENT),
            /** Points from shape A toward shape B, when `state` is {@link TimeOfImpactState3d.Hit}. */
            normal: readCoords3d(this.box3d, pointer + 4 * Float32Array.BYTES_PER_ELEMENT),
            fraction,
            /** Between the shapes' cores at `fraction`, ignoring their radii. */
            distance,
        };
    }

    /**
     * The contact points Box3D's solver would use between two shapes, including speculative ones
     * where the shapes are close but not yet touching.
     */
    public collide({
        shapeA,
        transformA,
        shapeB,
        transformB,
    }: Readonly<
        {
            shapeA: Readonly<CastShapeDefinition>;
            shapeB: Readonly<CastShapeDefinition>;
        } & PartialWithUndefined<{
            transformA: Readonly<Transform3d>;
            transformB: Readonly<Transform3d>;
        }>
    >) {
        this.loadShapes([
            shapeA,
            shapeB,
        ]);
        writeInput(this.box3d, {
            floats: [
                ...flattenTransform(transformA),
                ...flattenTransform(transformB),
            ],
        });
        return readManifold(this.box3d, this.box3d._collideGeometry());
    }

    /**
     * Same as {@link PhysicsGeometry3d.collide} but against one triangle in world space, as shape B.
     * Only shapes in front of the triangle touch it, on the side `(b - a) × (c - a)` points to.
     */
    public collideTriangle({
        shape,
        transform,
        triangle,
    }: Readonly<{
        shape: Readonly<CastShapeDefinition>;
        transform?: Readonly<Transform3d> | undefined;
        triangle: Readonly<
            [
                Readonly<Coords3d>,
                Readonly<Coords3d>,
                Readonly<Coords3d>,
            ]
        >;
    }>) {
        this.loadShapes([shape]);
        writeInput(this.box3d, {
            floats: [
                ...flattenTransform(transform),
                ...triangle.flatMap(flattenCoords3d),
            ],
        });
        return readManifold(this.box3d, this.box3d._collideGeometryTriangle());
    }

    /**
     * The corners of the smallest convex shape around `points`, in Box3D's order. Undefined when
     * there are fewer than 4 points or they all lie on one plane.
     */
    public computeHull({
        points,
        maxVertexCount,
    }: Readonly<{
        points: ReadonlyArray<Readonly<Coords3d>>;
        /**
         * Simplifies the hull to at most this many corners, from 4 to 255.
         *
         * @default 255
         */
        maxVertexCount?: number | undefined;
    }>) {
        writeInput(this.box3d, {
            floats: points.flatMap(flattenCoords3d),
        });
        const hull = readHullPoints(
            this.box3d,
            this.box3d._computeHull(points.length, maxVertexCount ?? maxHullVertexCount),
        );
        return hull.length ? hull : undefined;
    }

    /**
     * A hull shaped like a cylinder standing along y, from `yOffset` to `yOffset + height`.
     *
     * @throws Error if a length isn't positive or `sideCount` isn't from 3 to 32.
     */
    public createCylinderHull({
        height,
        radius,
        sideCount,
        yOffset,
    }: Readonly<{
        height: number;
        radius: number;
        sideCount: number;
        /** @default 0 */
        yOffset?: number | undefined;
    }>): Extract<PhysicsShapeDefinition, {type: ShapeType.Hull}> {
        assertPositive({
            height,
            radius,
        });
        assertWholeNumberInRange({
            name: 'sideCount',
            value: sideCount,
            minimum: 3,
            maximum: 32,
        });
        return {
            type: ShapeType.Hull,
            points: readHullPoints(
                this.box3d,
                this.box3d._createCylinderHull(height, radius, yOffset ?? 0, sideCount),
            ),
        };
    }

    /**
     * A hull shaped like a cone with its top cut off, standing along y from 0 to `height`.
     *
     * @throws Error if a length isn't positive or `sideCount` isn't from 4 to 32.
     */
    public createConeHull({
        height,
        bottomRadius,
        topRadius,
        sideCount,
    }: Readonly<{
        height: number;
        bottomRadius: number;
        topRadius: number;
        sideCount: number;
    }>): Extract<PhysicsShapeDefinition, {type: ShapeType.Hull}> {
        assertPositive({
            height,
            bottomRadius,
            topRadius,
        });
        assertWholeNumberInRange({
            name: 'sideCount',
            value: sideCount,
            minimum: 4,
            maximum: 32,
        });
        return {
            type: ShapeType.Hull,
            points: readHullPoints(
                this.box3d,
                this.box3d._createConeHull(height, bottomRadius, topRadius, sideCount),
            ),
        };
    }

    /**
     * A lumpy hull whose corners lie on a sphere of `radius`.
     *
     * @throws Error if `radius` isn't positive.
     */
    public createRockHull(radius: number): Extract<PhysicsShapeDefinition, {type: ShapeType.Hull}> {
        assertPositive({
            radius,
        });
        return {
            type: ShapeType.Hull,
            points: readHullPoints(this.box3d, this.box3d._createRockHull(radius)),
        };
    }

    /**
     * A flat mesh of square cells facing up, centered on the origin.
     *
     * @throws Error if a count isn't a positive whole number or `cellWidth` isn't positive.
     */
    public createGridMesh({
        xCount,
        zCount,
        cellWidth,
    }: Readonly<{
        /** How many cells along x. */
        xCount: number;
        /** How many cells along z. */
        zCount: number;
        cellWidth: number;
    }>) {
        assertPositive({
            cellWidth,
        });
        assertPositiveWholeNumbers({
            xCount,
            zCount,
        });
        return readMesh(this.box3d, this.box3d._createGridMesh(xCount, zCount, cellWidth));
    }

    /**
     * Same as {@link PhysicsGeometry3d.createGridMesh} but with each vertex at a height of
     * `amplitude` times a sine wave along x times a sine wave along z.
     *
     * @throws Error if a count isn't a positive whole number or `cellWidth` isn't positive.
     */
    public createWaveMesh({
        xCount,
        zCount,
        cellWidth,
        amplitude,
        rowFrequency,
        columnFrequency,
    }: Readonly<{
        xCount: number;
        zCount: number;
        cellWidth: number;
        amplitude: number;
        /** Waves per unit of length along z. */
        rowFrequency: number;
        /** Waves per unit of length along x. */
        columnFrequency: number;
    }>) {
        assertPositive({
            cellWidth,
        });
        assertPositiveWholeNumbers({
            xCount,
            zCount,
        });
        return readMesh(
            this.box3d,
            this.box3d._createWaveMesh(
                xCount,
                zCount,
                cellWidth,
                amplitude,
                rowFrequency,
                columnFrequency,
            ),
        );
    }

    /**
     * A ring-shaped mesh lying in the xy plane, centered on the origin.
     *
     * @throws Error if a resolution is below 3 or a length isn't positive.
     */
    public createTorusMesh({
        radialResolution,
        tubularResolution,
        radius,
        thickness,
    }: Readonly<{
        /** How many vertices go around the tube. */
        radialResolution: number;
        /** How many vertices go around the ring. */
        tubularResolution: number;
        /** From the center to the middle of the tube. */
        radius: number;
        /** The tube's radius. */
        thickness: number;
    }>) {
        assertPositive({
            radius,
            thickness,
        });
        getObjectTypedEntries({
            radialResolution,
            tubularResolution,
        }).forEach(
            ([
                name,
                value,
            ]) => {
                assertWholeNumberInRange({
                    name,
                    value,
                    minimum: 3,
                    maximum: Number.MAX_SAFE_INTEGER,
                });
            },
        );
        return readMesh(
            this.box3d,
            this.box3d._createTorusMesh(radialResolution, tubularResolution, radius, thickness),
        );
    }

    /**
     * A closed box mesh facing outward.
     *
     * @throws Error if a size isn't positive.
     */
    public createBoxMesh(
        params: Readonly<
            Omit<Extract<CastShapeDefinition, {type: ShapeType.Box}>, 'type' | 'rotation'>
        >,
    ) {
        return this.readBoxMesh(params, false);
    }

    /**
     * Same as {@link PhysicsGeometry3d.createBoxMesh} but facing inward, for keeping things inside.
     *
     * @throws Error if a size isn't positive.
     */
    public createHollowBoxMesh(
        params: Readonly<
            Omit<Extract<CastShapeDefinition, {type: ShapeType.Box}>, 'type' | 'rotation'>
        >,
    ) {
        return this.readBoxMesh(params, true);
    }

    /** Shared by the solid and hollow box mesh methods. */
    protected readBoxMesh(
        {
            width,
            height,
            depth,
            offset,
        }: Readonly<Omit<Extract<CastShapeDefinition, {type: ShapeType.Box}>, 'type' | 'rotation'>>,
        isHollow: boolean,
    ) {
        assertPositive({
            width,
            height,
            depth,
        });
        const center = offset ?? identityTransform.position;
        const args = [
            center.x,
            center.y,
            center.z,
            width / 2,
            height / 2,
            depth / 2,
        ] as const;
        return readMesh(
            this.box3d,
            isHollow
                ? this.box3d._createHollowBoxMesh(...args)
                : this.box3d._createBoxMesh(...args),
        );
    }

    /**
     * A closed mesh shaped like a square pyramid with its top cut off, from `offset.y` to `offset.y
     *
     * - Height`.
     *
     * @throws Error if a size isn't positive.
     */
    public createPlatformMesh({
        height,
        topWidth,
        bottomWidth,
        offset,
    }: Readonly<{
        height: number;
        topWidth: number;
        bottomWidth: number;
        /** Where the middle of the bottom sits. */
        offset?: Readonly<Coords3d> | undefined;
    }>) {
        assertPositive({
            height,
            topWidth,
            bottomWidth,
        });
        const center = offset ?? identityTransform.position;
        return readMesh(
            this.box3d,
            this.box3d._createPlatformMesh(
                center.x,
                center.y,
                center.z,
                height,
                topWidth,
                bottomWidth,
            ),
        );
    }

    /**
     * A flat height field at height 0, with a height range from -256 to 256.
     *
     * @throws Error if a count is below 2 or a scale component isn't positive.
     */
    public createGridHeightField(
        params: Readonly<
            {
                rowCount: number;
                columnCount: number;
                scale: Readonly<Coords3d>;
            } & PartialWithUndefined<{
                /** Makes every 16th cell a hole, skipping the first. */
                makeHoles: boolean;
            }>
        >,
    ) {
        return this.readHeightField(params, () => {
            return this.box3d._createGridHeightField(
                params.rowCount,
                params.columnCount,
                params.scale.x,
                params.scale.y,
                params.scale.z,
                Number(!!params.makeHoles),
            );
        });
    }

    /**
     * Same as {@link PhysicsGeometry3d.createGridHeightField} but with each height a sine wave along
     * the rows times a sine wave along the columns.
     *
     * @throws Error if a count is below 2 or a scale component isn't positive.
     */
    public createWaveHeightField(
        params: Readonly<
            {
                rowCount: number;
                columnCount: number;
                scale: Readonly<Coords3d>;
                /** Waves per row, so 0.25 peaks at row 1. */
                rowFrequency: number;
                /** Waves per column. */
                columnFrequency: number;
            } & PartialWithUndefined<{
                makeHoles: boolean;
            }>
        >,
    ) {
        return this.readHeightField(params, () => {
            return this.box3d._createWaveHeightField(
                params.rowCount,
                params.columnCount,
                params.scale.x,
                params.scale.y,
                params.scale.z,
                params.rowFrequency,
                params.columnFrequency,
                Number(!!params.makeHoles),
            );
        });
    }

    /** Validates the counts and scale, then reads the height field that `createHeightField` creates. */
    protected readHeightField(
        {
            rowCount,
            columnCount,
            scale,
        }: Readonly<{
            rowCount: number;
            columnCount: number;
            scale: Readonly<Coords3d>;
        }>,
        createHeightField: () => number,
    ) {
        getObjectTypedEntries({
            rowCount,
            columnCount,
        }).forEach(
            ([
                name,
                value,
            ]) => {
                assertWholeNumberInRange({
                    name,
                    value,
                    minimum: 2,
                    maximum: Number.MAX_SAFE_INTEGER,
                });
            },
        );
        assertPositive({
            'scale.x': scale.x,
            'scale.y': scale.y,
            'scale.z': scale.z,
        });
        return readHeightField(this.box3d, createHeightField(), scale);
    }

    /** The triangles of a mesh or height field whose bounds may overlap `bounds`, in world space. */
    public queryTriangles({
        shape,
        transform,
        bounds,
    }: Readonly<{
        shape: Readonly<
            Extract<
                PhysicsShapeDefinition,
                {
                    type: ShapeType.Mesh | ShapeType.HeightField;
                }
            >
        >;
        transform?: Readonly<Transform3d> | undefined;
        bounds: Readonly<Bounds3d>;
    }>): GeometryTriangle3d[] {
        this.loadShapes([shape]);
        writeInput(this.box3d, {
            floats: [
                ...flattenTransform(transform),
                ...flattenBounds(bounds),
            ],
        });
        const pointer = this.box3d._queryGeometryTriangles();
        const [count] = readWasmFloat32s(this.box3d, pointer, 1);
        return createArray(count, (index) => {
            const trianglePointer = pointer + (1 + 10 * index) * Float32Array.BYTES_PER_ELEMENT;
            const [triangleIndex] = readWasmFloat32s(this.box3d, trianglePointer, 1);
            return {
                triangleIndex,
                corners: assertWrap.isLengthExactly(
                    readPoints({
                        box3d: this.box3d,
                        pointer: trianglePointer + Float32Array.BYTES_PER_ELEMENT,
                        count: 3,
                    }),
                    3,
                ),
            };
        });
    }

    /** The indexes of a compound's children whose bounds overlap `bounds`, in world space. */
    public queryChildren({
        shape,
        transform,
        bounds,
    }: Readonly<{
        shape: Readonly<Extract<PhysicsShapeDefinition, {type: ShapeType.Compound}>>;
        transform?: Readonly<Transform3d> | undefined;
        bounds: Readonly<Bounds3d>;
    }>) {
        this.loadShapes([shape]);
        writeInput(this.box3d, {
            floats: [
                ...flattenTransform(transform),
                ...flattenBounds(bounds),
            ],
        });
        return readFoundIds(this.box3d, this.box3d._queryGeometryChildren());
    }

    /** Creates an empty {@link DynamicTree3d}. */
    public createTree() {
        return new DynamicTree3d(this.box3d, this.box3d._createTree());
    }
}

/** Reads `writeFoundIds` from `bindings.c`. */
function readFoundIds(box3d: Box3dModule, pointer: number) {
    const [count] = readWasmInt32s(box3d, pointer, 1);
    return readWasmInt32s(box3d, pointer + Int32Array.BYTES_PER_ELEMENT, count);
}

/**
 * Box3D's dynamic tree: boxes (proxies) sorted for fast overlap and cast queries, like the tree
 * each world keeps its shapes in. Queries find every proxy whose box the query touches, in no
 * particular order. Create one with {@link PhysicsGeometry3d.createTree}.
 *
 * @category Main
 */
export class DynamicTree3d {
    protected readonly box3d: Box3dModule;
    protected tree: number | undefined;
    protected readonly proxyIds = new Set<number>();

    /** Use {@link PhysicsGeometry3d.createTree} instead. */
    constructor(box3d: Box3dModule, tree: number) {
        this.box3d = box3d;
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
        bounds: Readonly<Bounds3d>;
        /**
         * Filters queries: they only find proxies whose category matches their mask.
         *
         * @default every category
         */
        category?: bigint | undefined;
    }>) {
        const proxyId = this.box3d._createTreeProxy(
            this.requireTree(),
            ...assertWrap.isLengthExactly(flattenBounds(bounds), 6),
            category ?? allBits,
        );
        this.proxyIds.add(proxyId);
        return proxyId;
    }

    /** @throws Error if there is no proxy with this id. */
    public destroyProxy(proxyId: number) {
        this.box3d._destroyTreeProxy(this.requireProxy(proxyId), proxyId);
        this.proxyIds.delete(proxyId);
    }

    /** @throws Error if there is no proxy with this id. */
    public moveProxy({
        proxyId,
        bounds,
    }: Readonly<{
        proxyId: number;
        bounds: Readonly<Bounds3d>;
    }>) {
        this.box3d._moveTreeProxy(
            this.requireProxy(proxyId),
            proxyId,
            ...assertWrap.isLengthExactly(flattenBounds(bounds), 6),
            0,
        );
    }

    /**
     * Grows the proxy's box to also cover `bounds`, which is cheaper than
     * {@link DynamicTree3d.moveProxy} for a proxy that only ever grows.
     *
     * @throws Error if there is no proxy with this id.
     */
    public enlargeProxy({
        proxyId,
        bounds,
    }: Readonly<{
        proxyId: number;
        bounds: Readonly<Bounds3d>;
    }>) {
        this.box3d._moveTreeProxy(
            this.requireProxy(proxyId),
            proxyId,
            ...assertWrap.isLengthExactly(flattenBounds(bounds), 6),
            1,
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
        this.box3d._setTreeProxyCategory(this.requireProxy(proxyId), proxyId, category);
    }

    /** @throws Error if there is no proxy with this id. */
    public getProxyCategory(proxyId: number) {
        return BigInt.asUintN(
            64,
            this.box3d._getTreeProxyCategory(this.requireProxy(proxyId), proxyId).valueOf(),
        );
    }

    /** @throws Error if there is no proxy with this id. */
    public getProxyBounds(proxyId: number) {
        return readBounds(
            this.box3d,
            this.box3d._readTreeProxyBounds(this.requireProxy(proxyId), proxyId),
        );
    }

    /** Every proxy whose box overlaps `bounds`. */
    public queryBounds({
        bounds,
        mask,
        requireAllBits,
    }: Readonly<
        {
            bounds: Readonly<Bounds3d>;
        } & TreeFilter3d
    >) {
        return readFoundIds(
            this.box3d,
            this.box3d._queryTree(
                this.requireTree(),
                ...assertWrap.isLengthExactly(flattenBounds(bounds), 6),
                mask ?? allBits,
                Number(!!requireAllBits),
            ),
        );
    }

    /** Every proxy whose box the ray from `origin` along `translation` passes through. */
    public castRay({
        origin,
        translation,
        maxFraction,
        mask,
        requireAllBits,
    }: Readonly<
        {
            origin: Readonly<Coords3d>;
            translation: Readonly<Coords3d>;
        } & PartialWithUndefined<{
            /** @default 1 */
            maxFraction: number;
        }> &
            TreeFilter3d
    >) {
        return readFoundIds(
            this.box3d,
            this.box3d._castTreeRay(
                this.requireTree(),
                origin.x,
                origin.y,
                origin.z,
                translation.x,
                translation.y,
                translation.z,
                maxFraction ?? 1,
                mask ?? allBits,
                Number(!!requireAllBits),
            ),
        );
    }

    /** Every proxy whose box `bounds` passes through while sweeping along `translation`. */
    public castBox({
        bounds,
        translation,
        maxFraction,
        mask,
        requireAllBits,
    }: Readonly<
        {
            bounds: Readonly<Bounds3d>;
            translation: Readonly<Coords3d>;
        } & PartialWithUndefined<{
            /** @default 1 */
            maxFraction: number;
        }> &
            TreeFilter3d
    >) {
        writeInput(this.box3d, {
            floats: [
                ...flattenBounds(bounds),
                ...flattenCoords3d(translation),
                maxFraction ?? 1,
            ],
        });
        return readFoundIds(
            this.box3d,
            this.box3d._castTreeBox(this.requireTree(), mask ?? allBits, Number(!!requireAllBits)),
        );
    }

    /**
     * The proxy whose box is closest to `point`, and the distance to it. 0 distance when the point
     * is inside the box. Undefined when no proxy is within `maxDistance`.
     */
    public queryClosest({
        point,
        maxDistance,
        mask,
        requireAllBits,
    }: Readonly<
        {
            point: Readonly<Coords3d>;
        } & PartialWithUndefined<{
            /** @default Infinity */
            maxDistance: number;
        }> &
            TreeFilter3d
    >) {
        const [
            proxyId,
            distance,
        ] = readWasmFloat32s(
            this.box3d,
            this.box3d._queryTreeClosest(
                this.requireTree(),
                point.x,
                point.y,
                point.z,
                maxDistance ?? Infinity,
                mask ?? allBits,
                Number(!!requireAllBits),
            ),
            2,
        );
        return proxyId < 0
            ? undefined
            : {
                  proxyId,
                  distance,
              };
    }

    /**
     * Rebuilds the tree for faster queries, which is worth it after many proxies moved. Returns how
     * many proxies were sorted.
     */
    public rebuild({
        isFullBuild,
    }: Readonly<
        PartialWithUndefined<{
            /** Rebuilds the whole tree instead of only the parts that moved. */
            isFullBuild: boolean;
        }>
    > = {}) {
        return this.box3d._rebuildTree(this.requireTree(), Number(!!isFullBuild));
    }

    /** The tree's shape and memory use, for deciding when to call {@link rebuild}. */
    public getStats() {
        const pointer = this.box3d._readTreeStats(this.requireTree());
        const [
            height,
            areaRatio,
            proxyCount,
            byteCount,
        ] = readWasmFloat32s(this.box3d, pointer, 4);
        return {
            height,
            /** The internal boxes' total area divided by the root's. Lower makes faster queries. */
            areaRatio,
            proxyCount,
            byteCount,
            /** The box around every proxy. */
            rootBounds: readBounds(this.box3d, pointer + 4 * Float32Array.BYTES_PER_ELEMENT),
        };
    }

    /** Releases the tree. Every later call throws. */
    public destroy() {
        if (this.tree != undefined) {
            this.box3d._destroyTree(this.tree);
        }
        this.tree = undefined;
    }
}
