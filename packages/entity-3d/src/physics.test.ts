import {BodyType} from '@antha/entity-core';
import {assert, assertWrap, check} from '@augment-vir/assert';
import {
    awaitedForEach,
    createArray,
    getObjectTypedValues,
    mapObjectValues,
    removeDuplicates,
    round,
    selectFrom,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {checkValidShape} from 'object-shape-tester';
import {
    JointType,
    PhysicsGeometry3d,
    PhysicsReplay3d,
    PhysicsWorld3d,
    ReplayQueryType3d,
    ShapeType,
    TimeOfImpactState3d,
    bodyStateShape,
    type CastShapeDefinition,
    type CompoundChildDefinition,
    type EntityPhysics3d,
    type EntityPhysicsDefinition,
    type JointDefinition3d,
    type PhysicsShapeDefinition,
    type Quaternion,
    type WorldHooks3d,
} from './physics.js';

const ballDefinition = {
    type: BodyType.Dynamic,
    shapes: [
        {
            type: ShapeType.Sphere,
            radius: 1,
        },
    ],
} as const satisfies EntityPhysicsDefinition;

const touchingFilter = {
    category: 1n,
    mask: 1n,
};

function roundCoords<const Coords extends Readonly<Record<string, number>>>(coords: Coords) {
    return mapObjectValues(coords, (key, value) => {
        /** Adding 0 turns the -0 of a flipped normal into 0. */
        return (
            round(value, {
                digits: 3,
            }) + 0
        );
    });
}

/** A static 2 meter cube centered at x = 5, entity 3. */
function createWall(world: Readonly<PhysicsWorld3d>) {
    return world.createBody({
        definition: {
            type: BodyType.Static,
            shapes: [
                {
                    type: ShapeType.Box,
                    width: 2,
                    height: 2,
                    depth: 2,
                },
            ],
        },
        filter: touchingFilter,
        entityId: 3,
        bodyState: {
            position: {
                x: 5,
                y: 0,
                z: 0,
            },
        },
    });
}

/**
 * A shapeless static anchor at the origin, entity 1, joined to a ball at x = 4, entity 2. Neither
 * collides with anything, so pairs in one world don't disturb each other.
 */
function createJoinedPair<const Definition extends JointDefinition3d>(
    world: Readonly<PhysicsWorld3d>,
    definition: Readonly<Definition>,
) {
    const filter = {
        category: 1n,
        mask: 0n,
    };
    const anchor = world.createBody({
        definition: {
            type: BodyType.Static,
        },
        filter,
        entityId: 1,
        bodyState: {},
    });
    const ball = world.createBody({
        definition: ballDefinition,
        filter,
        entityId: 2,
        bodyState: {
            position: {
                x: 4,
                y: 0,
                z: 0,
            },
        },
    });
    return {
        anchor,
        ball,
        joint: world.createJoint({
            bodies: [
                anchor,
                ball,
            ],
            definition,
            jointId: 7,
        }),
    };
}

/** Frame B of a joint from {@link createJoinedPair} that sits on the anchor's origin. */
const ballFrameAtAnchor = {
    position: {
        x: -4,
        y: 0,
        z: 0,
    },
    rotation: {
        x: 0,
        y: 0,
        z: 0,
        w: 1,
    },
};

function stepWorld(world: Readonly<PhysicsWorld3d>, stepCount: number) {
    return createArray(stepCount, () => world.step(1 / 60));
}

/** Steps the world, reporting which bodies moved upward fast enough to count as a bounce. */
function stepAndFindBounces(
    world: Readonly<PhysicsWorld3d>,
    bodies: ReadonlyArray<Readonly<EntityPhysics3d>>,
) {
    const bouncesPerStep = createArray(90, () => {
        world.step(1 / 60);
        return bodies.map((body) => body.getVelocity().y > 1);
    });
    return bodies.map((body, index) => bouncesPerStep.some((bounces) => bounces[index]));
}

const downwardGravity = {
    x: 0,
    y: -10,
    z: 0,
};

describe(PhysicsWorld3d.name, () => {
    it('throws when used after being destroyed', async () => {
        const world = await PhysicsWorld3d.create();
        world.destroy();

        world.destroy();

        assert.throws(() => world.step(1), {
            matchMessage: 'The physics world has been destroyed.',
        });
    });

    it('applies gravity changes between steps', async () => {
        const world = await PhysicsWorld3d.create();
        world.setGravity({
            x: 1,
            y: 0,
            z: 0,
        });
        const ball = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {},
        });
        world.step(1);
        const afterFirstStep = ball.getVelocity();
        world.setGravity({
            x: 0,
            y: 0,
            z: -2,
        });
        world.step(1);

        assert.deepEquals(
            {
                afterFirstStep,
                afterSecondStep: ball.getVelocity(),
                gravity: world.getGravity(),
            },
            {
                afterFirstStep: {
                    x: 1,
                    y: 0,
                    z: 0,
                },
                afterSecondStep: {
                    x: 1,
                    y: 0,
                    z: -2,
                },
                gravity: {
                    x: 0,
                    y: 0,
                    z: -2,
                },
            },
        );
        world.destroy();
    });

    it('creates bodies with every body type, shape type, and setting', async () => {
        const world = await PhysicsWorld3d.create();
        const bodies = [
            BodyType.Static,
            BodyType.Kinematic,
            BodyType.Dynamic,
        ].map((type, index) => {
            return world.createBody({
                definition: {
                    type,
                    motionLocks: {
                        angularX: true,
                    },
                    gravityScale: 2,
                    isBullet: true,
                    enableHitEvents: true,
                    linearDamping: 1,
                    angularDamping: 1,
                    shapes: [
                        {
                            type: ShapeType.Sphere,
                            radius: 1,
                            offset: {
                                x: 1,
                                y: 0,
                                z: 0,
                            },
                            material: {
                                density: 2,
                                friction: 0.1,
                                restitution: 0.5,
                            },
                        },
                        {
                            type: ShapeType.Box,
                            width: 2,
                            height: 4,
                            depth: 1,
                            material: {
                                density: 1,
                            },
                        },
                        {
                            type: ShapeType.Box,
                            width: 1,
                            height: 1,
                            depth: 1,
                            offset: {
                                x: 0,
                                y: 5,
                                z: 0,
                            },
                            material: {
                                density: 1,
                            },
                        },
                        {
                            type: ShapeType.Capsule,
                            radius: 1,
                            height: 4,
                            offset: {
                                x: 0,
                                y: 0,
                                z: 5,
                            },
                            material: {
                                density: 1,
                            },
                        },
                    ],
                },
                filter: {
                    category: 1n << 63n,
                    mask: 0n,
                },
                entityId: index + 1,
                bodyState: {
                    position: {
                        x: index * 10,
                        y: 0,
                        z: 0,
                    },
                },
            });
        });

        assert.deepEquals(
            bodies.map((body) => Math.round(body.getMass())),
            [
                0,
                0,
                /**
                 * A density 2 sphere of radius 1, a 2 by 4 by 1 box, a 1 by 1 by 1 box, and a
                 * capsule of radius 1 with a cylinder 2 long between its ends.
                 */
                Math.round(2 * ((4 / 3) * Math.PI) + 8 + 1 + (Math.PI * 2 + (4 / 3) * Math.PI)),
            ],
        );
        world.destroy();
    });

    it('rejects capsules shorter than their width', async () => {
        const world = await PhysicsWorld3d.create();

        assert.throws(
            () => {
                return world.createBody({
                    definition: {
                        type: BodyType.Dynamic,
                        shapes: [
                            {
                                type: ShapeType.Capsule,
                                radius: 1,
                                height: 1,
                            },
                        ],
                    },
                    filter: touchingFilter,
                    entityId: 1,
                    bodyState: {},
                });
            },
            {
                matchMessage: 'Capsule height (1) must be at least twice its radius (1).',
            },
        );
        world.destroy();
    });

    it('rejects shapes with sizes that are not positive', async () => {
        const world = await PhysicsWorld3d.create();

        assert.throws(
            () => {
                return world.createBody({
                    definition: {
                        type: BodyType.Dynamic,
                        shapes: [
                            {
                                type: ShapeType.Sphere,
                                radius: -1,
                            },
                        ],
                    },
                    filter: touchingFilter,
                    entityId: 1,
                    bodyState: {},
                });
            },
            {
                matchMessage: "A sphere shape's radius must be a finite number above 0, got -1.",
            },
        );
        assert.throws(
            () => {
                return world.createBody({
                    definition: {
                        type: BodyType.Dynamic,
                        shapes: [
                            {
                                type: ShapeType.Box,
                                width: 1,
                                height: Number.NaN,
                                depth: 1,
                            },
                        ],
                    },
                    filter: touchingFilter,
                    entityId: 1,
                    bodyState: {},
                });
            },
            {
                matchMessage: "A box shape's height must be a finite number above 0, got NaN.",
            },
        );
        world.destroy();
    });

    it('reads and writes body state', async () => {
        const world = await PhysicsWorld3d.create();
        const quarterTurnAroundY = {
            x: 0,
            y: Math.SQRT1_2,
            z: 0,
            w: Math.SQRT1_2,
        };
        const ball = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                position: {
                    x: 1,
                    y: 2,
                    z: 3,
                },
                rotation: quarterTurnAroundY,
                velocity: {
                    x: 3,
                    y: 4,
                    z: 5,
                },
                angularVelocity: {
                    x: 0,
                    y: 1,
                    z: 0,
                },
            },
        });
        const initialState = ball.getState();

        ball.setPosition({
            x: 10,
            y: 20,
            z: 30,
        });
        ball.setRotation({
            x: 0,
            y: 0,
            z: 0,
            w: 1,
        });
        ball.setVelocity({
            x: 0,
            y: 0,
            z: 0,
        });
        ball.setAngularVelocity({
            x: 2,
            y: 0,
            z: 0,
        });

        assert.deepEquals(
            {
                initialState: {
                    ...initialState,
                    rotation: roundCoords(initialState.rotation),
                    sleepThreshold: round(initialState.sleepThreshold, {
                        digits: 3,
                    }),
                },
                position: ball.getPosition(),
                rotation: ball.getRotation(),
                velocity: ball.getVelocity(),
                angularVelocity: ball.getAngularVelocity(),
            },
            {
                initialState: {
                    position: {
                        x: 1,
                        y: 2,
                        z: 3,
                    },
                    rotation: roundCoords(quarterTurnAroundY),
                    velocity: {
                        x: 3,
                        y: 4,
                        z: 5,
                    },
                    angularVelocity: {
                        x: 0,
                        y: 1,
                        z: 0,
                    },
                    type: BodyType.Dynamic,
                    gravityScale: 1,
                    linearDamping: 0,
                    angularDamping: 0,
                    sleepThreshold: 0.05,
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
                    material: {},
                    shapes: undefined,
                    massData: undefined,
                },
                position: {
                    x: 10,
                    y: 20,
                    z: 30,
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
                    x: 2,
                    y: 0,
                    z: 0,
                },
            },
        );
        world.destroy();
    });

    it('snaps the previous transform on teleports but not on steps', async () => {
        const world = await PhysicsWorld3d.create();
        const ball = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                velocity: {
                    x: 1,
                    y: 0,
                    z: 0,
                },
            },
        });

        world.step(1);
        ball.recordStep();
        const afterStep = {
            previous: ball.previousTransform.position.x,
            current: ball.currentTransform.position.x,
        };
        ball.setPosition({
            x: 5,
            y: 0,
            z: 0,
        });
        const afterTeleport = {
            previous: ball.previousTransform.position.x,
            current: ball.currentTransform.position.x,
        };
        ball.setRotation({
            x: 1,
            y: 0,
            z: 0,
            w: 0,
        });

        assert.deepEquals(
            {
                afterStep,
                afterTeleport,
                rotationsMatch: ball.previousTransform.rotation === ball.currentTransform.rotation,
            },
            {
                afterStep: {
                    previous: 0,
                    current: 1,
                },
                afterTeleport: {
                    previous: 5,
                    current: 5,
                },
                rotationsMatch: true,
            },
        );
        world.destroy();
    });

    it('keeps bodies without shapes moving', async () => {
        const world = await PhysicsWorld3d.create();
        const spinner = world.createBody({
            definition: {
                type: BodyType.Kinematic,
            },
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                angularVelocity: {
                    x: 0,
                    y: 2,
                    z: 0,
                },
            },
        });
        createArray(240, () => world.step(1 / 120));

        assert.deepEquals(spinner.getAngularVelocity(), {
            x: 0,
            y: 2,
            z: 0,
        });
        world.destroy();
    });

    it('applies forces and impulses', async () => {
        const world = await PhysicsWorld3d.create();
        const pushed = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {},
        });
        const kicked = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 2,
            bodyState: {
                position: {
                    x: 10,
                    y: 0,
                    z: 0,
                },
            },
        });

        pushed.applyForce({
            x: pushed.getMass(),
            y: 0,
            z: 0,
        });
        kicked.applyImpulse({
            x: 0,
            y: 0,
            z: kicked.getMass(),
        });
        world.step(1);

        assert.deepEquals(
            {
                pushed: roundCoords(pushed.getVelocity()),
                kicked: roundCoords(kicked.getVelocity()),
            },
            {
                pushed: {
                    x: 1,
                    y: 0,
                    z: 0,
                },
                kicked: {
                    x: 0,
                    y: 0,
                    z: 1,
                },
            },
        );
        world.destroy();
    });

    it('reads contact normals pointing toward each body', async () => {
        const world = await PhysicsWorld3d.create();
        const ball = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {},
        });
        const wall = world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Box,
                        width: 1,
                        height: 10,
                        depth: 10,
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 2,
            bodyState: {
                position: {
                    x: 1.25,
                    y: 0,
                    z: 0,
                },
            },
        });
        const contactsBeforeStep = ball.getContacts();
        world.step(1 / 60);
        const [
            ballContact,
        ] = ball.getContacts();
        const [
            wallContact,
        ] = wall.getContacts();

        assert.deepEquals(
            {
                contactsBeforeStep,
                ballNormal: roundCoords(
                    ballContact?.normal || {
                        x: 0,
                        y: 0,
                        z: 0,
                    },
                ),
                wallNormal: roundCoords(
                    wallContact?.normal || {
                        x: 0,
                        y: 0,
                        z: 0,
                    },
                ),
                isOverlapping: (ballContact?.separation ?? 0) < 0,
                otherBodyTypes: [
                    ballContact?.otherBodyType,
                    wallContact?.otherBodyType,
                ],
            },
            {
                contactsBeforeStep: [],
                ballNormal: {
                    x: -1,
                    y: 0,
                    z: 0,
                },
                wallNormal: {
                    x: 1,
                    y: 0,
                    z: 0,
                },
                isOverlapping: true,
                otherBodyTypes: [
                    BodyType.Static,
                    BodyType.Dynamic,
                ],
            },
        );
        world.destroy();
    });

    it('reports contacts between entity ids', async () => {
        const world = await PhysicsWorld3d.create();
        world.createBody({
            definition: {
                type: BodyType.Dynamic,
                shapes: [
                    {
                        type: ShapeType.Sphere,
                        radius: 1,
                        material: {
                            restitution: 1,
                        },
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 7,
            bodyState: {
                velocity: {
                    x: 10,
                    y: 0,
                    z: 0,
                },
            },
        });
        world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Box,
                        width: 1,
                        height: 10,
                        depth: 10,
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 9,
            bodyState: {
                position: {
                    x: 3,
                    y: 0,
                    z: 0,
                },
            },
        });
        const results = createArray(60, () => world.step(1 / 60));

        assert.deepEquals(
            {
                started: results.flatMap((result) => result.started).map((pair) => pair.toSorted()),
                ended: results.flatMap((result) => result.ended).map((pair) => pair.toSorted()),
            },
            {
                started: [
                    [
                        7,
                        9,
                    ],
                ],
                ended: [
                    [
                        7,
                        9,
                    ],
                ],
            },
        );
        world.destroy();
    });

    async function startContactsWithWall({
        ballDefinitionOverride,
        ballFilter,
        wallFilter,
    }: Readonly<
        PartialWithUndefined<{
            ballDefinitionOverride: EntityPhysicsDefinition;
            ballFilter: Readonly<typeof touchingFilter>;
            wallFilter: Readonly<typeof touchingFilter>;
        }>
    >) {
        const world = await PhysicsWorld3d.create();
        world.createBody({
            definition: ballDefinitionOverride || ballDefinition,
            filter: ballFilter || touchingFilter,
            entityId: 1,
            bodyState: {},
        });
        world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Box,
                        width: 1,
                        height: 10,
                        depth: 10,
                    },
                ],
            },
            filter: wallFilter || touchingFilter,
            entityId: 2,
            bodyState: {
                position: {
                    x: 1.25,
                    y: 0,
                    z: 0,
                },
            },
        });
        const {started} = world.step(1 / 60);
        world.destroy();
        return started.length;
    }

    it('only touches bodies whose filters accept each other', async () => {
        assert.deepEquals(
            {
                crossed: await startContactsWithWall({
                    ballFilter: {
                        category: 1n,
                        mask: 2n,
                    },
                    wallFilter: {
                        category: 2n,
                        mask: 1n,
                    },
                }),
                separate: await startContactsWithWall({
                    ballFilter: {
                        category: 1n,
                        mask: 1n,
                    },
                    wallFilter: {
                        category: 2n,
                        mask: 2n,
                    },
                }),
            },
            {
                crossed: 1,
                separate: 0,
            },
        );
    });

    it('places shapes at their offset', async () => {
        assert.deepEquals(
            {
                centered: await startContactsWithWall({}),
                offset: await startContactsWithWall({
                    ballDefinitionOverride: {
                        type: BodyType.Dynamic,
                        shapes: [
                            {
                                type: ShapeType.Sphere,
                                radius: 1,
                                offset: {
                                    x: -3,
                                    y: 0,
                                    z: 0,
                                },
                            },
                        ],
                    },
                }),
            },
            {
                centered: 1,
                offset: 0,
            },
        );
    });

    it('locks motion along and around locked axes', async () => {
        const world = await PhysicsWorld3d.create();
        const body = world.createBody({
            definition: {
                ...ballDefinition,
                motionLocks: {
                    linearY: true,
                    angularX: true,
                    angularY: true,
                    angularZ: true,
                },
            },
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                velocity: {
                    x: 1,
                    y: 2,
                    z: 3,
                },
                angularVelocity: {
                    x: 1,
                    y: 2,
                    z: 3,
                },
            },
        });
        world.step(1 / 60);

        assert.deepEquals(
            {
                velocity: roundCoords(body.getVelocity()),
                angularVelocity: roundCoords(body.getAngularVelocity()),
            },
            {
                velocity: {
                    x: 1,
                    y: 0,
                    z: 3,
                },
                angularVelocity: {
                    x: 0,
                    y: 0,
                    z: 0,
                },
            },
        );
        world.destroy();
    });

    it('reads and changes body settings', async () => {
        const world = await PhysicsWorld3d.create();
        world.setGravity({
            x: 0,
            y: -10,
            z: 0,
        });
        const floating = world.createBody({
            definition: {
                ...ballDefinition,
                gravityScale: 0,
                isBullet: true,
                motionLocks: {
                    linearZ: true,
                },
            },
            filter: touchingFilter,
            entityId: 1,
            bodyState: {},
        });
        const disabled = world.createBody({
            definition: {
                ...ballDefinition,
                isDisabled: true,
            },
            filter: touchingFilter,
            entityId: 2,
            bodyState: {
                position: {
                    x: 10,
                    y: 0,
                    z: 0,
                },
            },
        });
        /** Body state wins over the definition, as when loading a snapshot. */
        const restored = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 3,
            bodyState: {
                ...floating.getState(),
                position: {
                    x: 20,
                    y: 0,
                    z: 0,
                },
            },
        });
        world.step(1 / 60);
        const initial = {
            floating: floating.getState(),
            disabled: disabled.getState(),
            restoredVelocityY: restored.getVelocity().y,
        };

        floating.setType(BodyType.Kinematic);
        floating.setBullet(false);
        floating.setGravityScale(3);
        floating.setMotionLocks({
            angularY: true,
        });
        disabled.setEnabled(true);
        restored.setAwake(false);

        assert.deepEquals(
            {
                floating: selectFrom(initial.floating, {
                    velocity: true,
                    type: true,
                    gravityScale: true,
                    isDisabled: true,
                    isBullet: true,
                    motionLocks: {
                        linearZ: true,
                        angularY: true,
                    },
                }),
                disabledPosition: initial.disabled.position,
                disabledIsDisabled: initial.disabled.isDisabled,
                restoredVelocityY: initial.restoredVelocityY,
                changed: {
                    type: floating.getType(),
                    isBullet: floating.isBullet(),
                    gravityScale: floating.getGravityScale(),
                    motionLocks: selectFrom(floating.getMotionLocks(), {
                        linearZ: true,
                        angularY: true,
                    }),
                    disabledIsEnabled: disabled.isEnabled(),
                    restoredIsAwake: restored.isAwake(),
                    floatingIsAwake: floating.isAwake(),
                },
            },
            {
                floating: {
                    velocity: {
                        x: 0,
                        y: 0,
                        z: 0,
                    },
                    type: BodyType.Dynamic,
                    gravityScale: 0,
                    isDisabled: false,
                    isBullet: true,
                    motionLocks: {
                        linearZ: true,
                        angularY: false,
                    },
                },
                disabledPosition: {
                    x: 10,
                    y: 0,
                    z: 0,
                },
                disabledIsDisabled: true,
                restoredVelocityY: 0,
                changed: {
                    type: BodyType.Kinematic,
                    isBullet: false,
                    gravityScale: 3,
                    motionLocks: {
                        linearZ: false,
                        angularY: true,
                    },
                    disabledIsEnabled: true,
                    restoredIsAwake: false,
                    floatingIsAwake: true,
                },
            },
        );
        world.destroy();
    });

    it('reports hits faster than the threshold, as each entity sees them', async () => {
        async function collectHits(threshold: number | undefined) {
            const world = await PhysicsWorld3d.create();
            if (threshold != undefined) {
                world.setHitEventThreshold(threshold);
            }
            world.createBody({
                definition: {
                    ...ballDefinition,
                    enableHitEvents: true,
                },
                filter: touchingFilter,
                entityId: 1,
                bodyState: {
                    velocity: {
                        x: 10,
                        y: 0,
                        z: 0,
                    },
                },
            });
            createWall(world);
            const hits = createArray(60, () => world.step(1 / 60)).flatMap((events) => {
                return events.hits;
            });
            const hitEventThreshold = world.getHitEventThreshold();
            world.reset();
            world.destroy();
            return {
                hitEventThreshold,
                hits: hits
                    .toSorted((first, second) => first.entityId - second.entityId)
                    .map((hit) => {
                        return {
                            ...hit,
                            hit: {
                                point: mapObjectValues(hit.hit.point, (axis, value) => {
                                    return Math.round(value);
                                }),
                                normal: roundCoords(hit.hit.normal),
                                approachSpeed: Math.round(hit.hit.approachSpeed),
                            },
                        };
                    }),
            };
        }

        assert.deepEquals(
            {
                defaultThreshold: await collectHits(undefined),
                highThreshold: await collectHits(100),
            },
            {
                defaultThreshold: {
                    hitEventThreshold: 1,
                    hits: [
                        {
                            entityId: 1,
                            otherEntityId: 3,
                            hit: {
                                point: {
                                    x: 4,
                                    y: 0,
                                    z: 0,
                                },
                                normal: {
                                    x: -1,
                                    y: 0,
                                    z: 0,
                                },
                                approachSpeed: 10,
                            },
                        },
                        {
                            entityId: 3,
                            otherEntityId: 1,
                            hit: {
                                point: {
                                    x: 4,
                                    y: 0,
                                    z: 0,
                                },
                                normal: {
                                    x: 1,
                                    y: 0,
                                    z: 0,
                                },
                                approachSpeed: 10,
                            },
                        },
                    ],
                },
                highThreshold: {
                    hitEventThreshold: 100,
                    hits: [],
                },
            },
        );
    });

    it('reports entities entering and leaving sensors', async () => {
        const world = await PhysicsWorld3d.create();
        world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Box,
                        width: 2,
                        height: 2,
                        depth: 2,
                        isSensor: true,
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 5,
            bodyState: {
                position: {
                    x: 5,
                    y: 0,
                    z: 0,
                },
            },
        });
        const passing = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                velocity: {
                    x: 10,
                    y: 0,
                    z: 0,
                },
            },
        });
        const destroyed = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 2,
            bodyState: {
                position: {
                    x: 5,
                    y: 0,
                    z: 0,
                },
            },
        });
        const firstStep = world.step(1 / 60);
        world.destroyBody(destroyed);
        const steps = [
            firstStep,
            ...createArray(119, () => world.step(1 / 60)),
        ];

        assert.deepEquals(
            {
                started: steps.flatMap((step) => step.sensorStarted),
                ended: steps.flatMap((step) => step.sensorEnded),
                contacts: steps.flatMap((step) => step.started),
                passedThrough: passing.getPosition().x > 10,
            },
            {
                started: [
                    [
                        5,
                        2,
                    ],
                    [
                        5,
                        1,
                    ],
                ],
                ended: [
                    [
                        5,
                        1,
                    ],
                ],
                contacts: [],
                passedThrough: true,
            },
        );
        world.destroy();
    });

    it('finds overlapping entities once each', async () => {
        const world = await PhysicsWorld3d.create();
        world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Sphere,
                        radius: 1,
                    },
                    {
                        type: ShapeType.Sphere,
                        radius: 1,
                        offset: {
                            x: 1,
                            y: 0,
                            z: 0,
                        },
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 1,
            bodyState: {},
        });
        createWall(world);
        world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Sphere,
                        radius: 1,
                        isSensor: true,
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 4,
            bodyState: {},
        });
        world.createBody({
            definition: ballDefinition,
            filter: {
                category: 2n,
                mask: 2n,
            },
            entityId: 5,
            bodyState: {},
        });
        const everything = {
            lowerBound: {
                x: -10,
                y: -10,
                z: -10,
            },
            upperBound: {
                x: 10,
                y: 10,
                z: 10,
            },
        };

        assert.deepEquals(
            {
                everything: world.overlapBox(everything).toSorted(),
                filtered: world
                    .overlapBox({
                        ...everything,
                        filter: touchingFilter,
                    })
                    .toSorted(),
                nearOrigin: world
                    .overlapShape({
                        shape: {
                            type: ShapeType.Box,
                            width: 1,
                            height: 1,
                            depth: 1,
                        },
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
                    })
                    .toSorted(),
                nearWall: world.overlapShape({
                    shape: {
                        type: ShapeType.Sphere,
                        radius: 0.5,
                    },
                    position: {
                        x: 3.75,
                        y: 0,
                        z: 0,
                    },
                    filter: touchingFilter,
                }),
                nothing: world.overlapShape({
                    shape: {
                        type: ShapeType.Sphere,
                        radius: 0.5,
                    },
                    position: {
                        x: 0,
                        y: 50,
                        z: 0,
                    },
                }),
            },
            {
                everything: [
                    1,
                    3,
                    4,
                    5,
                ],
                filtered: [
                    1,
                    3,
                    4,
                ],
                nearOrigin: [
                    1,
                    4,
                    5,
                ],
                nearWall: [
                    3,
                ],
                nothing: [],
            },
        );
        world.destroy();
    });

    it('slows bodies with damping', async () => {
        const world = await PhysicsWorld3d.create();
        world.setGravity({
            x: 0,
            y: 0,
            z: 0,
        });
        const body = world.createBody({
            definition: {
                ...ballDefinition,
                linearDamping: 1,
                angularDamping: 1,
            },
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                velocity: {
                    x: 1,
                    y: 0,
                    z: 0,
                },
                angularVelocity: {
                    x: 1,
                    y: 0,
                    z: 0,
                },
            },
        });
        world.step(1);

        assert.deepEquals(
            {
                velocity: roundCoords(body.getVelocity()),
                angularVelocity: roundCoords(body.getAngularVelocity()),
            },
            {
                velocity: {
                    x: 0.41,
                    y: 0,
                    z: 0,
                },
                angularVelocity: {
                    x: 0.402,
                    y: 0,
                    z: 0,
                },
            },
        );
        world.destroy();
    });

    it('skips end contacts of destroyed bodies', async () => {
        const world = await PhysicsWorld3d.create();
        const first = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {},
        });
        world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 2,
            bodyState: {
                position: {
                    x: 1,
                    y: 0,
                    z: 0,
                },
            },
        });
        const firstStep = world.step(1 / 60);
        world.destroyBody(first);
        world.destroyBody(first);
        const secondStep = world.step(1 / 60);

        assert.deepEquals(
            {
                firstStarted: firstStep.started.map((pair) => pair.toSorted()),
                secondEnded: secondStep.ended,
            },
            {
                firstStarted: [
                    [
                        1,
                        2,
                    ],
                ],
                secondEnded: [],
            },
        );
        world.destroy();
    });

    it('removes every body on reset', async () => {
        const world = await PhysicsWorld3d.create();
        world.setGravity({
            x: 0,
            y: -1,
            z: 0,
        });
        const ball = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {},
        });
        world.reset();
        world.destroyBody(ball);
        const freshBall = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {},
        });
        world.step(1);

        assert.deepEquals(freshBall.getVelocity(), {
            x: 0,
            y: -1,
            z: 0,
        });
        world.destroy();
    });
    it('pushes and spins bodies at points', async () => {
        const world = await PhysicsWorld3d.create();
        const [
            pushed,
            kicked,
            twisted,
            spun,
        ] = createArray(4, (index) => {
            return world.createBody({
                definition: ballDefinition,
                filter: {
                    category: 1n,
                    mask: 0n,
                },
                entityId: index + 1,
                bodyState: {
                    position: {
                        x: index * 10,
                        y: 0,
                        z: 0,
                    },
                },
            });
        });
        /** A solid sphere of radius 1 resists spinning with 2/5 of its mass. */
        const inertia = (pushed.getMass() * 2) / 5;
        const stepSeconds = 1 / 60;

        pushed.applyForceAtPoint({
            force: {
                x: 0,
                y: pushed.getMass() / stepSeconds,
                z: 0,
            },
            point: {
                x: 1,
                y: 0,
                z: 0,
            },
        });
        kicked.applyImpulseAtPoint({
            impulse: {
                x: 0,
                y: kicked.getMass(),
                z: 0,
            },
            point: {
                x: 11,
                y: 0,
                z: 0,
            },
        });
        twisted.applyTorque({
            x: inertia / stepSeconds,
            y: 0,
            z: 0,
        });
        spun.applyAngularImpulse({
            x: 0,
            y: inertia,
            z: 0,
        });
        world.step(stepSeconds);

        assert.deepEquals(
            [
                pushed,
                kicked,
                twisted,
                spun,
            ].map((body) => {
                return {
                    velocity: roundCoords(body.getVelocity()),
                    angularVelocity: roundCoords(body.getAngularVelocity()),
                };
            }),
            [
                {
                    velocity: {
                        x: 0,
                        y: 1,
                        z: 0,
                    },
                    angularVelocity: {
                        x: 0,
                        y: 0,
                        z: 2.5,
                    },
                },
                {
                    velocity: {
                        x: 0,
                        y: 1,
                        z: 0,
                    },
                    angularVelocity: {
                        x: 0,
                        y: 0,
                        z: 2.5,
                    },
                },
                {
                    velocity: {
                        x: 0,
                        y: 0,
                        z: 0,
                    },
                    angularVelocity: {
                        x: 1,
                        y: 0,
                        z: 0,
                    },
                },
                {
                    velocity: {
                        x: 0,
                        y: 0,
                        z: 0,
                    },
                    angularVelocity: {
                        x: 0,
                        y: 1,
                        z: 0,
                    },
                },
            ],
        );
        world.destroy();
    });

    it('converts points and vectors between body and world space', async () => {
        const world = await PhysicsWorld3d.create();
        const body = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                position: {
                    x: 1,
                    y: 2,
                    z: 3,
                },
                rotation: {
                    x: 0,
                    y: Math.SQRT1_2,
                    z: 0,
                    w: Math.SQRT1_2,
                },
                angularVelocity: {
                    x: 0,
                    y: 0,
                    z: 1,
                },
            },
        });

        assert.deepEquals(
            {
                worldPoint: roundCoords(
                    body.getWorldPoint({
                        x: 1,
                        y: 0,
                        z: 0,
                    }),
                ),
                localPoint: roundCoords(
                    body.getLocalPoint({
                        x: 1,
                        y: 2,
                        z: 2,
                    }),
                ),
                worldVector: roundCoords(
                    body.getWorldVector({
                        x: 1,
                        y: 0,
                        z: 0,
                    }),
                ),
                localVector: roundCoords(
                    body.getLocalVector({
                        x: 0,
                        y: 0,
                        z: -1,
                    }),
                ),
                pointVelocity: roundCoords(
                    body.getPointVelocity({
                        x: 2,
                        y: 2,
                        z: 3,
                    }),
                ),
            },
            {
                worldPoint: {
                    x: 1,
                    y: 2,
                    z: 2,
                },
                localPoint: {
                    x: 1,
                    y: 0,
                    z: 0,
                },
                worldVector: {
                    x: 0,
                    y: 0,
                    z: -1,
                },
                localVector: {
                    x: 1,
                    y: 0,
                    z: 0,
                },
                pointVelocity: {
                    x: 0,
                    y: 1,
                    z: 0,
                },
            },
        );
        world.destroy();
    });

    it('casts rays at the closest matching shape', async () => {
        const world = await PhysicsWorld3d.create();
        createWall(world);
        const ray = {
            origin: {
                x: 0,
                y: 0,
                z: 0,
            },
            translation: {
                x: 10,
                y: 0,
                z: 0,
            },
        };
        const hit = world.castRay(ray);

        assert.deepEquals(
            {
                hit: hit && {
                    ...hit,
                    point: roundCoords(hit.point),
                    normal: roundCoords(hit.normal),
                    fraction: round(hit.fraction, {
                        digits: 3,
                    }),
                },
                filtered: world.castRay({
                    ...ray,
                    filter: {
                        category: 1n,
                        mask: 2n,
                    },
                }),
                missed: world.castRay({
                    ...ray,
                    translation: {
                        x: 0,
                        y: 10,
                        z: 0,
                    },
                }),
            },
            {
                hit: {
                    entityId: 3,
                    point: {
                        x: 4,
                        y: 0,
                        z: 0,
                    },
                    normal: {
                        x: -1,
                        y: 0,
                        z: 0,
                    },
                    fraction: 0.4,
                },
                filtered: undefined,
                missed: undefined,
            },
        );
        world.destroy();
    });

    it('casts every cast shape type', async () => {
        const world = await PhysicsWorld3d.create();
        createWall(world);
        const shapes: ReadonlyArray<
            Readonly<
                {
                    shape: CastShapeDefinition;
                } & PartialWithUndefined<{
                    rotation: Quaternion;
                }>
            >
        > = [
            {
                shape: {
                    type: ShapeType.Sphere,
                    radius: 1,
                },
            },
            {
                shape: {
                    type: ShapeType.Sphere,
                    radius: 1,
                    offset: {
                        x: 1,
                        y: 0,
                        z: 0,
                    },
                },
            },
            {
                shape: {
                    type: ShapeType.Box,
                    width: 2,
                    height: 2,
                    depth: 2,
                },
            },
            {
                shape: {
                    type: ShapeType.Capsule,
                    radius: 1,
                    height: 4,
                },
                /** A quarter turn around z lays the capsule along x. */
                rotation: {
                    x: 0,
                    y: 0,
                    z: Math.SQRT1_2,
                    w: Math.SQRT1_2,
                },
            },
            {
                shape: {
                    type: ShapeType.Hull,
                    points: [
                        {
                            x: 1,
                            y: 0,
                            z: 0,
                        },
                        {
                            x: -1,
                            y: 1,
                            z: 0,
                        },
                        {
                            x: -1,
                            y: -1,
                            z: 1,
                        },
                        {
                            x: -1,
                            y: -1,
                            z: -1,
                        },
                    ],
                },
            },
        ];

        assert.deepEquals(
            {
                fractions: shapes.map(({shape, rotation}) => {
                    const hit = world.castShape({
                        shape,
                        rotation,
                        position: {
                            x: 0,
                            y: 0,
                            z: 0,
                        },
                        translation: {
                            x: 10,
                            y: 0,
                            z: 0,
                        },
                    });
                    return (
                        hit &&
                        round(hit.fraction, {
                            digits: 2,
                        })
                    );
                }),
                filtered: world.castShape({
                    shape: ballDefinition.shapes[0],
                    position: {
                        x: 0,
                        y: 0,
                        z: 0,
                    },
                    translation: {
                        x: 10,
                        y: 0,
                        z: 0,
                    },
                    filter: {
                        category: 2n,
                        mask: 1n,
                    },
                }),
            },
            {
                fractions: [
                    0.3,
                    0.2,
                    0.3,
                    0.2,
                    0.3,
                ],
                filtered: undefined,
            },
        );
        assert.throws(
            () => {
                return world.castShape({
                    shape: {
                        type: ShapeType.Hull,
                        points: createArray(65, (index) => {
                            return {
                                x: Math.cos(index),
                                y: Math.sin(index),
                                z: index / 65,
                            };
                        }),
                    },
                    position: {
                        x: 0,
                        y: 0,
                        z: 0,
                    },
                    translation: {
                        x: 1,
                        y: 0,
                        z: 0,
                    },
                });
            },
            {
                matchMessage: 'A cast shape can have at most 64 points, got 65.',
            },
        );
        world.destroy();
    });

    it('creates hull shapes', async () => {
        const world = await PhysicsWorld3d.create();
        const cube = world.createBody({
            definition: {
                type: BodyType.Dynamic,
                shapes: [
                    {
                        type: ShapeType.Hull,
                        points: createArray(8, (corner) => {
                            return {
                                x: corner % 2 ? 1 : -1,
                                y: Math.floor(corner / 2) % 2 ? 1 : -1,
                                z: corner < 4 ? 1 : -1,
                            };
                        }),
                        offset: {
                            x: 1,
                            y: 0,
                            z: 0,
                        },
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 1,
            bodyState: {},
        });

        assert.throws(
            () => {
                return world.createBody({
                    definition: {
                        type: BodyType.Dynamic,
                        shapes: [
                            {
                                type: ShapeType.Hull,
                                points: createArray(4, (index) => {
                                    return {
                                        x: index,
                                        y: index % 2,
                                        z: 0,
                                    };
                                }),
                            },
                        ],
                    },
                    filter: touchingFilter,
                    entityId: 2,
                    bodyState: {},
                });
            },
            {
                matchMessage: 'Hull points must not all lie on one plane.',
            },
        );
        assert.deepEquals(
            {
                mass: Math.round(cube.getMass()),
                rayHit: world.castRay({
                    origin: {
                        x: 5,
                        y: 0,
                        z: 0,
                    },
                    translation: {
                        x: -10,
                        y: 0,
                        z: 0,
                    },
                })?.entityId,
            },
            {
                mass: 8000,
                rayHit: 1,
            },
        );
        world.destroy();
    });

    it('creates static mesh and height field shapes', async () => {
        const world = await PhysicsWorld3d.create();
        const floor = world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Mesh,
                        vertices: [
                            {
                                x: -1,
                                y: 0,
                                z: -1,
                            },
                            {
                                x: 1,
                                y: 0,
                                z: -1,
                            },
                            {
                                x: 1,
                                y: 0,
                                z: 1,
                            },
                            {
                                x: -1,
                                y: 0,
                                z: 1,
                            },
                        ],
                        triangles: [
                            [
                                0,
                                2,
                                1,
                            ],
                            [
                                0,
                                3,
                                2,
                            ],
                        ],
                        offset: {
                            x: 0,
                            y: -1,
                            z: 0,
                        },
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 1,
            bodyState: {},
        });
        world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.HeightField,
                        heights: [
                            [
                                0,
                                0,
                                0,
                                0,
                            ],
                            [
                                0,
                                0,
                                4,
                                0,
                            ],
                            [
                                0,
                                0,
                                0,
                                0,
                            ],
                        ],
                        scale: {
                            x: 1,
                            y: 0.5,
                            z: 2,
                        },
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 2,
            bodyState: {
                position: {
                    x: 10,
                    y: 0,
                    z: 0,
                },
            },
        });
        function castDown({
            x,
            z,
        }: Readonly<{
            x: number;
            z: number;
        }>) {
            const hit = world.castRay({
                origin: {
                    x,
                    y: 10,
                    z,
                },
                translation: {
                    x: 0,
                    y: -20,
                    z: 0,
                },
            });
            return (
                hit && {
                    entityId: hit.entityId,
                    point: roundCoords(hit.point),
                    normal: roundCoords(hit.normal),
                }
            );
        }
        const heightFieldPoints = [
            castDown({
                x: 12,
                z: 2,
            }),
            castDown({
                x: 10.5,
                z: 0.5,
            }),
        ].map((hit) => hit?.point);
        const meshHit = castDown({
            x: 0,
            z: 0,
        });
        world.destroyBody(floor);

        assert.deepEquals(
            {
                meshHit,
                heightFieldPoints,
                afterDestroy: castDown({
                    x: 0,
                    z: 0,
                }),
            },
            {
                meshHit: {
                    entityId: 1,
                    point: {
                        x: 0,
                        y: -1,
                        z: 0,
                    },
                    normal: {
                        x: 0,
                        y: 1,
                        z: 0,
                    },
                },
                heightFieldPoints: [
                    {
                        x: 12,
                        y: 2,
                        z: 2,
                    },
                    {
                        x: 10.5,
                        y: 0,
                        z: 0.5,
                    },
                ],
                afterDestroy: undefined,
            },
        );
        world.destroy();
    });

    it('rejects invalid shapes before creating the body', async () => {
        const world = await PhysicsWorld3d.create();
        const flatSquare = {
            vertices: [
                {
                    x: 0,
                    y: 0,
                    z: 0,
                },
                {
                    x: 1,
                    y: 0,
                    z: 0,
                },
                {
                    x: 0,
                    y: 0,
                    z: 1,
                },
            ],
            triangles: [
                [
                    0,
                    1,
                    2,
                ],
            ],
        } as const;
        const flatHeights = createArray(2, () => {
            return [
                0,
                0,
            ];
        });
        const invalidShapes: ReadonlyArray<
            Readonly<{
                definition: EntityPhysicsDefinition;
                message: string;
            }>
        > = [
            {
                definition: {
                    type: BodyType.Dynamic,
                    shapes: [
                        {
                            type: ShapeType.Mesh,
                            ...flatSquare,
                        },
                    ],
                },
                message: 'A mesh shape is only allowed on a static body.',
            },
            {
                definition: {
                    type: BodyType.Static,
                    shapes: [
                        {
                            type: ShapeType.Mesh,
                            ...flatSquare,
                            triangleMaterials: [],
                        },
                    ],
                },
                message: 'A mesh with 1 triangles needs 1 triangle materials, got 0.',
            },
            {
                definition: {
                    type: BodyType.Static,
                    shapes: [
                        {
                            type: ShapeType.Compound,
                            children: [
                                {
                                    type: ShapeType.Mesh,
                                    vertices: flatSquare.vertices,
                                    triangles: createArray(5, () => flatSquare.triangles[0]),
                                    triangleMaterials: createArray(5, (index) => {
                                        return {
                                            friction: index,
                                        };
                                    }),
                                },
                            ],
                        },
                    ],
                },
                message: 'This mesh can have at most 4 different triangle materials, got 5.',
            },
            {
                definition: {
                    type: BodyType.Static,
                    shapes: [
                        {
                            type: ShapeType.Compound,
                            children: [],
                        },
                    ],
                },
                message: 'A compound needs at least 1 child.',
            },
            {
                definition: {
                    type: BodyType.Static,
                    shapes: [
                        {
                            type: ShapeType.HeightField,
                            heights: flatHeights,
                            scale: {
                                x: 1,
                                y: 1,
                                z: 1,
                            },
                            cellMaterials: [
                                [
                                    {},
                                ],
                                [
                                    {},
                                ],
                            ],
                        },
                    ],
                },
                message:
                    'Height field cell materials must be 1 rows of 1, one less than the heights each way.',
            },
            {
                definition: {
                    type: BodyType.Static,
                    shapes: [
                        {
                            type: ShapeType.HeightField,
                            heights: flatHeights,
                            scale: {
                                x: 1,
                                y: 1,
                                z: 1,
                            },
                            heightRange: {
                                minimum: 1,
                                maximum: 0,
                            },
                        },
                    ],
                },
                message: 'Height field height range minimum (1) must not be above its maximum (0).',
            },
            {
                definition: {
                    type: BodyType.Static,
                    shapes: [
                        {
                            type: ShapeType.HeightField,
                            heights: createArray(17, () => createArray(17, () => 0)),
                            scale: {
                                x: 1,
                                y: 1,
                                z: 1,
                            },
                            cellMaterials: createArray(16, (row) => {
                                return createArray(16, (column) => {
                                    return {
                                        friction: row * 16 + column,
                                    };
                                });
                            }),
                        },
                    ],
                },
                message: 'A height field can have at most 255 different cell materials, got 256.',
            },
            {
                definition: {
                    type: BodyType.Static,
                    shapes: [
                        {
                            type: ShapeType.HeightField,
                            heights: flatHeights,
                            scale: {
                                x: 1,
                                y: 1,
                                z: 1,
                            },
                            holes: [
                                {
                                    row: 0,
                                    column: 1,
                                },
                            ],
                        },
                    ],
                },
                message: 'Height field hole at row 0, column 1 is not a cell.',
            },
            {
                definition: {
                    type: BodyType.Dynamic,
                    shapes: [
                        {
                            type: ShapeType.Hull,
                            points: flatSquare.vertices,
                        },
                    ],
                },
                message: 'A hull needs at least 4 points, got 3.',
            },
            {
                definition: {
                    type: BodyType.Static,
                    shapes: [
                        {
                            type: ShapeType.Mesh,
                            vertices: flatSquare.vertices,
                            triangles: [],
                        },
                    ],
                },
                message: 'A mesh needs at least 3 vertices and 1 triangle.',
            },
            {
                definition: {
                    type: BodyType.Static,
                    shapes: [
                        {
                            type: ShapeType.Mesh,
                            vertices: flatSquare.vertices,
                            triangles: [
                                [
                                    0,
                                    1,
                                    3,
                                ],
                            ],
                        },
                    ],
                },
                message: 'Mesh triangle index 3 is not a vertex index from 0 to 2.',
            },
            {
                definition: {
                    type: BodyType.Static,
                    shapes: [
                        {
                            type: ShapeType.HeightField,
                            heights: [
                                [
                                    0,
                                    0,
                                ],
                                [
                                    0,
                                ],
                            ],
                            scale: {
                                x: 1,
                                y: 1,
                                z: 1,
                            },
                        },
                    ],
                },
                message:
                    'Height field heights must be at least 2 rows of the same length, each at least 2 long.',
            },
            {
                definition: {
                    type: BodyType.Static,
                    shapes: [
                        {
                            type: ShapeType.HeightField,
                            heights: [
                                [
                                    0,
                                    0,
                                ],
                                [
                                    0,
                                    0,
                                ],
                            ],
                            scale: {
                                x: 1,
                                y: 0,
                                z: 1,
                            },
                        },
                    ],
                },
                message: 'Every height field scale component must be positive.',
            },
            {
                definition: {
                    type: BodyType.Static,
                    shapes: [
                        {
                            type: ShapeType.HeightField,
                            heights: [],
                            scale: {
                                x: 1,
                                y: 1,
                                z: 1,
                            },
                        },
                    ],
                },
                message:
                    'Height field heights must be at least 2 rows of the same length, each at least 2 long.',
            },
        ];

        invalidShapes.forEach(({definition, message}) => {
            assert.throws(
                () => {
                    return world.createBody({
                        definition,
                        filter: touchingFilter,
                        entityId: 1,
                        bodyState: {},
                    });
                },
                {
                    matchMessage: message,
                },
            );
        });
        world.destroy();
    });

    it('creates, updates, and reads every joint type', async () => {
        const world = await PhysicsWorld3d.create();
        const definitions: Record<JointType, JointDefinition3d> = {
            [JointType.Parallel]: {
                type: JointType.Parallel,
                hertz: 5,
                maxTorque: 10,
            },
            [JointType.Distance]: {
                type: JointType.Distance,
                length: 4,
            },
            [JointType.Filter]: {
                type: JointType.Filter,
            },
            [JointType.Motor]: {
                type: JointType.Motor,
                linearVelocity: {
                    x: 1,
                    y: 0,
                    z: 0,
                },
                maxVelocityForce: 10,
            },
            [JointType.Prismatic]: {
                type: JointType.Prismatic,
                enableLimit: true,
                lowerTranslation: -1,
                upperTranslation: 1,
            },
            [JointType.Revolute]: {
                type: JointType.Revolute,
                frameB: ballFrameAtAnchor,
            },
            [JointType.Spherical]: {
                type: JointType.Spherical,
                frameB: ballFrameAtAnchor,
                enableMotor: true,
                maxMotorTorque: 10,
                motorVelocity: {
                    x: 0,
                    y: 1,
                    z: 0,
                },
            },
            [JointType.Weld]: {
                type: JointType.Weld,
                frameB: ballFrameAtAnchor,
                linearHertz: 5,
            },
            [JointType.Wheel]: {
                type: JointType.Wheel,
                enableSpinMotor: true,
                maxSpinTorque: 10,
                spinSpeed: 1,
                enableSteering: true,
                targetSteeringAngle: 0.2,
                maxSteeringTorque: 10,
            },
        };
        const joints = getObjectTypedValues(definitions).map((definition) => {
            return createJoinedPair<JointDefinition3d>(world, definition).joint;
        });
        stepWorld(world, 10);
        joints.forEach((joint) => {
            joint.update({
                constraintHertz: 30,
                collideConnected: true,
            });
        });
        stepWorld(world, 10);

        assert.deepEquals(
            {
                definitions: joints.map((joint) => joint.getDefinition()),
                /** `JSON.stringify` writes `NaN` and `Infinity` as `null`. */
                areReadingsFinite: joints.every((joint) => {
                    return !JSON.stringify(joint.read()).includes('null');
                }),
                areDefinitionsValid: getObjectTypedValues(definitions).every((definition) => {
                    return checkValidShape(definition, world.jointDefinitionShape);
                }),
                isUnknownTypeValid: checkValidShape(
                    {
                        type: 'rope',
                    },
                    world.jointDefinitionShape,
                ),
            },
            {
                definitions: getObjectTypedValues(definitions).map((definition) => {
                    return {
                        ...definition,
                        constraintHertz: 30,
                        collideConnected: true,
                    };
                }),
                areReadingsFinite: true,
                areDefinitionsValid: true,
                isUnknownTypeValid: false,
            },
        );
        world.destroy();
    });

    it('keeps a distance joint at its length', async () => {
        const world = await PhysicsWorld3d.create();
        world.setGravity(downwardGravity);
        const {ball, joint} = createJoinedPair(world, {
            type: JointType.Distance,
            length: 4,
        });
        stepWorld(world, 60);
        const position = ball.getPosition();

        assert.deepEquals(
            {
                distance: round(Math.hypot(position.x, position.y, position.z), {
                    digits: 2,
                }),
                length: round(joint.read().length, {
                    digits: 2,
                }),
                hasSwung: position.y < -1,
            },
            {
                distance: 4,
                length: 4,
                hasSwung: true,
            },
        );
        world.destroy();
    });

    it('drives a revolute motor at its updated speed', async () => {
        const world = await PhysicsWorld3d.create();
        const {ball, joint} = createJoinedPair(world, {
            type: JointType.Revolute,
            frameB: ballFrameAtAnchor,
            enableMotor: true,
            /** Box3D's default density is water's, so the ball weighs about 4,000 kg. */
            maxMotorTorque: 1_000_000,
            motorSpeed: 2,
        });
        stepWorld(world, 30);
        const firstSpeed = ball.getAngularVelocity().z;
        joint.update({
            motorSpeed: -1,
        });
        stepWorld(world, 30);

        assert.deepEquals(
            {
                firstSpeed: round(firstSpeed, {
                    digits: 1,
                }),
                secondSpeed: round(ball.getAngularVelocity().z, {
                    digits: 1,
                }),
                motorSpeed: joint.getDefinition().motorSpeed,
            },
            {
                firstSpeed: 2,
                secondSpeed: -1,
                motorSpeed: -1,
            },
        );
        world.destroy();
    });

    it('reports joints pulling harder than their thresholds', async () => {
        const world = await PhysicsWorld3d.create();
        world.setGravity(downwardGravity);
        const {joint} = createJoinedPair(world, {
            type: JointType.Weld,
            frameB: ballFrameAtAnchor,
            forceThreshold: 1,
        });
        const strainedSteps = stepWorld(world, 3).map((step) => step.strainedJoints);
        joint.update({
            forceThreshold: undefined,
        });
        const relaxedSteps = stepWorld(world, 3).map((step) => step.strainedJoints);

        assert.deepEquals(
            {
                strainedSteps,
                relaxedSteps,
            },
            {
                strainedSteps: createArray(3, () => {
                    return [
                        7,
                    ];
                }),
                relaxedSteps: createArray(3, () => []),
            },
        );
        world.destroy();
    });

    it('releases bodies from destroyed joints', async () => {
        const world = await PhysicsWorld3d.create();
        world.setGravity(downwardGravity);
        const {ball, joint} = createJoinedPair(world, {
            type: JointType.Weld,
            frameB: ballFrameAtAnchor,
        });
        stepWorld(world, 30);
        const heldY = ball.getPosition().y;
        world.destroyJoint(joint);
        world.destroyJoint(joint);
        stepWorld(world, 30);

        const other = createJoinedPair(world, {
            type: JointType.Weld,
        });
        world.destroyBody(other.ball);
        world.destroyJoint(other.joint);

        assert.deepEquals(
            {
                heldY:
                    round(heldY, {
                        digits: 1,
                    }) + 0,
                hasFallen: ball.getPosition().y < -1,
            },
            {
                heldY: 0,
                hasFallen: true,
            },
        );
        world.destroy();
    });

    it('changes shape materials and keeps them in body state', async () => {
        const world = await PhysicsWorld3d.create();
        const wall = createWall(world);
        const ball = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                position: {
                    x: 5,
                    y: 3,
                    z: 0,
                },
                velocity: {
                    x: 0,
                    y: -10,
                    z: 0,
                },
            },
        });
        const originalMass = ball.getMass();
        ball.setMaterial({
            density: 2000,
            restitution: 1,
        });
        ball.setMaterial({
            friction: 0.1,
            restitution: undefined,
        });
        const copy = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 2,
            bodyState: {
                position: {
                    x: 20,
                    y: 0,
                    z: 0,
                },
                material: ball.getState().material,
            },
        });
        stepWorld(world, 30);

        assert.deepEquals(
            {
                masses: [
                    originalMass,
                    ball.getMass(),
                    copy.getMass(),
                ].map((mass) => {
                    return round(mass, {
                        digits: 0,
                    });
                }),
                material: ball.getMaterial(),
                copyMaterial: copy.getMaterial(),
                isBouncingUp: ball.getVelocity().y > 5,
                wallMaterial: wall.getState().material,
            },
            {
                masses: [
                    4189,
                    8378,
                    8378,
                ],
                material: {
                    density: 2000,
                    restitution: 1,
                    friction: 0.1,
                },
                copyMaterial: {
                    density: 2000,
                    restitution: 1,
                    friction: 0.1,
                },
                isBouncingUp: true,
                wallMaterial: {},
            },
        );
        world.destroy();
    });

    it('moves kinematic bodies to their target transforms', async () => {
        const world = await PhysicsWorld3d.create();
        const platform = world.createBody({
            definition: {
                type: BodyType.Kinematic,
                shapes: ballDefinition.shapes,
            },
            filter: touchingFilter,
            entityId: 1,
            bodyState: {},
        });
        const tilt = {
            x: 0,
            y: 0,
            z: Math.sin(0.1),
            w: Math.cos(0.1),
        };
        platform.setTargetTransform({
            position: {
                x: 1,
                y: 2,
                z: 3,
            },
            rotation: tilt,
            stepSeconds: 1 / 60,
        });
        world.step(1 / 60);
        const first = {
            position: roundCoords(platform.getPosition()),
            rotation: roundCoords(platform.getRotation()),
        };
        platform.setTargetTransform({
            position: {
                x: 3,
                y: 2,
                z: 3,
            },
            stepSeconds: 1 / 60,
        });
        world.step(1 / 60);

        assert.deepEquals(
            {
                first,
                second: {
                    position: roundCoords(platform.getPosition()),
                    rotation: roundCoords(platform.getRotation()),
                },
            },
            {
                first: {
                    position: {
                        x: 1,
                        y: 2,
                        z: 3,
                    },
                    rotation: roundCoords(tilt),
                },
                second: {
                    position: {
                        x: 3,
                        y: 2,
                        z: 3,
                    },
                    rotation: roundCoords(tilt),
                },
            },
        );
        world.destroy();
    });

    it('pushes bodies away from explosions', async () => {
        const world = await PhysicsWorld3d.create();
        const [
            near,
            far,
            masked,
        ] = [
            {
                position: {
                    x: 2,
                    y: 0,
                    z: 0,
                },
                category: 1n,
            },
            {
                position: {
                    x: 20,
                    y: 0,
                    z: 0,
                },
                category: 1n,
            },
            {
                position: {
                    x: 0,
                    y: 2,
                    z: 0,
                },
                category: 2n,
            },
        ].map(({position, category}, index) => {
            return world.createBody({
                definition: ballDefinition,
                filter: {
                    category,
                    mask: 0n,
                },
                entityId: index,
                bodyState: {
                    position,
                },
            });
        });
        world.explode({
            position: {
                x: 0,
                y: 0,
                z: 0,
            },
            radius: 3,
            impulsePerArea: 10_000,
            mask: 1n,
        });
        world.explode({
            position: {
                x: 0,
                y: 0,
                z: 0,
            },
            radius: 3,
            falloff: 1,
            impulsePerArea: 0,
        });

        assert.deepEquals(
            {
                isNearPushedAway: assertWrap.isDefined(near).getVelocity().x > 1,
                nearSideways: roundCoords(
                    selectFrom(assertWrap.isDefined(near).getVelocity(), {
                        y: true,
                        z: true,
                    }),
                ),
                far: assertWrap.isDefined(far).getVelocity(),
                masked: assertWrap.isDefined(masked).getVelocity(),
            },
            {
                isNearPushedAway: true,
                nearSideways: {
                    y: 0,
                    z: 0,
                },
                far: {
                    x: 0,
                    y: 0,
                    z: 0,
                },
                masked: {
                    x: 0,
                    y: 0,
                    z: 0,
                },
            },
        );
        world.destroy();
    });

    it('moves character movers along surfaces', async () => {
        const world = await PhysicsWorld3d.create();
        createWall(world);
        const capsule = {
            center1: {
                x: 0,
                y: -0.25,
                z: 0,
            },
            center2: {
                x: 0,
                y: 0.25,
                z: 0,
            },
            radius: 0.5,
        };
        const origin = {
            x: 0,
            y: 0,
            z: 0,
        };
        const touchingPosition = {
            x: 3.5,
            y: 0,
            z: 0,
        };
        const planes = world.collideMover({
            capsule,
            position: touchingPosition,
        });
        const blockedPlane = assertWrap.isDefined(planes[0]);

        assert.deepEquals(
            {
                towardWall: round(
                    world.castMover({
                        capsule,
                        position: origin,
                        translation: {
                            x: 10,
                            y: 0,
                            z: 0,
                        },
                    }),
                    {
                        digits: 2,
                    },
                ),
                awayFromWall: world.castMover({
                    capsule,
                    position: origin,
                    translation: {
                        x: -10,
                        y: 0,
                        z: 0,
                    },
                }),
                filteredOut: world.castMover({
                    capsule,
                    position: origin,
                    translation: {
                        x: 10,
                        y: 0,
                        z: 0,
                    },
                    filter: {
                        category: 2n,
                        mask: 2n,
                    },
                }),
                planes: planes.map((plane) => {
                    return {
                        entityId: plane.entityId,
                        normal: roundCoords(plane.normal),
                        offset: round(plane.offset, {
                            digits: 2,
                        }),
                        point: roundCoords(plane.point),
                    };
                }),
                nothingNearby: world.collideMover({
                    capsule,
                    position: origin,
                }),
                filteredPlanes: world.collideMover({
                    capsule,
                    position: touchingPosition,
                    filter: {
                        category: 2n,
                        mask: 2n,
                    },
                }),
                solved: mapObjectValues(
                    world.solveMoverPlanes({
                        planes,
                        targetDelta: {
                            x: 1,
                            y: 1,
                            z: 0,
                        },
                        velocity: {
                            x: 5,
                            y: 5,
                            z: 0,
                        },
                    }),
                    (key, value) => {
                        return roundCoords(value);
                    },
                ),
                soft: world.solveMoverPlanes({
                    planes: [
                        {
                            ...blockedPlane,
                            pushLimit: 0,
                            isSoft: true,
                        },
                    ],
                    targetDelta: {
                        x: 1,
                        y: 1,
                        z: 0,
                    },
                    velocity: {
                        x: 5,
                        y: 5,
                        z: 0,
                    },
                }),
            },
            {
                towardWall: 0.35,
                awayFromWall: 1,
                filteredOut: 1,
                planes: [
                    {
                        entityId: 3,
                        normal: {
                            x: -1,
                            y: 0,
                            z: 0,
                        },
                        offset: 0,
                        point: {
                            x: 4,
                            y: 0,
                            z: 0,
                        },
                    },
                ],
                nothingNearby: [],
                filteredPlanes: [],
                solved: {
                    delta: {
                        x: 0.005,
                        y: 1,
                        z: 0,
                    },
                    velocity: {
                        x: 0,
                        y: 5,
                        z: 0,
                    },
                },
                soft: {
                    delta: {
                        x: 1,
                        y: 1,
                        z: 0,
                    },
                    velocity: {
                        x: 5,
                        y: 5,
                        z: 0,
                    },
                },
            },
        );
        world.destroy();
    });

    it('only collides one-way shapes from the side they point to', async () => {
        /** A 20 wide, 2 tall, 20 deep platform centered on the origin, under downward gravity. */
        async function createPlatformWorld(rotation: Readonly<Quaternion>) {
            const world = await PhysicsWorld3d.create();
            world.setGravity(downwardGravity);
            world.createBody({
                definition: {
                    type: BodyType.Static,
                    shapes: [
                        {
                            type: ShapeType.Box,
                            width: 20,
                            height: 2,
                            depth: 20,
                            oneWayDirection: {
                                x: 0,
                                y: 1,
                                z: 0,
                            },
                        },
                    ],
                },
                filter: touchingFilter,
                entityId: 0,
                bodyState: {
                    rotation,
                },
            });
            return world;
        }
        const world = await createPlatformWorld({
            x: 0,
            y: 0,
            z: 0,
            w: 1,
        });
        const [
            landing,
            risingThrough,
            fastRising,
            fastFalling,
            stoppingHalfway,
        ] = [
            {
                x: -8,
                y: 3,
                velocityY: 0,
            },
            {
                x: -4,
                y: -3,
                velocityY: 12,
            },
            {
                x: 0,
                y: -3,
                velocityY: 400,
            },
            {
                x: 4,
                y: 3,
                velocityY: -400,
            },
            /** Peaks with its center half a meter above the platform's center. */
            {
                x: 8,
                y: -3,
                velocityY: Math.sqrt(2 * 10 * 3.5),
            },
        ].map(({x, y, velocityY}, index) => {
            return world.createBody({
                definition: ballDefinition,
                filter: touchingFilter,
                entityId: index + 1,
                bodyState: {
                    position: {
                        x,
                        y,
                        z: 0,
                    },
                    velocity: {
                        x: 0,
                        y: velocityY,
                        z: 0,
                    },
                },
            });
        });
        world.step(1 / 60);
        const fastRisingAfterOneStep = assertWrap.isDefined(fastRising).getPosition().y;
        stepWorld(world, 179);

        const flippedWorld = await createPlatformWorld({
            x: 0,
            y: 0,
            z: 1,
            w: 0,
        });
        const fallingThroughFlipped = flippedWorld.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                position: {
                    x: 0,
                    y: 3,
                    z: 0,
                },
            },
        });
        stepWorld(flippedWorld, 120);

        assert.deepEquals(
            {
                isFastRisingAboveAfterOneStep: fastRisingAfterOneStep > 1,
                restingHeights: [
                    landing,
                    risingThrough,
                    fastFalling,
                ].map((ball) => {
                    return round(assertWrap.isDefined(ball).getPosition().y, {
                        digits: 1,
                    });
                }),
                isStoppingHalfwayBelow: assertWrap.isDefined(stoppingHalfway).getPosition().y < -3,
                isFallingThroughFlipped: fallingThroughFlipped.getPosition().y < -3,
            },
            {
                isFastRisingAboveAfterOneStep: true,
                restingHeights: [
                    2,
                    2,
                    2,
                ],
                isStoppingHalfwayBelow: true,
                isFallingThroughFlipped: true,
            },
        );
        world.destroy();
        flippedWorld.destroy();
    });

    it('collides shapes by collision group over their filters', async () => {
        const world = await PhysicsWorld3d.create();
        const pairs = (
            [
                {
                    collisionGroup: 1,
                    filter: {
                        category: 1n,
                        mask: 0n,
                    },
                },
                {
                    collisionGroup: -1,
                    filter: touchingFilter,
                },
                {
                    collisionGroup: undefined,
                    filter: touchingFilter,
                },
            ] as const
        ).map(({collisionGroup, filter}, pairIndex) => {
            return createArray(2, (index) => {
                return world.createBody({
                    definition: {
                        type: BodyType.Dynamic,
                        shapes: [
                            {
                                ...ballDefinition.shapes[0],
                                collisionGroup,
                            },
                        ],
                    },
                    filter,
                    entityId: pairIndex * 2 + index + 1,
                    bodyState: {
                        position: {
                            x: index,
                            y: pairIndex * 10,
                            z: 0,
                        },
                    },
                });
            });
        });
        stepWorld(world, 30);

        assert.deepEquals(
            pairs.map(
                ([
                    first,
                    second,
                ]) => {
                    return second.getPosition().x - first.getPosition().x > 1.9;
                },
            ),
            [
                true,
                false,
                true,
            ],
        );
        world.destroy();
    });

    it('rolls and slides bodies by surface material', async () => {
        const world = await PhysicsWorld3d.create();
        world.setGravity(downwardGravity);
        const bodies = (
            [
                {
                    rollingResistance: 0,
                },
                {
                    rollingResistance: 0.5,
                },
                {
                    tangentVelocity: {
                        x: 2,
                        y: 0,
                        z: 0,
                    },
                },
            ] as const
        ).map((floorMaterial, index) => {
            const floor = world.createBody({
                definition: {
                    type: BodyType.Static,
                    shapes: [
                        {
                            type: ShapeType.Box,
                            width: 10,
                            height: 1,
                            depth: 10,
                            material: floorMaterial,
                        },
                    ],
                },
                filter: touchingFilter,
                entityId: index * 2 + 1,
                bodyState: {
                    position: {
                        x: index * 20,
                        y: 0,
                        z: 0,
                    },
                },
            });
            if (index === 2) {
                floor.setMaterial({
                    tangentVelocity: {
                        x: -2,
                        y: 0,
                        z: 0,
                    },
                });
            }
            return world.createBody({
                definition: {
                    type: BodyType.Dynamic,
                    shapes: [
                        index === 2
                            ? {
                                  type: ShapeType.Box,
                                  width: 1,
                                  height: 1,
                                  depth: 1,
                              }
                            : ballDefinition.shapes[0],
                    ],
                },
                filter: touchingFilter,
                entityId: index * 2 + 2,
                bodyState: {
                    position: {
                        x: index * 20,
                        y: index === 2 ? 1 : 1.5,
                        z: 0,
                    },
                    velocity: {
                        x: index === 2 ? 0 : 4,
                        y: 0,
                        z: 0,
                    },
                },
            });
        });
        stepWorld(world, 60);

        assert.deepEquals(
            {
                rolledSpeeds: bodies.slice(0, 2).map((body) => body.getVelocity().x > 2),
                conveyorSpeed: round(assertWrap.isDefined(bodies[2]).getVelocity().x, {
                    digits: 1,
                }),
            },
            {
                rolledSpeeds: [
                    true,
                    false,
                ],
                conveyorSpeed: -2,
            },
        );
        world.destroy();
    });

    it('gives mesh triangles and height field cells their own materials', async () => {
        const world = await PhysicsWorld3d.create();
        world.setGravity(downwardGravity);
        const bouncy = {
            restitution: 1,
        };
        const meshShape = {
            type: ShapeType.Mesh,
            vertices: [
                {
                    x: -5,
                    y: 0,
                    z: -5,
                },
                {
                    x: 5,
                    y: 0,
                    z: -5,
                },
                {
                    x: 5,
                    y: 0,
                    z: 5,
                },
                {
                    x: -5,
                    y: 0,
                    z: 5,
                },
            ],
            /** The first triangle covers the corner at x = 5, z = -5. */
            triangles: [
                [
                    0,
                    2,
                    1,
                ],
                [
                    0,
                    3,
                    2,
                ],
            ],
            triangleMaterials: [
                bouncy,
                {},
            ],
            weldTolerance: 0.01,
            useMedianSplit: true,
        } as const satisfies PhysicsShapeDefinition;
        const heightFieldShape = {
            type: ShapeType.HeightField,
            heights: createArray(3, () => {
                return [
                    0,
                    0,
                    0,
                ];
            }),
            scale: {
                x: 5,
                y: 1,
                z: 5,
            },
            heightRange: {
                minimum: -1,
                maximum: 1,
            },
            cellMaterials: [
                [
                    bouncy,
                    {},
                ],
                [
                    {},
                    {},
                ],
            ],
            holes: [
                {
                    row: 1,
                    column: 1,
                },
            ],
        } as const satisfies PhysicsShapeDefinition;
        /** Ball positions relative to each floor's position. */
        const floors = [
            {
                shape: {
                    ...selectFrom(heightFieldShape, {
                        type: true,
                        heights: true,
                        scale: true,
                    }),
                    holes: [
                        {
                            row: 0,
                            column: 0,
                        },
                    ],
                },
                ballPositions: [
                    {
                        x: 2.5,
                        z: 2.5,
                    },
                    {
                        x: 7.5,
                        z: 2.5,
                    },
                ],
            },
            {
                shape: meshShape,
                ballPositions: [
                    {
                        x: 2.5,
                        z: -2.5,
                    },
                    {
                        x: -2.5,
                        z: 2.5,
                    },
                ],
            },
            {
                shape: heightFieldShape,
                ballPositions: [
                    {
                        x: 2.5,
                        z: 2.5,
                    },
                    {
                        x: 7.5,
                        z: 2.5,
                    },
                    {
                        x: 7.5,
                        z: 7.5,
                    },
                ],
            },
        ];
        const setMaterialFloors = [
            undefined,
            {
                restitution: 0,
            },
        ] as const;
        const balls = setMaterialFloors.flatMap((runtimeMaterial, copyIndex) => {
            return floors.flatMap(({shape, ballPositions}, floorIndex) => {
                const position = {
                    x: floorIndex * 30 - 30,
                    y: 0,
                    z: copyIndex * 30,
                };
                const floor = world.createBody({
                    definition: {
                        type: BodyType.Static,
                        shapes: [shape],
                    },
                    filter: touchingFilter,
                    entityId: 1,
                    bodyState: {
                        position,
                    },
                });
                if (runtimeMaterial) {
                    floor.setMaterial(runtimeMaterial);
                }
                return ballPositions.map((ballPosition) => {
                    return world.createBody({
                        definition: ballDefinition,
                        filter: touchingFilter,
                        entityId: 2,
                        bodyState: {
                            position: {
                                x: position.x + ballPosition.x,
                                y: 3,
                                z: position.z + ballPosition.z,
                            },
                        },
                    });
                });
            });
        });
        const bounced = stepAndFindBounces(world, balls);

        assert.deepEquals(
            balls.map((ball, index) => {
                return ball.getPosition().y < 0 ? 'fell' : bounced[index];
            }),
            [
                'fell',
                false,
                true,
                false,
                true,
                false,
                'fell',
                'fell',
                false,
                false,
                false,
                false,
                false,
                'fell',
            ],
        );
        world.destroy();
    });

    it('turns height fields upside down', async () => {
        const world = await PhysicsWorld3d.create();
        const hits = [
            false,
            true,
        ].map((isUpsideDown, index) => {
            const z = index * 10;
            world.createBody({
                definition: {
                    type: BodyType.Static,
                    shapes: [
                        {
                            type: ShapeType.HeightField,
                            heights: [
                                [
                                    0,
                                    0,
                                ],
                                [
                                    0,
                                    1,
                                ],
                            ],
                            scale: {
                                x: 4,
                                y: 1,
                                z: 4,
                            },
                            isUpsideDown,
                        },
                    ],
                },
                filter: touchingFilter,
                entityId: 1,
                bodyState: {
                    position: {
                        x: 0,
                        y: 0,
                        z,
                    },
                },
            });
            return [
                10,
                -10,
            ].map((y) => {
                const hit = world.castRay({
                    origin: {
                        x: 3,
                        y,
                        z: z + 3,
                    },
                    translation: {
                        x: 0,
                        y: -2 * y,
                        z: 0,
                    },
                });
                return (
                    hit && {
                        y: round(hit.point.y, {
                            digits: 3,
                        }),
                        normal: roundCoords(hit.normal),
                    }
                );
            });
        });

        assert.deepEquals(hits, [
            [
                {
                    y: 0.5,
                    normal: {
                        x: -0.236,
                        y: 0.943,
                        z: -0.236,
                    },
                },
                undefined,
            ],
            [
                undefined,
                {
                    y: 0.5,
                    normal: {
                        x: 0.236,
                        y: -0.943,
                        z: 0.236,
                    },
                },
            ],
        ]);
        world.destroy();
    });

    it('rotates shapes and compound children around their offsets', async () => {
        const world = await PhysicsWorld3d.create();
        world.setGravity(downwardGravity);
        const rotatedShapes = [
            {
                type: ShapeType.Sphere,
                radius: 1,
            },
            {
                type: ShapeType.Box,
                width: 2,
                height: 2,
                depth: 2,
                offset: {
                    x: 5,
                    y: 0,
                    z: 0,
                },
                /** A quarter of a half turn around y. */
                rotation: {
                    x: 0,
                    y: 0.382683,
                    z: 0,
                    w: 0.92388,
                },
            },
            {
                type: ShapeType.Capsule,
                radius: 0.5,
                height: 4,
                offset: {
                    x: 10,
                    y: 0,
                    z: 0,
                },
                /** A quarter turn around z, so it lies along x. */
                rotation: {
                    x: 0,
                    y: 0,
                    z: 0.707107,
                    w: 0.707107,
                },
            },
            {
                type: ShapeType.Hull,
                points: [
                    {
                        x: 0,
                        y: 0,
                        z: 0,
                    },
                    {
                        x: 1,
                        y: 0,
                        z: 0,
                    },
                    {
                        x: 0,
                        y: 1,
                        z: 0,
                    },
                    {
                        x: 0,
                        y: 0,
                        z: 1,
                    },
                ],
                offset: {
                    x: 15,
                    y: 0,
                    z: 0,
                },
                /** A half turn around x, so it points down. */
                rotation: {
                    x: 1,
                    y: 0,
                    z: 0,
                    w: 0,
                },
            },
        ] as const satisfies ReadonlyArray<PhysicsShapeDefinition & CompoundChildDefinition>;
        const meshChild = {
            type: ShapeType.Mesh,
            offset: {
                x: 20,
                y: -1,
                z: 0,
            },
            vertices: [
                {
                    x: -2,
                    y: 0,
                    z: -2,
                },
                {
                    x: 2,
                    y: 0,
                    z: -2,
                },
                {
                    x: 2,
                    y: 0,
                    z: 2,
                },
                {
                    x: -2,
                    y: 0,
                    z: 2,
                },
            ],
            triangles: [
                [
                    0,
                    2,
                    1,
                ],
                [
                    0,
                    3,
                    2,
                ],
            ],
        } as const satisfies CompoundChildDefinition;
        world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: rotatedShapes,
            },
            filter: touchingFilter,
            entityId: 1,
            bodyState: {},
        });
        const compound = world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Compound,
                        material: {
                            restitution: 1,
                        },
                        children: [
                            {
                                ...rotatedShapes[0],
                                material: {
                                    friction: 0.5,
                                    rollingResistance: 0.1,
                                    tangentVelocity: {
                                        x: 0,
                                        y: 0,
                                        z: 0,
                                    },
                                },
                            },
                            ...rotatedShapes.slice(1),
                            {
                                ...meshChild,
                                triangleMaterials: [
                                    {
                                        restitution: 0,
                                    },
                                    {},
                                ],
                            },
                            {
                                ...meshChild,
                                offset: {
                                    ...meshChild.offset,
                                    x: 25,
                                },
                                material: {
                                    restitution: 0,
                                },
                            },
                        ],
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 2,
            bodyState: {
                position: {
                    x: 0,
                    y: 0,
                    z: 20,
                },
            },
        });
        /** Each only hits its shape when the shape is rotated. */
        const castPoints = [
            {
                x: 0,
                z: 0,
            },
            {
                x: 6.1,
                z: 0,
            },
            {
                x: 11.5,
                z: 0,
            },
            {
                x: 15.2,
                z: -0.2,
            },
            {
                x: 20,
                z: 0,
            },
            {
                x: 25,
                z: 0,
            },
        ];
        function castHeights(z: number) {
            return castPoints.map((castPoint) => {
                const hit = world.castRay({
                    origin: {
                        x: castPoint.x,
                        y: 10,
                        z: z + castPoint.z,
                    },
                    translation: {
                        x: 0,
                        y: -20,
                        z: 0,
                    },
                });
                return (
                    hit &&
                    round(hit.point.y, {
                        digits: 3,
                    }) + 0
                );
            });
        }
        const heights = [
            castHeights(0),
            castHeights(20),
        ];
        function dropBalls() {
            return [
                5,
                21,
                19,
                25,
            ].map((x, index) => {
                return world.createBody({
                    definition: ballDefinition,
                    filter: touchingFilter,
                    entityId: 3,
                    bodyState: {
                        position: {
                            x,
                            y: 3,
                            z: 20 + (index === 1 ? -1 : index === 2 ? 1 : 0),
                        },
                    },
                });
            });
        }
        const bouncedBalls = dropBalls();
        const bounced = stepAndFindBounces(world, bouncedBalls);
        bouncedBalls.forEach((ball) => world.destroyBody(ball));
        compound.setMaterial({
            restitution: 0,
        });
        const settled = stepAndFindBounces(world, dropBalls());

        assert.deepEquals(
            {
                heights,
                bounced,
                settled,
                compoundMaterial: compound.getMaterial(),
            },
            {
                heights: [
                    [
                        1,
                        1,
                        0.5,
                        0,
                        undefined,
                        undefined,
                    ],
                    [
                        1,
                        1,
                        0.5,
                        0,
                        -1,
                        -1,
                    ],
                ],
                bounced: [
                    true,
                    false,
                    true,
                    false,
                ],
                settled: [
                    false,
                    false,
                    false,
                    false,
                ],
                compoundMaterial: {
                    restitution: 0,
                },
            },
        );
        world.destroy();
    });

    it('ignores explosions on shapes without an explosion scale', async () => {
        const world = await PhysicsWorld3d.create();
        const balls = [
            undefined,
            0,
        ].map((explosionScale, index) => {
            return world.createBody({
                definition: {
                    type: BodyType.Dynamic,
                    shapes: [
                        {
                            ...ballDefinition.shapes[0],
                            explosionScale,
                        },
                    ],
                },
                filter: touchingFilter,
                entityId: index,
                bodyState: {
                    position: {
                        x: index ? -2 : 2,
                        y: 0,
                        z: 0,
                    },
                },
            });
        });
        world.explode({
            position: {
                x: 0,
                y: 0,
                z: 0,
            },
            radius: 3,
            impulsePerArea: 10_000,
        });

        assert.deepEquals(
            balls.map((ball) => ball.getVelocity().x !== 0),
            [
                true,
                false,
            ],
        );
        world.destroy();
    });

    it('replaces shapes and keeps them in body state', async () => {
        const world = await PhysicsWorld3d.create();
        const boxShapes = [
            {
                type: ShapeType.Box,
                width: 2,
                height: 4,
                depth: 2,
            },
        ] as const satisfies ReadonlyArray<PhysicsShapeDefinition>;
        const ball = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {},
        });
        const definitionShapes = ball.getShapes();
        ball.setMaterial({
            density: 2,
        });
        ball.setShapes(boxShapes);
        const state = ball.getState();
        const copy = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 2,
            bodyState: {
                ...state,
                position: {
                    x: 20,
                    y: 0,
                    z: 0,
                },
            },
        });
        const flatPoints = createArray(4, (index) => {
            return {
                x: index % 2,
                y: 0,
                z: Math.floor(index / 2),
            };
        });
        const floor = world.createBody({
            definition: {
                type: BodyType.Static,
            },
            filter: touchingFilter,
            entityId: 3,
            bodyState: {},
        });
        function readFailure(callback: () => void) {
            try {
                callback();
                return undefined;
            } catch (error) {
                return assertWrap.instanceOf(error, Error).message;
            }
        }
        const floorShapes = [
            {
                type: ShapeType.Compound,
                children: boxShapes,
            },
        ] as const satisfies ReadonlyArray<PhysicsShapeDefinition>;
        floor.setShapes(floorShapes);
        const failureMessages = [
            readFailure(() => {
                ball.setShapes([
                    {
                        type: ShapeType.Hull,
                        points: flatPoints,
                    },
                ]);
            }),
            readFailure(() => {
                ball.setShapes([
                    {
                        type: ShapeType.Compound,
                        children: boxShapes,
                    },
                ]);
            }),
            readFailure(() => {
                floor.setShapes([
                    {
                        type: ShapeType.Compound,
                        children: [
                            {
                                type: ShapeType.Hull,
                                points: flatPoints,
                            },
                        ],
                    },
                ]);
            }),
        ];

        assert.deepEquals(
            {
                definitionShapes,
                stateShapes: state.shapes,
                shapes: ball.getShapes(),
                floorShapes: floor.getShapes(),
                masses: [
                    ball.getMass(),
                    copy.getMass(),
                ],
                failureMessages,
                isValidState: checkValidShape(state, bodyStateShape),
            },
            {
                definitionShapes: [...ballDefinition.shapes],
                stateShapes: [...boxShapes],
                shapes: [...boxShapes],
                floorShapes: [...floorShapes],
                masses: [
                    32,
                    32,
                ],
                failureMessages: [
                    'Hull points must not all lie on one plane.',
                    'A compound shape is only allowed on a static body.',
                    'Compound hulls and meshes must be valid.',
                ],
                isValidState: true,
            },
        );
        world.destroy();
    });

    it('lets shapeless bodies sleep once they get shapes', async () => {
        const world = await PhysicsWorld3d.create();
        const body = world.createBody({
            definition: {
                type: BodyType.Dynamic,
            },
            filter: touchingFilter,
            entityId: 1,
            bodyState: {},
        });
        body.setShapes(ballDefinition.shapes);
        stepWorld(world, 120);

        assert.isFalse(body.isAwake());
        world.destroy();
    });

    it('changes damping, sleep, and hit event settings and keeps them in body state', async () => {
        const world = await PhysicsWorld3d.create();
        const body = world.createBody({
            definition: {
                ...ballDefinition,
                linearDamping: 1,
                angularDamping: 1,
            },
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                linearDamping: 2,
                sleepThreshold: 3,
                isSleepDisabled: true,
                enableHitEvents: true,
            },
        });
        const initialSettings = {
            linearDamping: body.getLinearDamping(),
            angularDamping: body.getAngularDamping(),
            sleepThreshold: body.getSleepThreshold(),
            isSleepEnabled: body.isSleepEnabled(),
            areHitEventsEnabled: body.areHitEventsEnabled(),
        };
        body.setLinearDamping(4);
        body.setAngularDamping(5);
        body.setSleepThreshold(6);
        body.setSleepEnabled(true);
        body.setHitEventsEnabled(false);

        assert.deepEquals(
            {
                initialSettings,
                state: selectFrom(body.getState(), {
                    linearDamping: true,
                    angularDamping: true,
                    sleepThreshold: true,
                    isSleepDisabled: true,
                    enableHitEvents: true,
                }),
            },
            {
                initialSettings: {
                    linearDamping: 2,
                    angularDamping: 1,
                    sleepThreshold: 3,
                    isSleepEnabled: false,
                    areHitEventsEnabled: true,
                },
                state: {
                    linearDamping: 4,
                    angularDamping: 5,
                    sleepThreshold: 6,
                    isSleepDisabled: false,
                    enableHitEvents: false,
                },
            },
        );
        world.destroy();
    });

    it('only lets bodies sleep while sleep is enabled and they are slower than the threshold', async () => {
        const world = await PhysicsWorld3d.create();
        const bodies = [
            {
                isSleepDisabled: true,
            },
            {
                isSleepDisabled: false,
            },
            {
                sleepThreshold: 3,
                velocity: {
                    x: 1,
                    y: 0,
                    z: 0,
                },
            },
            {
                velocity: {
                    x: 1,
                    y: 0,
                    z: 0,
                },
            },
        ].map((bodyState, index) => {
            return world.createBody({
                definition: ballDefinition,
                filter: {
                    category: 1n,
                    mask: 0n,
                },
                entityId: index,
                bodyState: {
                    ...bodyState,
                    position: {
                        x: index * 10,
                        y: 0,
                        z: 0,
                    },
                },
            });
        });
        stepWorld(world, 120);
        const awakeAfterSteps = bodies.map((body) => body.isAwake());
        assertWrap.isDefined(bodies[1]).setSleepEnabled(false);

        assert.deepEquals(
            {
                awakeAfterSteps,
                awakeAfterDisablingSleep: assertWrap.isDefined(bodies[1]).isAwake(),
            },
            {
                awakeAfterSteps: [
                    true,
                    false,
                    false,
                    true,
                ],
                awakeAfterDisablingSleep: true,
            },
        );
        world.destroy();
    });

    it('reports hits only while hit events are enabled', async () => {
        const world = await PhysicsWorld3d.create();
        const ball = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                velocity: {
                    x: 10,
                    y: 0,
                    z: 0,
                },
            },
        });
        createWall(world);
        function restart() {
            ball.setPosition({
                x: 0,
                y: 0,
                z: 0,
            });
            ball.setVelocity({
                x: 10,
                y: 0,
                z: 0,
            });
        }
        const hitsWhileDisabled = stepWorld(world, 60).flatMap((events) => events.hits);
        ball.setHitEventsEnabled(true);
        restart();
        const hitsWhileEnabled = stepWorld(world, 60).flatMap((events) => events.hits);
        ball.setShapes(ballDefinition.shapes);
        restart();
        const hitsWithNewShapes = stepWorld(world, 60).flatMap((events) => events.hits);

        assert.deepEquals(
            [
                hitsWhileDisabled,
                hitsWhileEnabled,
                hitsWithNewShapes,
            ].map((hits) => hits.length),
            [
                0,
                2,
                2,
            ],
        );
        world.destroy();
    });

    it('overrides mass data through shape, density, and type changes', async () => {
        const world = await PhysicsWorld3d.create();
        const massData = {
            mass: 10,
            center: {
                x: 0.5,
                y: 0,
                z: 0,
            },
            rotationalInertia: {
                x: {
                    x: 2,
                    y: 0,
                    z: 0,
                },
                y: {
                    x: 0,
                    y: 3,
                    z: 0,
                },
                z: {
                    x: 0,
                    y: 0,
                    z: 4,
                },
            },
        };
        const body = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {},
        });
        const massFromShapes = round(body.getMass(), {
            digits: 3,
        });
        body.setMassData(massData);
        const overridden = body.getMassData();
        body.setShapes([
            {
                type: ShapeType.Box,
                width: 2,
                height: 2,
                depth: 2,
            },
        ]);
        const afterShapes = body.getMass();
        body.setMaterial({
            density: 3,
        });
        const afterDensity = body.getMass();
        body.setType(BodyType.Static);
        const whileStatic = body.getMass();
        body.setType(BodyType.Dynamic);
        const afterType = body.getMass();
        const state = body.getState().massData;
        body.setMassData(undefined);
        const loaded = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 2,
            bodyState: {
                massData,
            },
        });

        assert.deepEquals(
            {
                massFromShapes,
                overridden,
                afterShapes,
                afterDensity,
                whileStatic,
                afterType,
                state,
                restored: body.getMass(),
                restoredState: body.getState().massData,
                loaded: loaded.getMassData(),
                invalid: [
                    () => {
                        return body.setMassData({
                            ...massData,
                            mass: -1,
                        });
                    },
                    () => {
                        return world.createBody({
                            definition: ballDefinition,
                            filter: touchingFilter,
                            entityId: 4,
                            bodyState: {
                                massData: {
                                    ...massData,
                                    rotationalInertia: {
                                        ...massData.rotationalInertia,
                                        y: {
                                            x: 0,
                                            y: Number.NaN,
                                            z: 0,
                                        },
                                    },
                                },
                            },
                        });
                    },
                ].map((callback) => {
                    try {
                        callback();
                        return undefined;
                    } catch (error) {
                        return (error as Error).message;
                    }
                }),
            },
            {
                massFromShapes: 4188.791,
                overridden: massData,
                afterShapes: 10,
                afterDensity: 10,
                whileStatic: 0,
                afterType: 10,
                state: massData,
                restored: 24,
                restoredState: undefined,
                loaded: massData,
                invalid: [
                    "Mass and the rotational inertia's x.x, y.y, and z.z must be 0 or more, got -1, 2, 3, and 4.",
                    "Mass and the rotational inertia's x.x, y.y, and z.z must be 0 or more, got 10, 2, NaN, and 4.",
                ],
            },
        );
        world.destroy();
    });

    it('finds points, rays, and bounds on one body', async () => {
        const world = await PhysicsWorld3d.create();
        const wall = createWall(world);
        world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 4,
            bodyState: {
                position: {
                    x: 2,
                    y: 0,
                    z: 0,
                },
                gravityScale: 0,
            },
        });
        const floor = world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Mesh,
                        vertices: [
                            {
                                x: -1,
                                y: 0,
                                z: -1,
                            },
                            {
                                x: 1,
                                y: 0,
                                z: -1,
                            },
                            {
                                x: 1,
                                y: 0,
                                z: 1,
                            },
                        ],
                        triangles: [
                            [
                                0,
                                2,
                                1,
                            ],
                        ],
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 5,
            bodyState: {
                position: {
                    x: 0,
                    y: 10,
                    z: 0,
                },
            },
        });
        const shapeless = world.createBody({
            definition: undefined,
            filter: touchingFilter,
            entityId: 6,
            bodyState: {
                position: {
                    x: 0,
                    y: -10,
                    z: 0,
                },
            },
        });
        const hit = assertWrap.isDefined(
            wall.castRay({
                origin: {
                    x: 0,
                    y: 0,
                    z: 0,
                },
                translation: {
                    x: 10,
                    y: 0,
                    z: 0,
                },
            }),
        );
        const floorHit = assertWrap.isDefined(
            floor.castRay({
                origin: {
                    x: 0.5,
                    y: 15,
                    z: 0,
                },
                translation: {
                    x: 0,
                    y: -10,
                    z: 0,
                },
            }),
        );

        assert.deepEquals(
            {
                bounds: mapObjectValues(wall.getBounds(), (corner, coords) => {
                    return roundCoords(coords);
                }),
                shapelessBounds: shapeless.getBounds(),
                hit: {
                    ...hit,
                    point: roundCoords(hit.point),
                    normal: roundCoords(hit.normal),
                    fraction: round(hit.fraction, {
                        digits: 3,
                    }),
                },
                floorHit: {
                    ...floorHit,
                    point: roundCoords(floorHit.point),
                    normal: roundCoords(floorHit.normal),
                    fraction: round(floorHit.fraction, {
                        digits: 3,
                    }),
                },
                miss: wall.castRay({
                    origin: {
                        x: 0,
                        y: 5,
                        z: 0,
                    },
                    translation: {
                        x: 10,
                        y: 0,
                        z: 0,
                    },
                }),
                shapelessHit: shapeless.castRay({
                    origin: {
                        x: 0,
                        y: -10,
                        z: 0,
                    },
                    translation: {
                        x: 1,
                        y: 0,
                        z: 0,
                    },
                }),
                closestOutside: roundCoords(
                    assertWrap.isDefined(
                        wall.getClosestPoint({
                            x: 0,
                            y: 0,
                            z: 0,
                        }),
                    ),
                ),
                closestInside: wall.getClosestPoint({
                    x: 5,
                    y: 0.5,
                    z: 0,
                }),
                closestOnMesh: floor.getClosestPoint({
                    x: 0,
                    y: 12,
                    z: 0,
                }),
                closestShapeless: shapeless.getClosestPoint({
                    x: 0,
                    y: 0,
                    z: 0,
                }),
            },
            {
                /** Box3D pads bounds by its speculative distance. */
                bounds: {
                    lowerBound: {
                        x: 3.98,
                        y: -1.02,
                        z: -1.02,
                    },
                    upperBound: {
                        x: 6.02,
                        y: 1.02,
                        z: 1.02,
                    },
                },
                shapelessBounds: {
                    lowerBound: {
                        x: 0,
                        y: -10,
                        z: 0,
                    },
                    upperBound: {
                        x: 0,
                        y: -10,
                        z: 0,
                    },
                },
                hit: {
                    entityId: 3,
                    point: {
                        x: 4,
                        y: 0,
                        z: 0,
                    },
                    normal: {
                        x: -1,
                        y: 0,
                        z: 0,
                    },
                    fraction: 0.4,
                },
                floorHit: {
                    entityId: 5,
                    point: {
                        x: 0.5,
                        y: 10,
                        z: 0,
                    },
                    normal: {
                        x: 0,
                        y: 1,
                        z: 0,
                    },
                    fraction: 0.5,
                },
                miss: undefined,
                shapelessHit: undefined,
                closestOutside: {
                    x: 4,
                    y: 0,
                    z: 0,
                },
                closestInside: {
                    x: 5,
                    y: 0.5,
                    z: 0,
                },
                closestOnMesh: undefined,
                closestShapeless: undefined,
            },
        );
        world.destroy();
    });

    it('reads velocities at points that move with the body', async () => {
        const world = await PhysicsWorld3d.create();
        const body = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                position: {
                    x: 2,
                    y: 0,
                    z: 0,
                },
                /** A quarter turn around z. */
                rotation: {
                    x: 0,
                    y: 0,
                    z: Math.SQRT1_2,
                    w: Math.SQRT1_2,
                },
                velocity: {
                    x: 1,
                    y: 0,
                    z: 0,
                },
                angularVelocity: {
                    x: 0,
                    y: 0,
                    z: 1,
                },
            },
        });

        assert.deepEquals(
            {
                local: roundCoords(
                    body.getLocalPointVelocity({
                        x: 1,
                        y: 0,
                        z: 0,
                    }),
                ),
                world: roundCoords(
                    body.getPointVelocity({
                        x: 2,
                        y: 1,
                        z: 0,
                    }),
                ),
            },
            {
                local: {
                    x: 0,
                    y: 0,
                    z: 0,
                },
                world: {
                    x: 0,
                    y: 0,
                    z: 0,
                },
            },
        );
        world.destroy();
    });

    it('blows bodies with wind', async () => {
        const world = await PhysicsWorld3d.create();
        /** A cube's lift cancels out between its faces that face the wind. */
        const tiltedPlate = [
            {
                type: ShapeType.Box,
                width: 2,
                height: 0.2,
                depth: 2,
            },
        ] as const;
        const bodies = [
            {
                shapes: ballDefinition.shapes,
                drag: 1,
            },
            {
                shapes: ballDefinition.shapes,
                drag: 1,
                velocity: 10,
            },
            {
                shapes: ballDefinition.shapes,
                drag: 0,
                velocity: 10,
            },
            {
                shapes: ballDefinition.shapes,
                drag: 1,
                maxSpeed: 1,
            },
            {
                shapes: tiltedPlate,
                drag: 1,
            },
            {
                shapes: tiltedPlate,
                drag: 1,
                lift: 1,
            },
        ].map(({shapes, drag, lift, velocity, maxSpeed}, index) => {
            const body = world.createBody({
                definition: {
                    type: BodyType.Dynamic,
                    shapes: shapes.map((shape) => {
                        return {
                            ...shape,
                            material: {
                                density: 1,
                            },
                        };
                    }),
                },
                filter: {
                    category: 1n,
                    mask: 0n,
                },
                entityId: index,
                bodyState: {
                    position: {
                        x: index * 10,
                        y: 0,
                        z: 0,
                    },
                    /** An eighth turn around z. */
                    rotation: {
                        x: 0,
                        y: 0,
                        z: Math.sin(Math.PI / 16),
                        w: Math.cos(Math.PI / 16),
                    },
                    velocity: {
                        x: velocity ?? 0,
                        y: 0,
                        z: 0,
                    },
                },
            });
            body.applyWind({
                wind: {
                    x: 10,
                    y: 0,
                    z: 0,
                },
                drag,
                lift,
                maxSpeed: maxSpeed ?? 100,
            });
            return body;
        });
        world.step(1 / 60);

        assert.deepEquals(
            bodies.map((body) => {
                return roundCoords(body.getVelocity());
            }),
            [
                {
                    x: 0.766,
                    y: 0,
                    z: 0,
                },
                {
                    x: 10,
                    y: 0,
                    z: 0,
                },
                {
                    x: 10.766,
                    y: 0,
                    z: 0,
                },
                {
                    x: 0.008,
                    y: 0,
                    z: 0,
                },
                {
                    x: 2.425,
                    y: 0,
                    z: 0,
                },
                {
                    x: 2.425,
                    y: -1.624,
                    z: 0,
                },
            ],
        );
        world.destroy();
    });

    it('reads which entities are inside sensor shapes', async () => {
        const world = await PhysicsWorld3d.create();
        const sensor = world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Box,
                        width: 4,
                        height: 4,
                        depth: 4,
                        isSensor: true,
                    },
                    {
                        type: ShapeType.Box,
                        width: 4,
                        height: 4,
                        depth: 4,
                        isSensor: true,
                    },
                    {
                        type: ShapeType.Sphere,
                        radius: 1,
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 5,
            bodyState: {},
        });
        const [
            kept,
            destroyed,
        ] = [
            1,
            2,
        ].map((entityId) => {
            return world.createBody({
                definition: ballDefinition,
                filter: touchingFilter,
                entityId,
                bodyState: {},
            });
        });
        const beforeStep = sensor.getSensorOverlaps();
        world.step(1 / 60);
        world.destroyBody(assertWrap.isDefined(destroyed));

        assert.deepEquals(
            {
                beforeStep,
                afterStep: sensor.getSensorOverlaps(),
                notSensor: assertWrap.isDefined(kept).getSensorOverlaps(),
            },
            {
                beforeStep: [],
                afterStep: [
                    1,
                ],
                notSensor: [],
            },
        );
        world.destroy();
    });

    it('changes world settings and keeps them through resets', async () => {
        const world = await PhysicsWorld3d.create();
        const defaults = world.getSettings();
        world.setSettings({
            maximumLinearSpeed: 2,
            isSleepDisabled: true,
        });
        world.reset();
        const body = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                velocity: {
                    x: 10,
                    y: 0,
                    z: 0,
                },
            },
        });
        world.step(1 / 60);
        const cappedVelocity = roundCoords(body.getVelocity());
        body.setVelocity({
            x: 0,
            y: 0,
            z: 0,
        });
        stepWorld(world, 120);

        assert.deepEquals(
            {
                defaults: {
                    ...defaults,
                    contactRecycleDistance: round(defaults.contactRecycleDistance, {
                        digits: 3,
                    }),
                },
                afterReset: selectFrom(world.getSettings(), {
                    maximumLinearSpeed: true,
                    isSleepDisabled: true,
                    contactHertz: true,
                }),
                cappedVelocity,
                isAwake: body.isAwake(),
                invalid: [
                    {
                        contactHertz: -1,
                    },
                    {
                        contactSpeed: Number.NaN,
                    },
                    {
                        maximumLinearSpeed: 0,
                    },
                ].map((settings) => {
                    try {
                        world.setSettings(settings);
                        return undefined;
                    } catch (error) {
                        return (error as Error).message;
                    }
                }),
                afterInvalid: world.getSettings().contactHertz,
            },
            {
                defaults: {
                    restitutionThreshold: 1,
                    contactHertz: 30,
                    contactDampingRatio: 10,
                    contactSpeed: 3,
                    maximumLinearSpeed: 400,
                    contactRecycleDistance: 0.05,
                    isSleepDisabled: false,
                    isContinuousDisabled: false,
                    isWarmStartingDisabled: false,
                },
                afterReset: {
                    maximumLinearSpeed: 2,
                    isSleepDisabled: true,
                    contactHertz: 30,
                },
                cappedVelocity: {
                    x: 2,
                    y: 0,
                    z: 0,
                },
                isAwake: true,
                invalid: [
                    'World setting contactHertz must be a finite number of 0 or more, got -1.',
                    'World setting contactSpeed must be a finite number of 0 or more, got NaN.',
                    'World setting maximumLinearSpeed must be more than 0.',
                ],
                afterInvalid: 30,
            },
        );
        world.destroy();
    });
    it('asks the custom filter hook about shapes that enable it, through resets', async () => {
        const world = await PhysicsWorld3d.create();
        const askedPairs: number[][] = [];
        const customFilter: NonNullable<WorldHooks3d['customFilter']> = ({entityA, entityB}) => {
            askedPairs.push(
                [
                    entityA,
                    entityB,
                ].toSorted(),
            );
            return entityA !== 2 && entityB !== 2;
        };
        world.setHooks({
            customFilter,
        });
        world.reset();
        const ballFilter = {
            category: 2n,
            mask: 1n,
        };
        [
            0,
            20,
        ].forEach((y, index) => {
            world.createBody({
                definition: {
                    type: BodyType.Static,
                    shapes: [
                        {
                            type: ShapeType.Box,
                            width: 2,
                            height: 2,
                            depth: 2,
                            enableCustomFiltering: index === 0,
                        },
                    ],
                },
                filter: {
                    category: 1n,
                    mask: 2n,
                },
                entityId: index === 0 ? 3 : 5,
                bodyState: {
                    position: {
                        x: 5,
                        y,
                        z: 0,
                    },
                },
            });
        });
        function createBall({entityId, y}: Readonly<{entityId: number; y: number}>) {
            return world.createBody({
                definition: ballDefinition,
                filter: ballFilter,
                entityId,
                bodyState: {
                    position: {
                        x: 0,
                        y,
                        z: 0,
                    },
                    velocity: {
                        x: 10,
                        y: 0,
                        z: 0,
                    },
                },
            });
        }
        const balls = [
            createBall({
                entityId: 1,
                y: 0,
            }),
            createBall({
                entityId: 2,
                y: 0,
            }),
            createBall({
                entityId: 4,
                y: 20,
            }),
        ];
        stepWorld(world, 60);
        const hooksBeforeRemoval = world.getHooks();
        world.setHooks({
            customFilter: undefined,
        });
        const askedCountBeforeRemoval = askedPairs.length;
        const unfilteredBall = createBall({
            entityId: 6,
            y: 0,
        });
        stepWorld(world, 60);

        assert.deepEquals(
            {
                askedPairs: removeDuplicates(askedPairs.map((pair) => pair.join())),
                passedWall: balls.map((ball) => ball.getPosition().x > 6),
                isSameHook: hooksBeforeRemoval.customFilter === customFilter,
                hooksAfterRemoval: world.getHooks(),
                askedAfterRemoval: askedPairs.length > askedCountBeforeRemoval,
                unfilteredPassedWall: unfilteredBall.getPosition().x > 6,
            },
            {
                askedPairs: [
                    '1,3',
                    '2,3',
                ],
                passedWall: [
                    false,
                    true,
                    false,
                ],
                isSameHook: true,
                hooksAfterRemoval: {
                    customFilter: undefined,
                },
                askedAfterRemoval: false,
                unfilteredPassedWall: false,
            },
        );
        world.destroy();
    });

    it('skips contacts the pre-solve hook rejects', async () => {
        const world = await PhysicsWorld3d.create();
        world.setGravity(downwardGravity);
        const contacts: Parameters<NonNullable<WorldHooks3d['preSolve']>>[0][] = [];
        world.setHooks({
            preSolve(contact) {
                contacts.push(contact);
                return contact.entityA !== 2 && contact.entityB !== 2;
            },
        });
        world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Box,
                        width: 20,
                        height: 1,
                        depth: 20,
                        enablePreSolve: true,
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 3,
            bodyState: {},
        });
        const balls = [
            1,
            2,
        ].map((entityId) => {
            return world.createBody({
                definition: ballDefinition,
                filter: touchingFilter,
                entityId,
                bodyState: {
                    position: {
                        x: entityId === 1 ? -5 : 5,
                        y: 2,
                        z: 0,
                    },
                },
            });
        });
        stepWorld(world, 60);
        const firstContact = assertWrap.isDefined(
            contacts.find((contact) => contact.entityA === 1 || contact.entityB === 1),
        );

        assert.deepEquals(
            {
                heights: balls.map((ball) => {
                    return round(ball.getPosition().y, {
                        digits: 1,
                    });
                }),
                point: mapObjectValues(firstContact.point, (key, value) => {
                    return (
                        round(value, {
                            digits: 1,
                        }) + 0
                    );
                }),
                normalFromFloor: roundCoords(
                    firstContact.entityA === 3
                        ? firstContact.normal
                        : {
                              x: -firstContact.normal.x,
                              y: -firstContact.normal.y,
                              z: -firstContact.normal.z,
                          },
                ),
            },
            {
                heights: [
                    1.5,
                    -3,
                ],
                point: {
                    x: -5,
                    y: 0.5,
                    z: 0,
                },
                normalFromFloor: {
                    x: 0,
                    y: 1,
                    z: 0,
                },
            },
        );
        world.destroy();
    });

    it('mixes friction and restitution with hooks that see user material ids', async () => {
        const world = await PhysicsWorld3d.create();
        world.setGravity(downwardGravity);
        const seenIds = {
            friction: [] as string[],
            restitution: [] as string[],
        };
        world.setHooks({
            mixFriction(surfaceA, surfaceB) {
                seenIds.friction.push(
                    [
                        surfaceA.userMaterialId,
                        surfaceB.userMaterialId,
                    ]
                        .toSorted()
                        .join(),
                );
                return surfaceA.userMaterialId === 4 || surfaceB.userMaterialId === 4
                    ? 0
                    : Math.sqrt(surfaceA.value * surfaceB.value);
            },
            mixRestitution(surfaceA, surfaceB) {
                seenIds.restitution.push(
                    [
                        surfaceA.userMaterialId,
                        surfaceB.userMaterialId,
                    ]
                        .toSorted()
                        .join(),
                );
                return surfaceA.userMaterialId === 5 || surfaceB.userMaterialId === 5 ? 1 : 0;
            },
        });
        world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Mesh,
                        vertices: [
                            {
                                x: -10,
                                y: 0,
                                z: -10,
                            },
                            {
                                x: 10,
                                y: 0,
                                z: -10,
                            },
                            {
                                x: 10,
                                y: 0,
                                z: 10,
                            },
                            {
                                x: -10,
                                y: 0,
                                z: 10,
                            },
                        ],
                        /** The first triangle covers the corner at x = 10, z = -10. */
                        triangles: [
                            [
                                0,
                                2,
                                1,
                            ],
                            [
                                0,
                                3,
                                2,
                            ],
                        ],
                        material: {
                            userMaterialId: 9,
                        },
                        triangleMaterials: [
                            {
                                userMaterialId: 5,
                            },
                            {},
                        ],
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 1,
            bodyState: {},
        });
        const floor = world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Box,
                        width: 20,
                        height: 1,
                        depth: 20,
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 2,
            bodyState: {
                position: {
                    x: 0,
                    y: 50,
                    z: 0,
                },
            },
        });
        floor.setMaterial({
            userMaterialId: 4,
        });
        const balls = [
            -5,
            5,
        ].map((x, index) => {
            return world.createBody({
                definition: {
                    type: BodyType.Dynamic,
                    shapes: [
                        {
                            ...ballDefinition.shapes[0],
                            material: {
                                userMaterialId: 7,
                            },
                        },
                    ],
                },
                filter: touchingFilter,
                entityId: 10 + index,
                bodyState: {
                    position: {
                        x,
                        y: 3,
                        z: -x,
                    },
                },
            });
        });
        const slider = world.createBody({
            definition: {
                type: BodyType.Dynamic,
                shapes: [
                    {
                        type: ShapeType.Box,
                        width: 1,
                        height: 1,
                        depth: 1,
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 12,
            bodyState: {
                position: {
                    x: 0,
                    y: 51,
                    z: 0,
                },
                velocity: {
                    x: 4,
                    y: 0,
                    z: 0,
                },
            },
        });
        stepWorld(world, 45);

        assert.deepEquals(
            {
                bounced: balls.map((ball) => ball.getVelocity().y > 1),
                sliderSpeed: round(slider.getVelocity().x, {
                    digits: 1,
                }),
                floorMaterial: floor.getState().material,
                frictionIds: removeDuplicates(seenIds.friction).toSorted(),
                restitutionIds: removeDuplicates(seenIds.restitution).toSorted(),
            },
            {
                bounced: [
                    false,
                    true,
                ],
                sliderSpeed: 4,
                floorMaterial: {
                    userMaterialId: 4,
                },
                frictionIds: [
                    '0,4',
                    '5,7',
                    '7,9',
                ],
                restitutionIds: [
                    '0,4',
                    '5,7',
                    '7,9',
                ],
            },
        );
        world.destroy();
    });

    it('rejects user material ids that floats cannot hold exactly', async () => {
        const world = await PhysicsWorld3d.create();
        const body = world.createBody({
            definition: {
                type: BodyType.Static,
            },
            filter: touchingFilter,
            entityId: 1,
            bodyState: {},
        });
        const errors = [
            () => {
                body.setMaterial({
                    userMaterialId: -1,
                });
            },
            () => {
                body.setShapes([
                    {
                        type: ShapeType.Sphere,
                        radius: 1,
                        material: {
                            userMaterialId: 1.5,
                        },
                    },
                ]);
            },
            () => {
                body.setShapes([
                    {
                        type: ShapeType.Mesh,
                        vertices: [
                            {
                                x: 0,
                                y: 0,
                                z: 0,
                            },
                            {
                                x: 1,
                                y: 0,
                                z: 0,
                            },
                            {
                                x: 0,
                                y: 0,
                                z: 1,
                            },
                        ],
                        triangles: [
                            [
                                0,
                                2,
                                1,
                            ],
                        ],
                        triangleMaterials: [
                            {
                                userMaterialId: 2 ** 24 + 1,
                            },
                        ],
                    },
                ]);
            },
        ].map((callback) => {
            try {
                callback();
                return undefined;
            } catch (error) {
                return (error as Error).message;
            }
        });

        assert.deepEquals(errors, [
            'A userMaterialId must be a whole number from 0 to 16777216, got -1.',
            'A userMaterialId must be a whole number from 0 to 16777216, got 1.5.',
            'A userMaterialId must be a whole number from 0 to 16777216, got 16777217.',
        ]);
        world.destroy();
    });

    it('restores physics states into other worlds, keeping one-way passes and current world settings', async () => {
        /** A ball partway through rising past a one-way platform. */
        async function createPassingWorld() {
            const world = await PhysicsWorld3d.create();
            world.setGravity(downwardGravity);
            const bodies = [
                world.createBody({
                    definition: {
                        type: BodyType.Static,
                        shapes: [
                            {
                                type: ShapeType.Box,
                                width: 20,
                                height: 2,
                                depth: 20,
                                oneWayDirection: {
                                    x: 0,
                                    y: 1,
                                    z: 0,
                                },
                            },
                        ],
                    },
                    filter: touchingFilter,
                    entityId: 1,
                    bodyState: {},
                }),
                world.createBody({
                    definition: ballDefinition,
                    filter: touchingFilter,
                    entityId: 2,
                    bodyState: {
                        position: {
                            x: 0,
                            y: -3,
                            z: 0,
                        },
                        velocity: {
                            x: 0,
                            y: 8.4,
                            z: 0,
                        },
                    },
                }),
            ];
            return {
                world,
                bodies,
                ball: assertWrap.isDefined(bodies[1]),
            };
        }
        function readHeights(passing: Readonly<Awaited<ReturnType<typeof createPassingWorld>>>) {
            return createArray(90, () => {
                passing.world.step(1 / 60);
                return passing.ball.getPosition().y;
            });
        }

        const original = await createPassingWorld();
        stepWorld(original.world, 45);
        const state = original.world.createPhysicsState({
            bodies: original.bodies,
            droppedBodies: [],
            joints: [],
        });
        const restored = await createPassingWorld();
        restored.world.restorePhysicsState({
            state,
            bodies: restored.bodies,
            joints: [],
        });
        const floating = await createPassingWorld();
        floating.world.setGravity({
            x: 0,
            y: 0,
            z: 0,
        });
        floating.world.restorePhysicsState({
            state,
            bodies: floating.bodies,
            joints: [],
        });
        const floatingVelocity = floating.ball.getVelocity();
        stepWorld(floating.world, 90);

        assert.deepEquals(
            {
                heights: readHeights(restored),
                floatingVelocity: floating.ball.getVelocity(),
            },
            {
                heights: readHeights(original),
                floatingVelocity,
            },
        );

        original.world.destroy();
        restored.world.destroy();
        floating.world.destroy();
    });

    it('restores mesh, height field, compound, and hull geometry from physics states', async () => {
        const square = {
            vertices: [
                {
                    x: -2,
                    y: 0,
                    z: -2,
                },
                {
                    x: 2,
                    y: 0,
                    z: -2,
                },
                {
                    x: 2,
                    y: 0,
                    z: 2,
                },
                {
                    x: -2,
                    y: 0,
                    z: 2,
                },
            ],
            triangles: [
                [
                    0,
                    2,
                    1,
                ],
                [
                    0,
                    3,
                    2,
                ],
            ],
        } as const;
        function placeStatic({
            shape,
            entityId,
            x,
        }: Readonly<{
            shape: PhysicsShapeDefinition;
            entityId: number;
            x: number;
        }>) {
            return {
                definition: {
                    type: BodyType.Static,
                    shapes: [
                        shape,
                    ],
                },
                entityId,
                x,
                y: 0,
            };
        }
        function dropAbove({
            shape,
            entityId,
            x,
        }: Readonly<{
            shape: PhysicsShapeDefinition;
            entityId: number;
            x: number;
        }>) {
            return {
                definition: {
                    type: BodyType.Dynamic,
                    shapes: [
                        shape,
                    ],
                },
                entityId,
                x,
                y: 4,
            };
        }
        const ballShape = {
            type: ShapeType.Sphere,
            radius: 0.5,
        } as const;
        const placements = [
            placeStatic({
                shape: {
                    type: ShapeType.Mesh,
                    ...square,
                },
                entityId: 1,
                x: 0,
            }),
            /** The same mesh again, which Box3D's state stores only once. */
            placeStatic({
                shape: {
                    type: ShapeType.Mesh,
                    ...square,
                },
                entityId: 2,
                x: 10,
            }),
            placeStatic({
                shape: {
                    type: ShapeType.HeightField,
                    heights: createArray(3, () => {
                        return [
                            0,
                            0,
                            0,
                        ];
                    }),
                    scale: {
                        x: 2,
                        y: 1,
                        z: 2,
                    },
                },
                entityId: 3,
                x: 20,
            }),
            placeStatic({
                shape: {
                    type: ShapeType.Compound,
                    children: [
                        {
                            type: ShapeType.Mesh,
                            ...square,
                        },
                    ],
                },
                entityId: 4,
                x: 30,
            }),
            dropAbove({
                shape: ballShape,
                entityId: 5,
                x: 0.3,
            }),
            dropAbove({
                shape: ballShape,
                entityId: 6,
                x: 22,
            }),
            dropAbove({
                shape: {
                    type: ShapeType.Hull,
                    points: geometryShapes.hull.points,
                },
                entityId: 7,
                x: 30,
            }),
        ];
        async function createGeometryWorld() {
            const world = await PhysicsWorld3d.create();
            world.setGravity(downwardGravity);
            const bodies = placements.map((placement) => {
                return world.createBody({
                    definition: placement.definition,
                    filter: touchingFilter,
                    entityId: placement.entityId,
                    bodyState: {
                        position: {
                            x: placement.x,
                            y: placement.y,
                            z: 0,
                        },
                    },
                });
            });
            return {
                world,
                bodies,
            };
        }
        function readPositions(
            geometryWorld: Readonly<Awaited<ReturnType<typeof createGeometryWorld>>>,
        ) {
            stepWorld(geometryWorld.world, 60);
            return geometryWorld.bodies.map((body) => roundCoords(body.getPosition()));
        }
        function castDown(world: Readonly<PhysicsWorld3d>, x: number) {
            return world.castRay({
                origin: {
                    x,
                    y: 10,
                    z: 1,
                },
                translation: {
                    x: 0,
                    y: -20,
                    z: 0,
                },
            })?.entityId;
        }

        const original = await createGeometryWorld();
        stepWorld(original.world, 20);
        const state = original.world.createPhysicsState({
            bodies: original.bodies,
            droppedBodies: [],
            joints: [],
        });
        const restored = await createGeometryWorld();
        restored.world.restorePhysicsState({
            state,
            bodies: restored.bodies,
            joints: [],
        });
        const expectedPositions = readPositions(original);
        original.world.destroy();
        const restoredPositions = readPositions(restored);
        restored.world.destroyBody(assertWrap.isDefined(restored.bodies[0]));

        assert.deepEquals(
            {
                restoredPositions,
                hits: [
                    0,
                    10,
                    20,
                    30,
                ].map((x) => castDown(restored.world, x)),
            },
            {
                restoredPositions: expectedPositions,
                hits: [
                    undefined,
                    2,
                    3,
                    4,
                ],
            },
        );
        restored.world.destroy();
    });

    it('rejects physics states that do not match', async () => {
        const world = await PhysicsWorld3d.create();
        const ball = world.createBody({
            definition: {
                type: BodyType.Dynamic,
                shapes: [
                    {
                        type: ShapeType.Hull,
                        points: geometryShapes.hull.points,
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 1,
            bodyState: {},
        });
        const state = world.createPhysicsState({
            bodies: [
                ball,
            ],
            droppedBodies: [],
            joints: [],
        });
        const header = new DataView(state.buffer);
        const box3dSize = header.getInt32(9 * 4, true);
        const corrupted = state.slice();
        corrupted[state.length - box3dSize] = 0;
        const badGeometry = state.slice();
        const geometryOffset = state.length - box3dSize - header.getInt32(8 * 4, true);
        new DataView(badGeometry.buffer).setInt32(geometryOffset, 9, true);

        assert.throws(
            () => {
                world.assertValidPhysicsState({
                    state,
                    bodyCount: 2,
                    jointCount: 0,
                });
            },
            {
                matchMessage: 'it has 1 bodies and 0 joints, not 2 and 0',
            },
        );
        [
            state.slice(0, 10),
            corrupted,
            badGeometry,
        ].forEach((invalidState) => {
            assert.throws(
                () => {
                    world.assertValidPhysicsState({
                        state: invalidState,
                        bodyCount: 1,
                        jointCount: 0,
                    });
                },
                {
                    matchMessage: 'it is not from createPhysicsState',
                },
            );
        });
        assert.throws(
            () => {
                world.restorePhysicsState({
                    state: corrupted,
                    bodies: [
                        ball,
                    ],
                    joints: [],
                });
            },
            {
                matchMessage: 'Box3D could not restore the physics state',
            },
        );
        world.assertValidPhysicsState({
            state,
            bodyCount: 1,
            jointCount: 0,
        });
        ball.setVelocity({
            x: 1,
            y: 0,
            z: 0,
        });
        stepWorld(world, 60);
        assert.deepEquals(roundCoords(ball.getPosition()), {
            x: 1,
            y: 0,
            z: 0,
        });

        world.destroy();
    });

    it('reads awake bodies, step timings, and counters', async () => {
        const world = await PhysicsWorld3d.create();
        world.setGravity(downwardGravity);
        world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Box,
                        width: 40,
                        height: 2,
                        depth: 40,
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 0,
            bodyState: {},
        });
        createArray(100, (index) => {
            return world.createBody({
                definition: ballDefinition,
                filter: touchingFilter,
                entityId: index + 1,
                bodyState: {
                    position: {
                        x: (index % 10) * 2 - 9,
                        y: Math.floor(index / 10) * 2 + 2,
                        z: 0,
                    },
                },
            });
        });
        const awakeBodyCount = world.getAwakeBodyCount();
        /** Browsers coarsen timers, so one fast step can take no measurable time. */
        const profiles = createArray(60, () => {
            world.step(1 / 60);
            return world.getProfile();
        });
        const counters = world.getCounters();

        assert.isTrue(profiles.some((profile) => profile.step > 0));
        assert.isTrue(
            profiles.every((profile) => {
                return profile.step >= profile.collide && profile.step >= profile.solve;
            }),
        );
        assert.deepEquals(
            {
                awakeBodyCount,
                ...selectFrom(counters, {
                    bodyCount: true,
                    shapeCount: true,
                    jointCount: true,
                }),
                colorCountCount: counters.colorCounts.length,
                manifoldCountCount: counters.manifoldCounts.length,
            },
            {
                awakeBodyCount: 100,
                bodyCount: 101,
                shapeCount: 101,
                jointCount: 0,
                colorCountCount: 24,
                manifoldCountCount: 8,
            },
        );
        assert.isAbove(counters.contactCount, 0);
        assert.isAbove(counters.recycledContactCount, 0);
        assert.isAbove(counters.byteCount, 0);

        world.destroy();
    });

    it('draws only the enabled parts of the world', async () => {
        const world = await PhysicsWorld3d.create();
        world.setGravity(downwardGravity);
        createWall(world);
        createJoinedPair(world, {
            type: JointType.Weld,
        });
        createJoinedPair(world, {
            type: JointType.Revolute,
        });
        const flatSquare = {
            vertices: [
                {
                    x: -1,
                    y: 0,
                    z: -1,
                },
                {
                    x: 1,
                    y: 0,
                    z: -1,
                },
                {
                    x: 1,
                    y: 0,
                    z: 1,
                },
                {
                    x: -1,
                    y: 0,
                    z: 1,
                },
            ],
            triangles: [
                [
                    0,
                    2,
                    1,
                ],
                [
                    0,
                    3,
                    2,
                ],
            ],
        } as const;
        world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Mesh,
                        ...flatSquare,
                    },
                    {
                        type: ShapeType.HeightField,
                        heights: createArray(3, () => {
                            return [
                                0,
                                0,
                                0,
                            ];
                        }),
                        scale: {
                            x: 1,
                            y: 1,
                            z: 1,
                        },
                    },
                    {
                        type: ShapeType.Compound,
                        children: [
                            {
                                type: ShapeType.Sphere,
                                radius: 1,
                            },
                            {
                                type: ShapeType.Capsule,
                                radius: 0.5,
                                height: 4,
                                offset: {
                                    x: 4,
                                    y: 0,
                                    z: 0,
                                },
                            },
                            {
                                type: ShapeType.Box,
                                width: 2,
                                height: 2,
                                depth: 2,
                                offset: {
                                    x: 8,
                                    y: 0,
                                    z: 0,
                                },
                            },
                            {
                                type: ShapeType.Mesh,
                                ...flatSquare,
                                offset: {
                                    x: 12,
                                    y: 0,
                                    z: 0,
                                },
                            },
                        ],
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 4,
            bodyState: {
                position: {
                    x: 0,
                    y: -20,
                    z: 0,
                },
            },
        });
        world.createBody({
            definition: {
                type: BodyType.Dynamic,
                shapes: [
                    {
                        type: ShapeType.Capsule,
                        radius: 0.5,
                        height: 4,
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 5,
            bodyState: {
                position: {
                    x: 5,
                    y: 3.5,
                    z: 0,
                },
            },
        });
        const shapes = world.drawDebug({
            drawShapes: true,
        });
        stepWorld(world, 2);
        const everything = world.drawDebug({
            drawContacts: true,
            drawAnchorA: true,
            drawShapes: true,
            drawJoints: true,
            drawJointExtras: true,
            drawBounds: true,
            drawMass: true,
            drawBodyNames: true,
            drawGraphColors: true,
            drawContactFeatures: true,
            drawContactNormals: true,
            drawContactForces: true,
            drawFrictionForces: true,
            drawIslands: true,
        });

        assert.deepEquals(
            shapes.shapes.map((shape) => {
                return {
                    owner: shape.owner,
                    position: roundCoords(shape.transform.position),
                    spheres: shape.spheres.map((sphere) => {
                        return {
                            center: roundCoords(sphere.center),
                            radius: sphere.radius,
                        };
                    }),
                    capsules: shape.capsules.map((capsule) => {
                        return {
                            start: roundCoords(capsule.start),
                            end: roundCoords(capsule.end),
                            radius: capsule.radius,
                        };
                    }),
                    triangleCount: shape.triangles.length,
                };
            }),
            [
                {
                    owner: 4,
                    position: {
                        x: 0,
                        y: -20,
                        z: 0,
                    },
                    spheres: [
                        {
                            center: {
                                x: 0,
                                y: 0,
                                z: 0,
                            },
                            radius: 1,
                        },
                    ],
                    capsules: [
                        {
                            start: {
                                x: 4,
                                y: -1.5,
                                z: 0,
                            },
                            end: {
                                x: 4,
                                y: 1.5,
                                z: 0,
                            },
                            radius: 0.5,
                        },
                    ],
                    triangleCount: 14,
                },
                {
                    owner: 4,
                    position: {
                        x: 0,
                        y: -20,
                        z: 0,
                    },
                    spheres: [],
                    capsules: [],
                    triangleCount: 8,
                },
                {
                    owner: 4,
                    position: {
                        x: 0,
                        y: -20,
                        z: 0,
                    },
                    spheres: [],
                    capsules: [],
                    triangleCount: 2,
                },
                {
                    owner: 3,
                    position: {
                        x: 5,
                        y: 0,
                        z: 0,
                    },
                    spheres: [],
                    capsules: [],
                    triangleCount: 12,
                },
                {
                    owner: 5,
                    position: {
                        x: 5,
                        y: 3.5,
                        z: 0,
                    },
                    spheres: [],
                    capsules: [
                        {
                            start: {
                                x: 0,
                                y: -1.5,
                                z: 0,
                            },
                            end: {
                                x: 0,
                                y: 1.5,
                                z: 0,
                            },
                            radius: 0.5,
                        },
                    ],
                    triangleCount: 0,
                },
                {
                    owner: 2,
                    position: {
                        x: 4,
                        y: 0,
                        z: 0,
                    },
                    spheres: [
                        {
                            center: {
                                x: 0,
                                y: 0,
                                z: 0,
                            },
                            radius: 1,
                        },
                    ],
                    capsules: [],
                    triangleCount: 0,
                },
                {
                    owner: 2,
                    position: {
                        x: 4,
                        y: 0,
                        z: 0,
                    },
                    spheres: [
                        {
                            center: {
                                x: 0,
                                y: 0,
                                z: 0,
                            },
                            radius: 1,
                        },
                    ],
                    capsules: [],
                    triangleCount: 0,
                },
            ],
        );
        assert.deepEquals(
            mapObjectValues(everything, (key, drawn) => drawn.length),
            {
                shapes: 7,
                segments: 5,
                transforms: 3,
                points: 2,
                spheres: 0,
                capsules: 0,
                bounds: 10,
                boxes: 2,
                strings: 5,
            },
        );
        assert.deepEquals(
            mapObjectValues(
                world.drawDebug({
                    drawShapes: true,
                    bounds: {
                        lower: {
                            x: 100,
                            y: 100,
                            z: 100,
                        },
                        upper: {
                            x: 101,
                            y: 101,
                            z: 101,
                        },
                    },
                }),
                (key, drawn) => drawn.length,
            ),
            mapObjectValues(world.drawDebug({}), () => 0),
        );
        assert.deepEquals(
            world
                .drawDebug({
                    drawShapes: true,
                    mask: 0n,
                })
                .shapes.map((shape) => shape.owner),
            [],
        );
        assert.isTrue(everything.strings.every((drawn) => drawn.text.length > 0));

        world.destroy();
    });

    it('records steps, changes, and queries for replays', async () => {
        const world = await PhysicsWorld3d.create();
        world.setGravity(downwardGravity);
        world.startRecording();
        world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Box,
                        width: 20,
                        height: 2,
                        depth: 20,
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 1,
            bodyState: {},
        });
        const ball = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 2,
            bodyState: {
                position: {
                    x: 0,
                    y: 5,
                    z: 0,
                },
            },
        });
        const doomed = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 3,
            bodyState: {
                position: {
                    x: 8,
                    y: 5,
                    z: 0,
                },
            },
        });
        const heights = createArray(30, () => {
            world.step(1 / 60);
            return ball.getPosition().y;
        });
        [
            0,
            8,
        ].forEach((x) => {
            world.castRay({
                origin: {
                    x,
                    y: 10,
                    z: 0,
                },
                translation: {
                    x: 0,
                    y: -20,
                    z: 0,
                },
                filter: touchingFilter,
            });
        });
        world.destroyBody(doomed);
        world.step(1 / 60);
        [
            {
                type: ShapeType.Sphere,
                radius: 1,
            } as const,
            {
                type: ShapeType.Capsule,
                radius: 0.5,
                height: 2,
            } as const,
        ].forEach((shape) => {
            world.castShape({
                shape,
                position: {
                    x: 0,
                    y: 10,
                    z: 0,
                },
                translation: {
                    x: 0,
                    y: -20,
                    z: 0,
                },
                filter: touchingFilter,
            });
        });
        world.step(1 / 60);
        const isRecording = world.isRecording();
        const recording = world.stopRecording();

        const replay = await PhysicsReplay3d.create(recording);
        const replayedHeights = createArray(30, () => {
            replay.stepFrame();
            return assertWrap.isDefined(replay.getBodies()[1]).position.y;
        });
        replay.stepFrame();
        const queries = replay.getFrameQueries();
        function countDrawn(options: Parameters<PhysicsReplay3d['drawDebug']>[0]) {
            return getObjectTypedValues(replay.drawDebug(options)).flat().length;
        }
        const drawnQueries = {
            none: countDrawn({}),
            all: countDrawn({
                drawFrameQueries: true,
            }),
            second: countDrawn({
                drawFrameQueries: true,
                frameQueryIndex: 1,
            }),
            isHighlightRecolored:
                replay.drawDebug({
                    drawFrameQueries: true,
                    highlightedFrameQueryIndex: 0,
                }).segments[0]?.color !==
                replay.drawDebug({
                    drawFrameQueries: true,
                }).segments[0]?.color,
            missing: countDrawn({
                drawFrameQueries: true,
                frameQueryIndex: 5,
            }),
        };
        replay.stepFrame();
        const shapeCastDrawing = replay.drawDebug({
            drawFrameQueries: true,
        });
        const shapeCastQueryTypes = replay.getFrameQueries().map((query) => query.type);

        assert.deepEquals(
            {
                isRecording,
                isRecordingAfter: world.isRecording(),
                info: selectFrom(replay.getInfo(), {
                    frameCount: true,
                    subStepCount: true,
                }),
                replayedHeights,
                isAtEnd: !replay.stepFrame(),
                status: selectFrom(replay.getStatus(), {
                    frame: true,
                    isAtEnd: true,
                    divergedFrame: true,
                }),
                doomed: replay.getBodies()[2],
                shapeOwners: replay
                    .drawDebug({
                        drawShapes: true,
                    })
                    .shapes.map((shape) => shape.owner),
                queries: queries.map((query) => {
                    return {
                        ...selectFrom(query, {
                            type: true,
                            filter: true,
                            origin: true,
                            translation: true,
                        }),
                        hits: query.hits.map((hit) => {
                            return {
                                bodyIndex: hit.bodyIndex,
                                point: roundCoords(hit.point),
                                normal: roundCoords(hit.normal),
                            };
                        }),
                    };
                }),
                drawnQueries,
                drawnShapeCasts: {
                    queryTypes: shapeCastQueryTypes,
                    spheres: shapeCastDrawing.spheres.length,
                    capsules: shapeCastDrawing.capsules.length,
                },
            },
            {
                isRecording: true,
                isRecordingAfter: false,
                info: {
                    frameCount: 32,
                    subStepCount: 4,
                },
                replayedHeights: heights,
                isAtEnd: true,
                status: {
                    frame: 32,
                    isAtEnd: true,
                    divergedFrame: undefined,
                },
                doomed: undefined,
                shapeOwners: [
                    0,
                    1,
                ],
                queries: [
                    0,
                    8,
                ].map((x) => {
                    return {
                        type: ReplayQueryType3d.CastRayClosest,
                        filter: touchingFilter,
                        origin: {
                            x,
                            y: 10,
                            z: 0,
                        },
                        translation: {
                            x: 0,
                            y: -20,
                            z: 0,
                        },
                        hits: [
                            {
                                bodyIndex: x ? undefined : 1,
                                point: roundCoords({
                                    x,
                                    y: assertWrap.isDefined(heights.at(-1)) + 1,
                                    z: 0,
                                }),
                                normal: {
                                    x: 0,
                                    y: 1,
                                    z: 0,
                                },
                            },
                        ],
                    };
                }),
                drawnQueries: {
                    none: 0,
                    all: 6,
                    second: 3,
                    isHighlightRecolored: true,
                    missing: 0,
                },
                drawnShapeCasts: {
                    queryTypes: [
                        ReplayQueryType3d.CastShape,
                        ReplayQueryType3d.CastShape,
                    ],
                    spheres: 3,
                    capsules: 3,
                },
            },
        );

        replay.setKeyframePolicy({
            budgetBytes: 100_000,
            minInterval: 4,
        });
        replay.seekFrame(10);
        const seekedHeight = replay.getBodies()[1]?.position.y;
        replay.restart();

        assert.deepEquals(
            {
                seekedHeight,
                restarted: {
                    ...selectFrom(replay.getStatus(), {
                        frame: true,
                        keyframeBudgetBytes: true,
                        keyframeMinInterval: true,
                    }),
                    bodies: replay.getBodies(),
                },
                replaysExactly: await PhysicsReplay3d.replaysExactly(recording),
            },
            {
                seekedHeight: heights[9],
                restarted: {
                    frame: 0,
                    keyframeBudgetBytes: 100_000,
                    keyframeMinInterval: 4,
                    bodies: [],
                },
                replaysExactly: true,
            },
        );

        replay.destroy();
        replay.destroy();
        assert.throws(() => replay.stepFrame(), {
            matchMessage: 'The physics replay has been destroyed.',
        });
        assert.throws(() => world.stopRecording(), {
            matchMessage: 'The physics world is not recording.',
        });
        world.destroy();
    });

    it('rejects unreadable recordings and finds where edited ones diverge', async () => {
        const world = await PhysicsWorld3d.create();
        world.startRecording();
        world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                position: {
                    x: 0,
                    y: 5.25,
                    z: 0,
                },
            },
        });
        stepWorld(world, 10);
        const recording = world.stopRecording();
        const edited = recording.slice();
        const editedView = new DataView(edited.buffer);
        const [heightOffset] = assertWrap.isLengthExactly(
            createArray(edited.byteLength - 3, (offset) => offset).filter((offset) => {
                return editedView.getFloat32(offset, true) === 5.25;
            }),
            1,
        );
        editedView.setFloat32(heightOffset, 6, true);
        const replay = await PhysicsReplay3d.create(edited);

        await awaitedForEach(
            [
                new Uint8Array(4),
                recording.slice(0, 40),
            ],
            async (invalidRecording) => {
                await assert.throws(PhysicsReplay3d.create(invalidRecording), {
                    matchMessage: 'it is not from PhysicsWorld3d.stopRecording',
                });
                assert.isFalse(await PhysicsReplay3d.replaysExactly(invalidRecording));
            },
        );
        createArray(10, () => replay.stepFrame());
        assert.deepEquals(
            {
                divergedFrame: replay.getStatus().divergedFrame,
                replaysExactly: await PhysicsReplay3d.replaysExactly(edited),
            },
            {
                divergedFrame: 1,
                replaysExactly: false,
            },
        );

        replay.destroy();
        world.destroy();
    });

    it('refuses hooks and pre-solve shapes while recording', async () => {
        const world = await PhysicsWorld3d.create();
        world.setGravity(downwardGravity);
        const platformDefinition = {
            type: BodyType.Static,
            shapes: [
                {
                    type: ShapeType.Box,
                    width: 20,
                    height: 2,
                    depth: 20,
                    oneWayDirection: {
                        x: 0,
                        y: 1,
                        z: 0,
                    },
                },
            ],
        } as const satisfies EntityPhysicsDefinition;
        function createPlatform() {
            return world.createBody({
                definition: platformDefinition,
                filter: touchingFilter,
                entityId: 1,
                bodyState: {},
            });
        }
        world.setHooks({
            preSolve() {
                return true;
            },
        });
        assert.throws(() => world.startRecording(), {
            matchMessage: 'A recording physics world cannot have hooks.',
        });
        world.setHooks({
            preSolve: undefined,
        });
        const platform = createPlatform();
        assert.throws(() => world.startRecording(), {
            matchMessage: 'cannot have shapes with oneWayDirection or enablePreSolve',
        });
        world.destroyBody(platform);

        world.startRecording();
        const ball = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 2,
            bodyState: {
                position: {
                    x: 0,
                    y: -3,
                    z: 0,
                },
                velocity: {
                    x: 0,
                    y: 12,
                    z: 0,
                },
            },
        });
        const state = world.createPhysicsState({
            bodies: [
                ball,
            ],
            droppedBodies: [],
            joints: [],
        });
        world.setHooks({});
        [
            {
                refuse() {
                    world.startRecording();
                },
                message: 'The physics world is already recording.',
            },
            {
                refuse() {
                    world.setHooks({
                        mixFriction() {
                            return 1;
                        },
                    });
                },
                message: 'A recording physics world cannot have hooks.',
            },
            {
                refuse() {
                    createPlatform();
                },
                message: 'cannot have shapes with oneWayDirection',
            },
            {
                refuse() {
                    ball.setShapes([
                        {
                            type: ShapeType.Sphere,
                            radius: 1,
                            enablePreSolve: true,
                        },
                    ]);
                },
                message: 'cannot have shapes with oneWayDirection',
            },
            {
                refuse() {
                    world.restorePhysicsState({
                        state,
                        bodies: [
                            ball,
                        ],
                        joints: [],
                    });
                },
                message: 'cannot restore a physics state while the world is recording',
            },
        ].forEach((refusal) => {
            assert.throws(() => refusal.refuse(), {
                matchMessage: refusal.message,
            });
        });
        world.stopRecording();
        createPlatform();
        stepWorld(world, 30);

        assert.isAbove(ball.getPosition().y, 1);

        world.reset();
        world.startRecording();
        world.reset();
        assert.isFalse(world.isRecording());

        world.destroy();
    });
});

function roundGeometry(value: unknown): unknown {
    /** Recursion keeps this return type from being inferred. */
    if (check.isNumber(value)) {
        /** Adding 0 turns the -0 of a flipped normal into 0. */
        return (
            round(value, {
                digits: 3,
            }) + 0
        );
    } else if (check.isArray(value)) {
        return value.map(roundGeometry);
    } else if (check.isObject(value)) {
        return mapObjectValues(value, (key, entry) => {
            return roundGeometry(entry);
        });
    } else {
        return value;
    }
}

const geometryShapes = {
    sphere: {
        type: ShapeType.Sphere,
        radius: 1,
        offset: {
            x: 1,
            y: 0,
            z: 0,
        },
    },
    capsule: {
        type: ShapeType.Capsule,
        radius: 0.5,
        height: 3,
    },
    box: {
        type: ShapeType.Box,
        width: 2,
        height: 1,
        depth: 4,
    },
    hull: {
        type: ShapeType.Hull,
        points: [
            {
                x: 0,
                y: 0,
                z: 0,
            },
            {
                x: 1,
                y: 0,
                z: 0,
            },
            {
                x: 0,
                y: 1,
                z: 0,
            },
            {
                x: 0,
                y: 0,
                z: 1,
            },
        ],
    },
} as const satisfies Record<string, CastShapeDefinition>;

const identityRotation = {
    x: 0,
    y: 0,
    z: 0,
    w: 1,
};

/** Turned 90 degrees around z. */
const quarterTurn = {
    x: 0,
    y: 0,
    z: Math.SQRT1_2,
    w: Math.SQRT1_2,
};

const geometryTransform = {
    position: {
        x: 10,
        y: 0,
        z: 0,
    },
    rotation: quarterTurn,
};

const smallSphere = {
    type: ShapeType.Sphere,
    radius: 0.5,
} as const satisfies CastShapeDefinition;

function placeAt(position: Readonly<{x: number; y: number; z: number}>) {
    return {
        position: {
            ...position,
        },
        rotation: identityRotation,
    };
}

describe(PhysicsGeometry3d.name, () => {
    it('computes mass, bounds, overlaps, and ray casts of single shapes', async () => {
        const geometry = await PhysicsGeometry3d.create();

        assert.deepEquals(
            roundGeometry(
                mapObjectValues(geometryShapes, (name, shape) => {
                    return {
                        mass: geometry.computeMass(shape),
                        bounds: geometry.computeBounds({
                            shape,
                            transform: geometryTransform,
                        }),
                        ray: geometry.castRay({
                            shape,
                            transform: geometryTransform,
                            origin: {
                                x: 10,
                                y: 0,
                                z: -10,
                            },
                            translation: {
                                x: 0,
                                y: 0,
                                z: 20,
                            },
                        }),
                        overlaps: [
                            geometry.overlap({
                                shapeA: shape,
                                transformA: geometryTransform,
                                shapeB: smallSphere,
                                transformB: placeAt({
                                    x: 10,
                                    y: 0,
                                    z: 0,
                                }),
                            }),
                            geometry.overlap({
                                shapeA: shape,
                                transformA: placeAt({
                                    x: 50,
                                    y: 0,
                                    z: 0,
                                }),
                                shapeB: smallSphere,
                            }),
                        ],
                    };
                }),
            ),
            {
                sphere: {
                    mass: {
                        mass: 4.189,
                        center: {
                            x: 1,
                            y: 0,
                            z: 0,
                        },
                        rotationalInertia: {
                            x: {
                                x: 1.676,
                                y: 0,
                                z: 0,
                            },
                            y: {
                                x: 0,
                                y: 1.676,
                                z: 0,
                            },
                            z: {
                                x: 0,
                                y: 0,
                                z: 1.676,
                            },
                        },
                    },
                    bounds: {
                        lowerBound: {
                            x: 9,
                            y: 0,
                            z: -1,
                        },
                        upperBound: {
                            x: 11,
                            y: 2,
                            z: 1,
                        },
                    },
                    ray: {
                        point: {
                            x: 10,
                            y: 0,
                            z: 0,
                        },
                        normal: {
                            x: 0,
                            y: -1,
                            z: 0,
                        },
                        fraction: 0.5,
                        triangleIndex: 0,
                        childIndex: 0,
                    },
                    overlaps: [
                        true,
                        false,
                    ],
                },
                capsule: {
                    mass: {
                        mass: 2.094,
                        center: {
                            x: 0,
                            y: 0,
                            z: 0,
                        },
                        rotationalInertia: {
                            x: {
                                x: 1.394,
                                y: 0,
                                z: 0,
                            },
                            y: {
                                x: 0,
                                y: 0.249,
                                z: 0,
                            },
                            z: {
                                x: 0,
                                y: 0,
                                z: 1.394,
                            },
                        },
                    },
                    bounds: {
                        lowerBound: {
                            x: 8.5,
                            y: -0.5,
                            z: -0.5,
                        },
                        upperBound: {
                            x: 11.5,
                            y: 0.5,
                            z: 0.5,
                        },
                    },
                    ray: {
                        point: {
                            x: 10,
                            y: 0,
                            z: -0.5,
                        },
                        normal: {
                            x: 0,
                            y: 0,
                            z: -1,
                        },
                        fraction: 0.475,
                        triangleIndex: 0,
                        childIndex: 0,
                    },
                    overlaps: [
                        true,
                        false,
                    ],
                },
                box: {
                    mass: {
                        mass: 8,
                        center: {
                            x: 0,
                            y: 0,
                            z: 0,
                        },
                        rotationalInertia: {
                            x: {
                                x: 11.333,
                                y: 0,
                                z: 0,
                            },
                            y: {
                                x: 0,
                                y: 13.333,
                                z: 0,
                            },
                            z: {
                                x: 0,
                                y: 0,
                                z: 3.333,
                            },
                        },
                    },
                    bounds: {
                        lowerBound: {
                            x: 9.5,
                            y: -1,
                            z: -2,
                        },
                        upperBound: {
                            x: 10.5,
                            y: 1,
                            z: 2,
                        },
                    },
                    ray: {
                        point: {
                            x: 10,
                            y: 0,
                            z: -2,
                        },
                        normal: {
                            x: 0,
                            y: 0,
                            z: -1,
                        },
                        fraction: 0.4,
                        triangleIndex: 0,
                        childIndex: 0,
                    },
                    overlaps: [
                        true,
                        false,
                    ],
                },
                hull: {
                    mass: {
                        mass: 0.167,
                        center: {
                            x: 0.25,
                            y: 0.25,
                            z: 0.25,
                        },
                        rotationalInertia: {
                            x: {
                                x: 0.013,
                                y: 0.002,
                                z: 0.002,
                            },
                            y: {
                                x: 0.002,
                                y: 0.013,
                                z: 0.002,
                            },
                            z: {
                                x: 0.002,
                                y: 0.002,
                                z: 0.013,
                            },
                        },
                    },
                    bounds: {
                        lowerBound: {
                            x: 9,
                            y: 0,
                            z: 0,
                        },
                        upperBound: {
                            x: 10,
                            y: 1,
                            z: 1,
                        },
                    },
                    ray: {
                        point: {
                            x: 10,
                            y: 0,
                            z: 0,
                        },
                        normal: {
                            x: 0,
                            y: 0,
                            z: -1,
                        },
                        fraction: 0.5,
                        triangleIndex: 0,
                        childIndex: 0,
                    },
                    overlaps: [
                        true,
                        false,
                    ],
                },
            },
        );
    });

    it('casts shapes and measures distances between shapes', async () => {
        const geometry = await PhysicsGeometry3d.create();
        const transformB = {
            position: {
                x: 0.2,
                y: 0.2,
                z: 10,
            },
            rotation: quarterTurn,
        };

        assert.deepEquals(
            roundGeometry(
                mapObjectValues(geometryShapes, (name, shape) => {
                    return {
                        cast: geometry.castShape({
                            shapeA: shape,
                            shapeB: smallSphere,
                            transformB,
                            translation: {
                                x: 0,
                                y: 0,
                                z: -20,
                            },
                        }),
                        distance: geometry.computeDistance({
                            shapeA: shape,
                            shapeB: smallSphere,
                            transformB,
                        }),
                        coreDistance: geometry.computeDistance({
                            shapeA: shape,
                            shapeB: smallSphere,
                            transformB,
                            ignoreRadii: true,
                        }).distance,
                    };
                }),
            ),
            {
                sphere: {
                    cast: {
                        point: {
                            x: 0.465,
                            y: 0.134,
                            z: 0.834,
                        },
                        normal: {
                            x: -0.535,
                            y: 0.134,
                            z: 0.834,
                        },
                        fraction: 0.438,
                        triangleIndex: -1,
                        childIndex: 0,
                    },
                    distance: {
                        pointA: {
                            x: 0.92,
                            y: 0.02,
                            z: 0.997,
                        },
                        pointB: {
                            x: 0.24,
                            y: 0.19,
                            z: 9.502,
                        },
                        normal: {
                            x: -0.08,
                            y: 0.02,
                            z: 0.997,
                        },
                        distance: 8.534,
                        iterations: 0,
                    },
                    coreDistance: 10.034,
                },
                capsule: {
                    cast: {
                        point: {
                            x: 0.101,
                            y: 0.2,
                            z: 0.49,
                        },
                        normal: {
                            x: 0.201,
                            y: 0,
                            z: 0.98,
                        },
                        fraction: 0.451,
                        triangleIndex: -1,
                        childIndex: 0,
                    },
                    distance: {
                        pointA: {
                            x: 0.01,
                            y: 0.2,
                            z: 0.5,
                        },
                        pointB: {
                            x: 0.19,
                            y: 0.2,
                            z: 9.5,
                        },
                        normal: {
                            x: 0.02,
                            y: 0,
                            z: 1,
                        },
                        distance: 9.002,
                        iterations: 1,
                    },
                    coreDistance: 10.002,
                },
                box: {
                    cast: {
                        point: {
                            x: 0.2,
                            y: 0.2,
                            z: 2,
                        },
                        normal: {
                            x: 0,
                            y: 0,
                            z: 1,
                        },
                        fraction: 0.375,
                        triangleIndex: -1,
                        childIndex: 0,
                    },
                    distance: {
                        pointA: {
                            x: 0.2,
                            y: 0.2,
                            z: 2,
                        },
                        pointB: {
                            x: 0.2,
                            y: 0.2,
                            z: 9.5,
                        },
                        normal: {
                            x: 0,
                            y: 0,
                            z: 1,
                        },
                        distance: 7.5,
                        iterations: 2,
                    },
                    coreDistance: 8,
                },
                hull: {
                    cast: {
                        point: {
                            x: 0,
                            y: 0,
                            z: 1,
                        },
                        normal: {
                            x: 0.404,
                            y: 0.404,
                            z: 0.821,
                        },
                        fraction: 0.43,
                        triangleIndex: -1,
                        childIndex: 0,
                    },
                    distance: {
                        pointA: {
                            x: 0,
                            y: 0,
                            z: 1,
                        },
                        pointB: {
                            x: 0.189,
                            y: 0.189,
                            z: 9.5,
                        },
                        normal: {
                            x: 0.022,
                            y: 0.022,
                            z: 1,
                        },
                        distance: 8.504,
                        iterations: 1,
                    },
                    coreDistance: 9.004,
                },
            },
        );
    });

    it('casts hollow spheres and lets rounded shapes encroach', async () => {
        const geometry = await PhysicsGeometry3d.create();
        const fromCenter = {
            shape: geometryShapes.sphere,
            origin: {
                x: 1,
                y: 0,
                z: 0,
            },
            translation: {
                x: 0,
                y: 5,
                z: 0,
            },
        };

        assert.deepEquals(
            roundGeometry({
                solid: geometry.castRay(fromCenter),
                hollow: geometry.castRay({
                    ...fromCenter,
                    isHollow: true,
                }),
                shortHollow: geometry.castRay({
                    ...fromCenter,
                    isHollow: true,
                    maxFraction: 0.1,
                }),
                encroach: [
                    false,
                    true,
                ].map((canEncroach) => {
                    return geometry.castShape({
                        shapeA: geometryShapes.box,
                        shapeB: smallSphere,
                        transformB: placeAt({
                            x: 0,
                            y: 0.9,
                            z: 0,
                        }),
                        translation: {
                            x: 0,
                            y: -1,
                            z: 0,
                        },
                        canEncroach,
                    })?.fraction;
                }),
            }),
            {
                solid: {
                    point: {
                        x: 1,
                        y: 0,
                        z: 0,
                    },
                    normal: {
                        x: 0,
                        y: 0,
                        z: 0,
                    },
                    fraction: 0,
                    triangleIndex: 0,
                    childIndex: 0,
                },
                hollow: {
                    point: {
                        x: 1,
                        y: 1,
                        z: 0,
                    },
                    normal: {
                        x: 0,
                        y: 1,
                        z: 0,
                    },
                    fraction: 0.2,
                    triangleIndex: 0,
                    childIndex: 0,
                },
                shortHollow: undefined,
                encroach: [
                    0,
                    0.005,
                ],
            },
        );
    });

    it('collides shapes in either order and against triangles', async () => {
        const geometry = await PhysicsGeometry3d.create();
        const triangle = [
            {
                x: -5,
                y: -0.4,
                z: -5,
            },
            {
                x: 0,
                y: -0.4,
                z: 5,
            },
            {
                x: 5,
                y: -0.4,
                z: -5,
            },
        ] as const;

        assert.deepEquals(
            roundGeometry({
                sphereBox: geometry.collide({
                    shapeA: geometryShapes.sphere,
                    shapeB: {
                        type: ShapeType.Box,
                        width: 1,
                        height: 1,
                        depth: 1,
                    },
                    transformB: {
                        position: {
                            x: 0.2,
                            y: 0.2,
                            z: 0.9,
                        },
                        rotation: quarterTurn,
                    },
                }),
                boxSphere: geometry.collide({
                    shapeA: {
                        type: ShapeType.Sphere,
                        radius: 1,
                    },
                    transformA: {
                        position: {
                            x: 0.2,
                            y: 0.2,
                            z: 1.5,
                        },
                        rotation: quarterTurn,
                    },
                    shapeB: geometryShapes.box,
                }),
                apart: geometry.collide({
                    shapeA: geometryShapes.capsule,
                    shapeB: smallSphere,
                    transformB: placeAt({
                        x: 0,
                        y: 0,
                        z: 10,
                    }),
                }),
                triangleFront: geometry.collideTriangle({
                    shape: geometryShapes.sphere,
                    triangle,
                }),
                triangleBack: geometry.collideTriangle({
                    shape: geometryShapes.sphere,
                    triangle: [
                        triangle[2],
                        triangle[1],
                        triangle[0],
                    ],
                }).points,
            }),
            {
                sphereBox: {
                    normal: {
                        x: -0.6,
                        y: 0,
                        z: 0.8,
                    },
                    points: [
                        {
                            point: {
                                x: 0.55,
                                y: 0,
                                z: 0.6,
                            },
                            separation: -0.5,
                            id: 0,
                        },
                    ],
                },
                boxSphere: {
                    normal: {
                        x: 0,
                        y: -1,
                        z: 0,
                    },
                    points: [
                        {
                            point: {
                                x: 0.2,
                                y: -0.3,
                                z: 1.5,
                            },
                            separation: -1.3,
                            id: 0,
                        },
                    ],
                },
                apart: {
                    normal: {
                        x: 0,
                        y: 0,
                        z: 0,
                    },
                    points: [],
                },
                triangleFront: {
                    normal: {
                        x: 0,
                        y: 1,
                        z: 0,
                    },
                    points: [
                        {
                            point: {
                                x: 1,
                                y: -0.7,
                                z: 0,
                            },
                            separation: -0.6,
                            id: 0,
                        },
                    ],
                },
                triangleBack: [],
            },
        );
        assert.deepEquals(
            geometry
                .collide({
                    shapeA: geometryShapes.box,
                    shapeB: {
                        type: ShapeType.Box,
                        width: 1,
                        height: 1,
                        depth: 1,
                    },
                    transformB: {
                        position: {
                            x: 0.2,
                            y: 0.2,
                            z: 0.9,
                        },
                        rotation: quarterTurn,
                    },
                })
                .points.map(({id}) => id),
            [
                16_777_474,
                16_908_548,
                17_039_622,
                17_170_688,
            ],
        );
    });

    it('computes times of impact', async () => {
        const geometry = await PhysicsGeometry3d.create();
        const still = {
            start: geometryTransform,
            end: geometryTransform,
        };
        const spin = {
            start: placeAt({
                x: 0,
                y: 0,
                z: 0,
            }),
            end: {
                position: {
                    x: 0,
                    y: 0,
                    z: 0,
                },
                rotation: quarterTurn,
            },
        };
        const stick = {
            type: ShapeType.Box,
            width: 4,
            height: 0.2,
            depth: 0.2,
        } as const;
        const target = {
            type: ShapeType.Sphere,
            radius: 0.25,
        } as const;
        const targetSweep = {
            start: placeAt({
                x: 1.414,
                y: 1.414,
                z: 0,
            }),
            end: placeAt({
                x: 1.414,
                y: 1.414,
                z: 0,
            }),
        };

        assert.deepEquals(
            roundGeometry({
                hit: geometry.computeTimeOfImpact({
                    shapeA: geometryShapes.sphere,
                    sweepA: still,
                    shapeB: smallSphere,
                    sweepB: {
                        start: {
                            ...geometryTransform,
                            position: {
                                x: 10,
                                y: 0,
                                z: 10,
                            },
                        },
                        end: {
                            ...geometryTransform,
                            position: {
                                x: 10,
                                y: 0,
                                z: -10,
                            },
                        },
                    },
                }),
                overlapped: geometry.computeTimeOfImpact({
                    shapeA: geometryShapes.box,
                    sweepA: still,
                    shapeB: smallSphere,
                    sweepB: still,
                }).state,
                spinHit: geometry.computeTimeOfImpact({
                    shapeA: stick,
                    sweepA: spin,
                    shapeB: target,
                    sweepB: targetSweep,
                }),
                spinAroundEnd: selectFrom(
                    geometry.computeTimeOfImpact({
                        shapeA: stick,
                        sweepA: {
                            ...spin,
                            localCenter: {
                                x: 2,
                                y: 0,
                                z: 0,
                            },
                        },
                        shapeB: target,
                        sweepB: targetSweep,
                        maxFraction: 1,
                    }),
                    {
                        state: true,
                        fraction: true,
                    },
                ),
            }),
            {
                hit: {
                    state: TimeOfImpactState3d.Hit,
                    point: {
                        x: 10,
                        y: 0.333,
                        z: 0.742,
                    },
                    normal: {
                        x: 0,
                        y: -0.669,
                        z: 0.743,
                    },
                    fraction: 0.444,
                    distance: 1.495,
                },
                overlapped: TimeOfImpactState3d.Overlapped,
                spinHit: {
                    state: TimeOfImpactState3d.Hit,
                    point: {
                        x: 1.556,
                        y: 1.211,
                        z: 0,
                    },
                    normal: {
                        x: -0.574,
                        y: 0.819,
                        z: 0,
                    },
                    fraction: 0.395,
                    distance: 0.245,
                },
                spinAroundEnd: {
                    state: TimeOfImpactState3d.Separated,
                    fraction: 1,
                },
            },
        );
    });

    it('queries meshes, height fields, and compounds', async () => {
        const geometry = await PhysicsGeometry3d.create();
        const mesh = geometry.createGridMesh({
            xCount: 2,
            zCount: 2,
            cellWidth: 1,
        });
        const heightField = geometry.createWaveHeightField({
            rowCount: 3,
            columnCount: 4,
            scale: {
                x: 1,
                y: 1,
                z: 1,
            },
            rowFrequency: 0.5,
            columnFrequency: 0.25,
        });
        const smallBounds = {
            lowerBound: {
                x: 0.1,
                y: -1,
                z: 0.1,
            },
            upperBound: {
                x: 0.2,
                y: 1,
                z: 0.2,
            },
        };
        const compound = {
            type: ShapeType.Compound,
            children: [
                {
                    type: ShapeType.Sphere,
                    radius: 1,
                },
                {
                    type: ShapeType.Box,
                    width: 1,
                    height: 1,
                    depth: 1,
                    offset: {
                        x: 5,
                        y: 0,
                        z: 0,
                    },
                },
            ],
        } as const;
        const downFrom = {
            origin: {
                x: 0.3,
                y: 5,
                z: 0.4,
            },
            translation: {
                x: 0,
                y: -10,
                z: 0,
            },
        };

        assert.deepEquals(
            roundGeometry({
                meshRay: geometry.castRay({
                    ...downFrom,
                    shape: mesh,
                }),
                meshCast: geometry.castShape({
                    shapeA: mesh,
                    shapeB: smallSphere,
                    transformB: placeAt({
                        x: 0.3,
                        y: 5,
                        z: 0.4,
                    }),
                    translation: downFrom.translation,
                })?.fraction,
                meshBounds: geometry.computeBounds({
                    shape: mesh,
                }),
                meshTriangles: geometry.queryTriangles({
                    shape: mesh,
                    bounds: smallBounds,
                }),
                heightFieldTriangles: geometry
                    .queryTriangles({
                        shape: heightField,
                        transform: placeAt({
                            x: 0,
                            y: 1,
                            z: 0,
                        }),
                        bounds: {
                            ...smallBounds,
                            upperBound: {
                                ...smallBounds.upperBound,
                                y: 5,
                            },
                        },
                    })
                    .map(({triangleIndex}) => triangleIndex),
                children: geometry.queryChildren({
                    shape: compound,
                    bounds: {
                        lowerBound: {
                            x: 4,
                            y: -1,
                            z: -1,
                        },
                        upperBound: {
                            x: 6,
                            y: 1,
                            z: 1,
                        },
                    },
                }),
                compoundRay: geometry.castRay({
                    shape: compound,
                    origin: {
                        x: 5,
                        y: 5,
                        z: 0,
                    },
                    translation: downFrom.translation,
                }),
            }),
            {
                meshRay: {
                    point: {
                        x: 0.3,
                        y: 0,
                        z: 0.4,
                    },
                    normal: {
                        x: 0,
                        y: 1,
                        z: 0,
                    },
                    fraction: 0.5,
                    triangleIndex: 6,
                    childIndex: 0,
                },
                meshCast: 0.451,
                meshBounds: {
                    lowerBound: {
                        x: -1,
                        y: 0,
                        z: -1,
                    },
                    upperBound: {
                        x: 1,
                        y: 0,
                        z: 1,
                    },
                },
                meshTriangles: [
                    {
                        triangleIndex: 6,
                        corners: [
                            {
                                x: 0,
                                y: 0,
                                z: 0,
                            },
                            {
                                x: 0,
                                y: 0,
                                z: 1,
                            },
                            {
                                x: 1,
                                y: 0,
                                z: 1,
                            },
                        ],
                    },
                    {
                        triangleIndex: 7,
                        corners: [
                            {
                                x: 1,
                                y: 0,
                                z: 1,
                            },
                            {
                                x: 1,
                                y: 0,
                                z: 0,
                            },
                            {
                                x: 0,
                                y: 0,
                                z: 0,
                            },
                        ],
                    },
                ],
                heightFieldTriangles: [
                    0,
                    1,
                ],
                children: [0],
                compoundRay: {
                    point: {
                        x: 5,
                        y: 0.5,
                        z: 0,
                    },
                    normal: {
                        x: 0,
                        y: 1,
                        z: 0,
                    },
                    fraction: 0.45,
                    triangleIndex: 0,
                    childIndex: 0,
                },
            },
        );
    });

    it('builds hulls, meshes, and height fields', async () => {
        const geometry = await PhysicsGeometry3d.create();
        const torus = geometry.createTorusMesh({
            radialResolution: 3,
            tubularResolution: 4,
            radius: 2,
            thickness: 0.5,
        });
        const down = {
            origin: {
                x: 0,
                y: 0,
                z: 0,
            },
            translation: {
                x: 0,
                y: -5,
                z: 0,
            },
        };
        const tetrahedron = geometryShapes.hull.points;

        assert.deepEquals(
            roundGeometry({
                gridMesh: geometry.createGridMesh({
                    xCount: 1,
                    zCount: 2,
                    cellWidth: 1,
                }),
                waveMesh: geometry.createWaveMesh({
                    xCount: 1,
                    zCount: 1,
                    cellWidth: 2,
                    amplitude: 3,
                    rowFrequency: 0.125,
                    columnFrequency: 0.125,
                }).vertices,
                torus: [
                    torus.vertices.length,
                    torus.triangles.length,
                    geometry.computeBounds({
                        shape: torus,
                    }),
                ],
                boxMesh: [
                    geometry.createBoxMesh({
                        width: 2,
                        height: 4,
                        depth: 6,
                    }).triangles.length,
                    geometry.computeBounds({
                        shape: geometry.createBoxMesh({
                            width: 2,
                            height: 4,
                            depth: 6,
                            offset: {
                                x: 1,
                                y: 0,
                                z: 0,
                            },
                        }),
                    }),
                ],
                boxFromInside: geometry.castRay({
                    ...down,
                    shape: geometry.createBoxMesh({
                        width: 2,
                        height: 2,
                        depth: 2,
                    }),
                }),
                hollowBoxFromInside: geometry.castRay({
                    ...down,
                    shape: geometry.createHollowBoxMesh({
                        width: 2,
                        height: 2,
                        depth: 2,
                    }),
                })?.point,
                platform: geometry.computeBounds({
                    shape: geometry.createPlatformMesh({
                        height: 1,
                        topWidth: 2,
                        bottomWidth: 4,
                    }),
                }),
                cylinder: geometry.createCylinderHull({
                    height: 2,
                    radius: 1,
                    sideCount: 3,
                    yOffset: 1,
                }),
                cone: geometry.computeBounds({
                    shape: geometry.createConeHull({
                        height: 2,
                        bottomRadius: 1,
                        topRadius: 0.5,
                        sideCount: 4,
                    }),
                }),
                unraisedCylinder: [
                    geometry.createCylinderHull({
                        height: 2,
                        radius: 1,
                        sideCount: 4,
                    }),
                ].map((shape) => {
                    const {lowerBound, upperBound} = geometry.computeBounds({
                        shape,
                    });
                    return [
                        lowerBound.y,
                        upperBound.y,
                    ];
                }),
                denseMass: geometry.computeMass({
                    ...geometryShapes.box,
                    material: {
                        density: 2,
                    },
                }).mass,
                rockPointCount: geometry.createRockHull(1).points.length,
                hull: geometry.computeHull({
                    points: [
                        ...tetrahedron,
                        {
                            x: 0.1,
                            y: 0.1,
                            z: 0.1,
                        },
                    ],
                }),
                flatHull: geometry.computeHull({
                    points: tetrahedron.map((point) => {
                        return {
                            ...point,
                            z: 0,
                        };
                    }),
                }),
                waveHeightField: geometry.createWaveHeightField({
                    rowCount: 2,
                    columnCount: 3,
                    scale: {
                        x: 1,
                        y: 1,
                        z: 1,
                    },
                    rowFrequency: 0.25,
                    columnFrequency: 0.25,
                }),
                holes: geometry.createGridHeightField({
                    rowCount: 18,
                    columnCount: 3,
                    scale: {
                        x: 1,
                        y: 2,
                        z: 1,
                    },
                    makeHoles: true,
                }).holes,
            }),
            {
                gridMesh: {
                    type: ShapeType.Mesh,
                    vertices: [
                        {
                            x: -0.5,
                            y: 0,
                            z: -1,
                        },
                        {
                            x: -0.5,
                            y: 0,
                            z: 0,
                        },
                        {
                            x: -0.5,
                            y: 0,
                            z: 1,
                        },
                        {
                            x: 0.5,
                            y: 0,
                            z: -1,
                        },
                        {
                            x: 0.5,
                            y: 0,
                            z: 0,
                        },
                        {
                            x: 0.5,
                            y: 0,
                            z: 1,
                        },
                    ],
                    triangles: [
                        [
                            0,
                            1,
                            4,
                        ],
                        [
                            4,
                            3,
                            0,
                        ],
                        [
                            1,
                            2,
                            5,
                        ],
                        [
                            5,
                            4,
                            1,
                        ],
                    ],
                },
                waveMesh: [
                    {
                        x: -1,
                        y: 0,
                        z: -1,
                    },
                    {
                        x: -1,
                        y: 0,
                        z: 1,
                    },
                    {
                        x: 1,
                        y: 0,
                        z: -1,
                    },
                    {
                        x: 1,
                        y: 3,
                        z: 1,
                    },
                ],
                torus: [
                    12,
                    24,
                    {
                        lowerBound: {
                            x: -2.5,
                            y: -2.5,
                            z: -0.433,
                        },
                        upperBound: {
                            x: 2.5,
                            y: 2.5,
                            z: 0.433,
                        },
                    },
                ],
                boxMesh: [
                    12,
                    {
                        lowerBound: {
                            x: 0,
                            y: -2,
                            z: -3,
                        },
                        upperBound: {
                            x: 2,
                            y: 2,
                            z: 3,
                        },
                    },
                ],
                boxFromInside: undefined,
                hollowBoxFromInside: {
                    x: 0,
                    y: -1,
                    z: 0,
                },
                platform: {
                    lowerBound: {
                        x: -2,
                        y: -0.5,
                        z: -2,
                    },
                    upperBound: {
                        x: 2,
                        y: 0.5,
                        z: 2,
                    },
                },
                cylinder: {
                    type: ShapeType.Hull,
                    points: [
                        {
                            x: 1,
                            y: 3,
                            z: 0,
                        },
                        {
                            x: -0.501,
                            y: 1,
                            z: 0.866,
                        },
                        {
                            x: -0.501,
                            y: 1,
                            z: -0.866,
                        },
                        {
                            x: -0.501,
                            y: 3,
                            z: 0.866,
                        },
                        {
                            x: -0.501,
                            y: 3,
                            z: -0.866,
                        },
                        {
                            x: 1,
                            y: 1,
                            z: 0,
                        },
                    ],
                },
                cone: {
                    lowerBound: {
                        x: -1,
                        y: 0,
                        z: -1,
                    },
                    upperBound: {
                        x: 1,
                        y: 2,
                        z: 1,
                    },
                },
                unraisedCylinder: [
                    [
                        0,
                        2,
                    ],
                ],
                denseMass: 16,
                rockPointCount: 10,
                hull: [
                    {
                        x: 0,
                        y: 1,
                        z: 0,
                    },
                    {
                        x: 1,
                        y: 0,
                        z: 0,
                    },
                    {
                        x: 0,
                        y: 0,
                        z: 1,
                    },
                    {
                        x: 0,
                        y: 0,
                        z: 0,
                    },
                ],
                flatHull: undefined,
                waveHeightField: {
                    type: ShapeType.HeightField,
                    heights: [
                        [
                            -0.004,
                            -0.004,
                            -0.004,
                        ],
                        [
                            -0.004,
                            0.996,
                            -0.004,
                        ],
                    ],
                    scale: {
                        x: 1,
                        y: 1,
                        z: 1,
                    },
                    heightRange: {
                        minimum: -256,
                        maximum: 256,
                    },
                },
                holes: [
                    {
                        row: 8,
                        column: 0,
                    },
                    {
                        row: 16,
                        column: 0,
                    },
                ],
            },
        );
    });

    it('rejects invalid builder inputs', async () => {
        const geometry = await PhysicsGeometry3d.create();
        const scale = {
            x: 1,
            y: 1,
            z: 1,
        };

        assert.throws(
            () => {
                return geometry.createCylinderHull({
                    height: 1,
                    radius: 1,
                    sideCount: 33,
                });
            },
            {
                matchMessage: 'sideCount must be a whole number from 3 to 32, got 33.',
            },
        );
        assert.throws(
            () => {
                return geometry.createConeHull({
                    height: 1,
                    bottomRadius: 0,
                    topRadius: 1,
                    sideCount: 4,
                });
            },
            {
                matchMessage: 'bottomRadius must be positive, got 0.',
            },
        );
        assert.throws(
            () => {
                return geometry.createConeHull({
                    height: 1,
                    bottomRadius: 1,
                    topRadius: 1,
                    sideCount: 3,
                });
            },
            {
                matchMessage: 'sideCount must be a whole number from 4 to 32, got 3.',
            },
        );
        assert.throws(() => geometry.createRockHull(-1), {
            matchMessage: 'radius must be positive, got -1.',
        });
        assert.throws(
            () => {
                return geometry.createGridMesh({
                    xCount: 1.5,
                    zCount: 1,
                    cellWidth: 1,
                });
            },
            {
                matchMessage: 'xCount must be a positive whole number, got 1.5.',
            },
        );
        assert.throws(
            () => {
                return geometry.createWaveMesh({
                    xCount: 1,
                    zCount: 1,
                    cellWidth: Number.NaN,
                    amplitude: 1,
                    rowFrequency: 1,
                    columnFrequency: 1,
                });
            },
            {
                matchMessage: 'cellWidth must be positive, got NaN.',
            },
        );
        assert.throws(
            () => {
                return geometry.createTorusMesh({
                    radialResolution: 3,
                    tubularResolution: 2,
                    radius: 1,
                    thickness: 0.5,
                });
            },
            {
                matchMessage: 'tubularResolution must be a whole number from 3',
            },
        );
        assert.throws(
            () => {
                return geometry.createHollowBoxMesh({
                    width: 1,
                    height: 0,
                    depth: 1,
                });
            },
            {
                matchMessage: 'height must be positive, got 0.',
            },
        );
        assert.throws(
            () => {
                return geometry.createPlatformMesh({
                    height: 1,
                    topWidth: -1,
                    bottomWidth: 1,
                });
            },
            {
                matchMessage: 'topWidth must be positive, got -1.',
            },
        );
        assert.throws(
            () => {
                return geometry.createGridHeightField({
                    rowCount: 1,
                    columnCount: 2,
                    scale,
                });
            },
            {
                matchMessage: 'rowCount must be a whole number from 2',
            },
        );
        assert.throws(
            () => {
                return geometry.createGridHeightField({
                    rowCount: 2,
                    columnCount: 2,
                    scale: {
                        ...scale,
                        y: 0,
                    },
                });
            },
            {
                matchMessage: 'scale.y must be positive, got 0.',
            },
        );
        assert.throws(
            () => {
                return geometry.computeBounds({
                    shape: {
                        type: ShapeType.Compound,
                        children: [],
                    },
                });
            },
            {
                matchMessage: 'A compound needs at least 1 child.',
            },
        );
        assert.throws(() => {
            return geometry.overlap({
                shapeA: geometryShapes.box,
                shapeB: {
                    type: ShapeType.Hull,
                    points: createArray(65, (index) => {
                        return {
                            x: Math.cos(index),
                            y: Math.sin(index),
                            z: index / 65,
                        };
                    }),
                },
            });
        });
    });

    it('queries proxies in dynamic trees', async () => {
        const geometry = await PhysicsGeometry3d.create();
        const tree = geometry.createTree();
        const proxyIds = createArray(5, (index) => {
            return tree.createProxy({
                bounds: {
                    lowerBound: {
                        x: index * 10,
                        y: 0,
                        z: 0,
                    },
                    upperBound: {
                        x: index * 10 + 1,
                        y: 1,
                        z: 1,
                    },
                },
                category: index === 4 ? 2n : undefined,
            });
        });
        const [
            first,
            second,
            third,
            fourth,
            fifth,
        ] = assertWrap.isLengthExactly(proxyIds, 5);
        const everywhere = {
            lowerBound: {
                x: -1,
                y: -1,
                z: -1,
            },
            upperBound: {
                x: 100,
                y: 2,
                z: 2,
            },
        };

        assert.deepEquals(
            roundGeometry({
                closest: tree.queryClosest({
                    point: {
                        x: 12,
                        y: 0.5,
                        z: 0.5,
                    },
                }),
                tooFar: tree.queryClosest({
                    point: {
                        x: 12,
                        y: 0.5,
                        z: 0.5,
                    },
                    maxDistance: 0.5,
                }),
                maskedClosest: tree.queryClosest({
                    point: {
                        x: 40.5,
                        y: 0.5,
                        z: 0.5,
                    },
                    mask: 2n,
                }),
                stats: tree.getStats(),
                rebuilt: [
                    tree.rebuild(),
                    tree.rebuild({
                        isFullBuild: true,
                    }),
                ],
            }),
            {
                closest: {
                    proxyId: second,
                    distance: 1,
                },
                tooFar: undefined,
                maskedClosest: {
                    proxyId: fifth,
                    distance: 0,
                },
                stats: {
                    height: 3,
                    areaRatio: 1.072,
                    proxyCount: 5,
                    byteCount: 1544,
                    rootBounds: {
                        lowerBound: {
                            x: 0,
                            y: 0,
                            z: 0,
                        },
                        upperBound: {
                            x: 41,
                            y: 1,
                            z: 1,
                        },
                    },
                },
                rebuilt: [
                    1,
                    5,
                ],
            },
        );

        tree.enlargeProxy({
            proxyId: first,
            bounds: {
                lowerBound: {
                    x: 0,
                    y: 0,
                    z: 0,
                },
                upperBound: {
                    x: 3,
                    y: 1,
                    z: 1,
                },
            },
        });
        tree.moveProxy({
            proxyId: third,
            bounds: {
                lowerBound: {
                    x: 0,
                    y: 5,
                    z: 0,
                },
                upperBound: {
                    x: 1,
                    y: 6,
                    z: 1,
                },
            },
        });
        tree.setProxyCategory({
            proxyId: second,
            category: 6n,
        });
        tree.destroyProxy(fourth);

        assert.deepEquals(
            {
                enlarged: tree.getProxyBounds(first).upperBound,
                category: tree.getProxyCategory(second),
                found: tree
                    .queryBounds({
                        bounds: everywhere,
                    })
                    .toSorted(),
                allBits: tree
                    .queryBounds({
                        bounds: everywhere,
                        mask: 6n,
                        requireAllBits: true,
                    })
                    .toSorted(),
                ray: tree
                    .castRay({
                        origin: {
                            x: 0.5,
                            y: -1,
                            z: 0.5,
                        },
                        translation: {
                            x: 0,
                            y: 10,
                            z: 0,
                        },
                    })
                    .toSorted(),
                shortRay: tree.castRay({
                    origin: {
                        x: 0.5,
                        y: -1,
                        z: 0.5,
                    },
                    translation: {
                        x: 0,
                        y: 10,
                        z: 0,
                    },
                    maxFraction: 0.3,
                    mask: 2n ** 64n - 1n,
                }),
                box: tree
                    .castBox({
                        bounds: {
                            lowerBound: {
                                x: -2,
                                y: 0,
                                z: 0,
                            },
                            upperBound: {
                                x: -1,
                                y: 1,
                                z: 1,
                            },
                        },
                        translation: {
                            x: 15,
                            y: 0,
                            z: 0,
                        },
                    })
                    .toSorted(),
            },
            {
                enlarged: {
                    x: 3,
                    y: 1,
                    z: 1,
                },
                category: 6n,
                found: [
                    first,
                    second,
                    fifth,
                ].toSorted(),
                allBits: [
                    first,
                    second,
                ].toSorted(),
                ray: [
                    first,
                    third,
                ].toSorted(),
                shortRay: [first],
                box: [
                    first,
                    second,
                ].toSorted(),
            },
        );

        assert.throws(() => tree.destroyProxy(fourth), {
            matchMessage: `The dynamic tree has no proxy ${fourth}.`,
        });
        tree.destroy();
        tree.destroy();
        assert.throws(() => tree.getStats(), {
            matchMessage: 'The dynamic tree has been destroyed.',
        });
    });
});
