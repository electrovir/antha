import {BodyType} from '@antha/entity-core';
import {assert, assertWrap, check} from '@augment-vir/assert';
import {
    awaitedForEach,
    createArray,
    getObjectTypedValues,
    mapObjectValues,
    omitObjectKeys,
    removeDuplicates,
    round,
    selectFrom,
} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {checkValidShape} from 'object-shape-tester';
import {
    GeometryShapeType2d,
    JointType,
    PhysicsGeometry2d,
    PhysicsReplay2d,
    PhysicsWorld2d,
    ReplayQueryType2d,
    ShapeType,
    TimeOfImpactState2d,
    bodyStateShape,
    type BodyState,
    type CastShapeDefinition,
    type EntityPhysicsDefinition,
    type GeometryShape2d,
    type JointDefinition2d,
    type PhysicsShapeDefinition,
    type WorldHooks2d,
} from './physics.js';

const ballDefinition = {
    type: BodyType.Dynamic,
    shapes: [
        {
            type: ShapeType.Circle,
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

/** A static 2 unit square centered at x = 5, entity 3. */
function createWall(world: Readonly<PhysicsWorld2d>) {
    return world.createBody({
        definition: {
            type: BodyType.Static,
            shapes: [
                {
                    type: ShapeType.Box,
                    width: 2,
                    height: 2,
                },
            ],
        },
        filter: touchingFilter,
        entityId: 3,
        bodyState: {
            position: {
                x: 5,
                y: 0,
            },
        },
    });
}

/**
 * A shapeless static anchor at the origin, entity 1, joined to a ball at x = 4, entity 2. Neither
 * collides with anything, so pairs in one world don't disturb each other.
 */
function createJoinedPair<const Definition extends JointDefinition2d>(
    world: Readonly<PhysicsWorld2d>,
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
    },
    angle: 0,
};

function stepWorld(world: Readonly<PhysicsWorld2d>, stepCount: number) {
    return createArray(stepCount, () => world.step(1 / 60));
}

describe(PhysicsWorld2d.name, () => {
    it('throws when used after being destroyed', async () => {
        const world = await PhysicsWorld2d.create();
        world.destroy();

        world.destroy();

        assert.throws(() => world.getStateHash(), {
            matchMessage: 'The physics world has been destroyed.',
        });
    });

    it('applies gravity changes between steps', async () => {
        const world = await PhysicsWorld2d.create();
        world.setGravity({
            x: 1,
            y: 0,
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
            y: 2,
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
                },
                afterSecondStep: {
                    x: 1,
                    y: 2,
                },
                gravity: {
                    x: 0,
                    y: 2,
                },
            },
        );
        world.destroy();
    });

    it('creates bodies with every body type, shape type, and setting', async () => {
        const world = await PhysicsWorld2d.create({
            pixelsPerMeter: 2,
        });
        const bodies = [
            BodyType.Static,
            BodyType.Kinematic,
            BodyType.Dynamic,
        ].map((type, index) => {
            return world.createBody({
                definition: {
                    type,
                    motionLocks: {
                        angularZ: true,
                    },
                    gravityScale: 2,
                    isBullet: true,
                    enableHitEvents: true,
                    linearDamping: 1,
                    angularDamping: 1,
                    shapes: [
                        {
                            type: ShapeType.Circle,
                            radius: 1,
                            offset: {
                                x: 1,
                                y: 0,
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
                            offset: {
                                x: 0,
                                y: 1,
                            },
                            material: {},
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
                    },
                },
            });
        });

        assert.deepEquals(
            bodies.map((body) => Math.round(body.getMass())),
            [
                0,
                0,
                /** A density 2 circle of radius 1 plus a density 1 box of 2 by 4. */
                Math.round(2 * Math.PI + 8),
            ],
        );
        world.destroy();
    });

    it('reads and writes body state', async () => {
        const world = await PhysicsWorld2d.create();
        const ball = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                position: {
                    x: 1,
                    y: 2,
                },
                rotation: 0.5,
                velocity: {
                    x: 3,
                    y: 4,
                },
                angularVelocity: 1,
            },
        });
        const initialState = ball.getState();

        ball.setPosition({
            x: 10,
            y: 20,
        });
        ball.setRotation(-1);
        ball.setVelocity({
            x: 0,
            y: 0,
        });
        ball.setAngularVelocity(2);

        assert.deepEquals(
            {
                initialState: {
                    ...initialState,
                    sleepThreshold: round(initialState.sleepThreshold, {
                        digits: 3,
                    }),
                    rotation:
                        Math.round(
                            Math.atan2(initialState.rotation.sine, initialState.rotation.cosine) *
                                100,
                        ) / 100,
                },
                position: ball.getPosition(),
                rotation: Math.round(ball.getRotation() * 100) / 100,
                velocity: ball.getVelocity(),
                angularVelocity: ball.getAngularVelocity(),
            },
            {
                initialState: {
                    position: {
                        x: 1,
                        y: 2,
                    },
                    rotation: 0.5,
                    velocity: {
                        x: 3,
                        y: 4,
                    },
                    angularVelocity: 1,
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
                        angularZ: false,
                    },
                    material: {},
                    shapes: undefined,
                    massData: undefined,
                },
                position: {
                    x: 10,
                    y: 20,
                },
                rotation: -1,
                velocity: {
                    x: 0,
                    y: 0,
                },
                angularVelocity: 2,
            },
        );
        world.destroy();
    });

    it('locks motion along locked axes and turning', async () => {
        const world = await PhysicsWorld2d.create();
        const body = world.createBody({
            definition: {
                ...ballDefinition,
                motionLocks: {
                    linearY: true,
                    angularZ: true,
                },
            },
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                velocity: {
                    x: 1,
                    y: 2,
                },
                angularVelocity: 3,
            },
        });
        world.step(1 / 60);

        assert.deepEquals(
            {
                velocity: roundCoords(body.getVelocity()),
                angularVelocity: body.getAngularVelocity(),
            },
            {
                velocity: {
                    x: 1,
                    y: 0,
                },
                angularVelocity: 0,
            },
        );
        world.destroy();
    });

    it('reads and changes body settings', async () => {
        const world = await PhysicsWorld2d.create();
        world.setGravity({
            x: 0,
            y: -10,
        });
        const floating = world.createBody({
            definition: {
                ...ballDefinition,
                gravityScale: 0,
                isBullet: true,
                motionLocks: {
                    linearX: true,
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
            angularZ: true,
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
                    motionLocks: true,
                }),
                disabledPosition: initial.disabled.position,
                disabledIsDisabled: initial.disabled.isDisabled,
                restoredVelocityY: initial.restoredVelocityY,
                changed: {
                    type: floating.getType(),
                    isBullet: floating.isBullet(),
                    gravityScale: floating.getGravityScale(),
                    motionLocks: floating.getMotionLocks(),
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
                    },
                    type: BodyType.Dynamic,
                    gravityScale: 0,
                    isDisabled: false,
                    isBullet: true,
                    motionLocks: {
                        linearX: true,
                        linearY: false,
                        angularZ: false,
                    },
                },
                disabledPosition: {
                    x: 10,
                    y: 0,
                },
                disabledIsDisabled: true,
                restoredVelocityY: 0,
                changed: {
                    type: BodyType.Kinematic,
                    isBullet: false,
                    gravityScale: 3,
                    motionLocks: {
                        linearX: false,
                        linearY: false,
                        angularZ: true,
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
            const world = await PhysicsWorld2d.create();
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
                                },
                                normal: {
                                    x: -1,
                                    y: 0,
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
                                },
                                normal: {
                                    x: 1,
                                    y: 0,
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
        const world = await PhysicsWorld2d.create();
        world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Box,
                        width: 2,
                        height: 2,
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
        const world = await PhysicsWorld2d.create();
        world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Circle,
                        radius: 1,
                    },
                    {
                        type: ShapeType.Circle,
                        radius: 1,
                        offset: {
                            x: 1,
                            y: 0,
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
                        type: ShapeType.Circle,
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
            },
            upperBound: {
                x: 10,
                y: 10,
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
                        },
                        position: {
                            x: 0,
                            y: 0,
                        },
                        rotation: 0.5,
                    })
                    .toSorted(),
                nearWall: world.overlapShape({
                    shape: {
                        type: ShapeType.Circle,
                        radius: 0.5,
                    },
                    position: {
                        x: 3.75,
                        y: 0,
                    },
                    filter: touchingFilter,
                }),
                nothing: world.overlapShape({
                    shape: {
                        type: ShapeType.Circle,
                        radius: 0.5,
                    },
                    position: {
                        x: 0,
                        y: 50,
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

    it('snaps the previous transform on teleports but not on steps', async () => {
        const world = await PhysicsWorld2d.create();
        const ball = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                velocity: {
                    x: 1,
                    y: 0,
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
        });
        const afterTeleport = {
            previous: ball.previousTransform.position.x,
            current: ball.currentTransform.position.x,
        };
        ball.setRotation(1);

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
        const world = await PhysicsWorld2d.create();
        const spinner = world.createBody({
            definition: {
                type: BodyType.Kinematic,
            },
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                angularVelocity: 2,
            },
        });
        await awaitedForEach(
            createArray(240, () => undefined),
            () => {
                world.step(1 / 120);
            },
        );

        assert.strictEquals(spinner.getAngularVelocity(), 2);
        world.destroy();
    });

    it('applies forces and impulses', async () => {
        const world = await PhysicsWorld2d.create();
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
                },
            },
        });

        pushed.applyForce({
            x: pushed.getMass(),
            y: 0,
        });
        kicked.applyImpulse({
            x: 0,
            y: kicked.getMass(),
        });
        world.step(1);

        assert.deepEquals(
            {
                pushed: pushed.getVelocity(),
                kicked: kicked.getVelocity(),
            },
            {
                pushed: {
                    x: 1,
                    y: 0,
                },
                kicked: {
                    x: 0,
                    y: 1,
                },
            },
        );
        world.destroy();
    });

    it('reads contact normals pointing toward each body', async () => {
        const world = await PhysicsWorld2d.create();
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
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 2,
            bodyState: {
                position: {
                    x: 1.25,
                    y: 0,
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
                /** Adding 0 turns the -0 of a flipped normal into 0. */
                ballNormal: {
                    x: (ballContact?.normal.x ?? 0) + 0,
                    y: (ballContact?.normal.y ?? 0) + 0,
                },
                wallNormal: {
                    x: (wallContact?.normal.x ?? 0) + 0,
                    y: (wallContact?.normal.y ?? 0) + 0,
                },
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
                },
                wallNormal: {
                    x: 1,
                    y: 0,
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
        const world = await PhysicsWorld2d.create();
        world.createBody({
            definition: {
                type: BodyType.Dynamic,
                shapes: [
                    {
                        type: ShapeType.Circle,
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
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 9,
            bodyState: {
                position: {
                    x: 3,
                    y: 0,
                },
            },
        });
        const results: ReturnType<PhysicsWorld2d['step']>[] = [];
        await awaitedForEach(
            createArray(60, () => undefined),
            () => {
                results.push(world.step(1 / 60));
            },
        );

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

    it('skips end contacts of destroyed bodies', async () => {
        const world = await PhysicsWorld2d.create();
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
                },
            },
        });
        const firstStep = world.step(1 / 60);
        world.destroyBody(first);
        world.destroyBody(first);
        const secondStep = world.step(1 / 60);

        assert.deepEquals(
            {
                firstStarted: firstStep.started,
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
        const world = await PhysicsWorld2d.create();
        world.setGravity({
            x: 0,
            y: 1,
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
            y: 1,
        });
        world.destroy();
    });
    it('pushes and spins bodies at points', async () => {
        const world = await PhysicsWorld2d.create();
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
                    },
                },
            });
        });
        /** A solid circle of radius 1 resists spinning with half of its mass. */
        const inertia = pushed.getMass() / 2;
        const stepSeconds = 1 / 60;

        pushed.applyForceAtPoint({
            force: {
                x: 0,
                y: pushed.getMass() / stepSeconds,
            },
            point: {
                x: 1,
                y: 0,
            },
        });
        kicked.applyImpulseAtPoint({
            impulse: {
                x: 0,
                y: kicked.getMass(),
            },
            point: {
                x: 11,
                y: 0,
            },
        });
        twisted.applyTorque(inertia / stepSeconds);
        spun.applyAngularImpulse(inertia);
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
                    angularVelocity: round(body.getAngularVelocity(), {
                        digits: 3,
                    }),
                };
            }),
            [
                {
                    velocity: {
                        x: 0,
                        y: 1,
                    },
                    angularVelocity: 2,
                },
                {
                    velocity: {
                        x: 0,
                        y: 1,
                    },
                    angularVelocity: 2,
                },
                {
                    velocity: {
                        x: 0,
                        y: 0,
                    },
                    angularVelocity: 1,
                },
                {
                    velocity: {
                        x: 0,
                        y: 0,
                    },
                    angularVelocity: 1,
                },
            ],
        );
        world.destroy();
    });

    it('converts points and vectors between body and world space', async () => {
        const world = await PhysicsWorld2d.create();
        const body = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                position: {
                    x: 1,
                    y: 2,
                },
                rotation: Math.PI / 2,
                angularVelocity: 1,
            },
        });

        assert.deepEquals(
            {
                worldPoint: roundCoords(
                    body.getWorldPoint({
                        x: 1,
                        y: 0,
                    }),
                ),
                localPoint: roundCoords(
                    body.getLocalPoint({
                        x: 1,
                        y: 3,
                    }),
                ),
                worldVector: roundCoords(
                    body.getWorldVector({
                        x: 1,
                        y: 0,
                    }),
                ),
                localVector: roundCoords(
                    body.getLocalVector({
                        x: 0,
                        y: 1,
                    }),
                ),
                pointVelocity: roundCoords(
                    body.getPointVelocity({
                        x: 2,
                        y: 2,
                    }),
                ),
            },
            {
                worldPoint: {
                    x: 1,
                    y: 3,
                },
                localPoint: {
                    x: 1,
                    y: 0,
                },
                worldVector: {
                    x: 0,
                    y: 1,
                },
                localVector: {
                    x: 1,
                    y: 0,
                },
                pointVelocity: {
                    x: 0,
                    y: 1,
                },
            },
        );
        world.destroy();
    });

    it('casts rays at the closest matching shape', async () => {
        const world = await PhysicsWorld2d.create();
        createWall(world);
        const ray = {
            origin: {
                x: 0,
                y: 0,
            },
            translation: {
                x: 10,
                y: 0,
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
                    },
                }),
            },
            {
                hit: {
                    entityId: 3,
                    point: {
                        x: 4,
                        y: 0,
                    },
                    normal: {
                        x: -1,
                        y: 0,
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
        const world = await PhysicsWorld2d.create();
        createWall(world);
        const casts: ReadonlyArray<
            Readonly<{
                shape: CastShapeDefinition;
                rotation?: number | undefined;
            }>
        > = [
            {
                shape: {
                    type: ShapeType.Circle,
                    radius: 1,
                },
            },
            {
                shape: {
                    type: ShapeType.Circle,
                    radius: 1,
                    offset: {
                        x: 1,
                        y: 0,
                    },
                },
            },
            {
                shape: {
                    type: ShapeType.Box,
                    width: 2,
                    height: 2,
                },
            },
            {
                shape: {
                    type: ShapeType.Box,
                    width: 4,
                    height: 2,
                },
                rotation: Math.PI / 2,
            },
            {
                shape: {
                    type: ShapeType.Box,
                    width: 2,
                    height: 2,
                    cornerRadius: 0.5,
                },
            },
            {
                shape: {
                    type: ShapeType.Capsule,
                    center1: {
                        x: -1,
                        y: 0,
                    },
                    center2: {
                        x: 1,
                        y: 0,
                    },
                    radius: 0.5,
                },
            },
            {
                shape: {
                    type: ShapeType.Segment,
                    point1: {
                        x: 0,
                        y: -1,
                    },
                    point2: {
                        x: 0,
                        y: 1,
                    },
                },
            },
            {
                shape: {
                    type: ShapeType.Polygon,
                    points: [
                        {
                            x: 1,
                            y: 0,
                        },
                        {
                            x: -1,
                            y: 1,
                        },
                        {
                            x: -1,
                            y: -1,
                        },
                    ],
                },
            },
            {
                shape: {
                    type: ShapeType.Polygon,
                    cornerRadius: 0.5,
                    points: [
                        {
                            x: 1,
                            y: 0,
                        },
                        {
                            x: -1,
                            y: 1,
                        },
                        {
                            x: -1,
                            y: -1,
                        },
                    ],
                },
            },
        ];

        assert.deepEquals(
            {
                fractions: casts.map(({shape, rotation}) => {
                    const hit = world.castShape({
                        shape,
                        rotation,
                        position: {
                            x: 0,
                            y: 0,
                        },
                        translation: {
                            x: 10,
                            y: 0,
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
                    },
                    translation: {
                        x: 10,
                        y: 0,
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
                    0.3,
                    0.3,
                    0.25,
                    0.4,
                    0.3,
                    0.25,
                ],
                filtered: undefined,
            },
        );
        world.destroy();
    });

    it('creates polygon shapes', async () => {
        const world = await PhysicsWorld2d.create();
        const triangle = world.createBody({
            definition: {
                type: BodyType.Dynamic,
                shapes: [
                    {
                        type: ShapeType.Polygon,
                        points: [
                            {
                                x: 0,
                                y: 0,
                            },
                            {
                                x: 2,
                                y: 0,
                            },
                            {
                                x: 0,
                                y: 2,
                            },
                        ],
                        offset: {
                            x: 1,
                            y: 0,
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
                                type: ShapeType.Polygon,
                                points: createArray(3, (index) => {
                                    return {
                                        x: index,
                                        y: index,
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
                matchMessage: 'Polygon points must not all lie on one line.',
            },
        );
        assert.deepEquals(
            {
                mass: round(triangle.getMass(), {
                    digits: 3,
                }),
                rayHit: world.castRay({
                    origin: {
                        x: 5,
                        y: 0.5,
                    },
                    translation: {
                        x: -10,
                        y: 0,
                    },
                })?.point,
            },
            {
                mass: 2,
                rayHit: {
                    x: 2.5,
                    y: 0.5,
                },
            },
        );
        world.destroy();
    });

    it('creates chain shapes', async () => {
        const world = await PhysicsWorld2d.create();
        world.setGravity({
            x: 0,
            y: 10,
        });
        const ball = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {},
        });
        world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Chain,
                        points: [
                            {
                                x: -5,
                                y: 0,
                            },
                            {
                                x: 5,
                                y: 0,
                            },
                        ],
                        offset: {
                            x: 0,
                            y: 2,
                        },
                    },
                    {
                        type: ShapeType.Chain,
                        isLoop: true,
                        points: [
                            {
                                x: 19,
                                y: -1,
                            },
                            {
                                x: 21,
                                y: -1,
                            },
                            {
                                x: 21,
                                y: 1,
                            },
                            {
                                x: 19,
                                y: 1,
                            },
                        ],
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 2,
            bodyState: {},
        });
        const results: ReturnType<PhysicsWorld2d['step']>[] = [];
        await awaitedForEach(
            createArray(120, () => undefined),
            () => {
                results.push(world.step(1 / 60));
            },
        );

        assert.deepEquals(
            {
                ballY: round(ball.getPosition().y, {
                    digits: 1,
                }),
                started: results.flatMap((result) => result.started).map((pair) => pair.toSorted()),
                loopHit: world.castRay({
                    origin: {
                        x: 15,
                        y: 0,
                    },
                    translation: {
                        x: 10,
                        y: 0,
                    },
                })?.point,
            },
            {
                ballY: 1,
                started: [
                    [
                        1,
                        2,
                    ],
                ],
                loopHit: {
                    x: 19,
                    y: 0,
                },
            },
        );
        world.destroy();
    });

    it('rejects invalid shapes before creating the body', async () => {
        const world = await PhysicsWorld2d.create();
        const invalidShapes: ReadonlyArray<
            Readonly<{
                shape: PhysicsShapeDefinition[];
                message: string;
            }>
        > = [
            {
                shape: [
                    {
                        type: ShapeType.Polygon,
                        points: createArray(2, (index) => {
                            return {
                                x: index,
                                y: 0,
                            };
                        }),
                    },
                ],
                message: 'A polygon needs 3 to 8 points, got 2.',
            },
            {
                shape: [
                    {
                        type: ShapeType.Polygon,
                        points: createArray(9, (index) => {
                            return {
                                x: Math.cos(index),
                                y: Math.sin(index),
                            };
                        }),
                    },
                ],
                message: 'A polygon needs 3 to 8 points, got 9.',
            },
            {
                shape: [
                    {
                        type: ShapeType.Chain,
                        points: [
                            {
                                x: 0,
                                y: 0,
                            },
                        ],
                    },
                ],
                message: 'A chain needs at least 2 points, got 1.',
            },
            {
                shape: [
                    {
                        type: ShapeType.Chain,
                        isLoop: true,
                        points: createArray(2, (index) => {
                            return {
                                x: index,
                                y: 0,
                            };
                        }),
                    },
                ],
                message: 'A chain loop needs at least 3 points, got 2.',
            },
        ];

        invalidShapes.forEach(({shape, message}) => {
            assert.throws(
                () => {
                    return world.createBody({
                        definition: {
                            type: BodyType.Static,
                            shapes: shape,
                        },
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
        const world = await PhysicsWorld2d.create();
        const definitions: Record<JointType, JointDefinition2d> = {
            [JointType.Distance]: {
                type: JointType.Distance,
                length: 4,
            },
            [JointType.Filter]: {
                type: JointType.Filter,
            },
            [JointType.Motor]: {
                type: JointType.Motor,
                maxVelocityForce: 10,
            },
            [JointType.Mover]: {
                type: JointType.Mover,
                linearVelocity: {
                    x: 1,
                    y: 0,
                },
                maxVelocityForce: {
                    x: 10,
                    y: 10,
                },
            },
            [JointType.Pogo]: {
                type: JointType.Pogo,
                normal: {
                    x: 1,
                    y: 0,
                },
                restLength: 4,
                hertz: 5,
                dampingRatio: 1,
                maxCompressionForce: 100,
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
            [JointType.Weld]: {
                type: JointType.Weld,
                frameB: ballFrameAtAnchor,
                linearHertz: 5,
            },
            [JointType.Wheel]: {
                type: JointType.Wheel,
                enableMotor: true,
                maxMotorTorque: 10,
                motorSpeed: 1,
            },
        };
        const joints = getObjectTypedValues(definitions).map((definition) => {
            return createJoinedPair<JointDefinition2d>(world, definition).joint;
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
        const world = await PhysicsWorld2d.create();
        world.setGravity({
            x: 0,
            y: 10,
        });
        const {ball, joint} = createJoinedPair(world, {
            type: JointType.Distance,
            length: 4,
        });
        stepWorld(world, 60);
        const position = ball.getPosition();

        assert.deepEquals(
            {
                distance: round(Math.hypot(position.x, position.y), {
                    digits: 2,
                }),
                length: round(joint.read().length, {
                    digits: 2,
                }),
                hasSwung: position.y > 1,
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
        const world = await PhysicsWorld2d.create();
        const {ball, joint} = createJoinedPair(world, {
            type: JointType.Revolute,
            frameB: ballFrameAtAnchor,
            enableMotor: true,
            maxMotorTorque: 1000,
            motorSpeed: 2,
        });
        stepWorld(world, 30);
        const firstSpeed = joint.read().speed;
        joint.update({
            motorSpeed: -1,
        });
        stepWorld(world, 30);

        assert.deepEquals(
            {
                firstSpeed: round(firstSpeed, {
                    digits: 1,
                }),
                secondSpeed: round(joint.read().speed, {
                    digits: 1,
                }),
                angularVelocity: round(ball.getAngularVelocity(), {
                    digits: 1,
                }),
                motorSpeed: joint.getDefinition().motorSpeed,
            },
            {
                firstSpeed: 2,
                secondSpeed: -1,
                angularVelocity: -1,
                motorSpeed: -1,
            },
        );
        world.destroy();
    });

    it('reports joints pulling harder than their thresholds', async () => {
        const world = await PhysicsWorld2d.create();
        world.setGravity({
            x: 0,
            y: 10,
        });
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
        const world = await PhysicsWorld2d.create();
        world.setGravity({
            x: 0,
            y: 10,
        });
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
                heldY: round(heldY, {
                    digits: 1,
                }),
                hasFallen: ball.getPosition().y > 1,
            },
            {
                heldY: 0,
                hasFallen: true,
            },
        );
        world.destroy();
    });

    it('changes shape materials and keeps them in body state', async () => {
        const world = await PhysicsWorld2d.create();
        const wall = createWall(world);
        const ball = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                position: {
                    x: 5,
                    y: 3,
                },
                velocity: {
                    x: 0,
                    y: -10,
                },
            },
        });
        const originalMass = ball.getMass();
        ball.setMaterial({
            density: 2,
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
                        digits: 2,
                    });
                }),
                material: ball.getMaterial(),
                copyMaterial: copy.getMaterial(),
                isBouncingUp: ball.getVelocity().y > 5,
                wallMaterial: wall.getState().material,
            },
            {
                masses: [
                    3.14,
                    6.28,
                    6.28,
                ],
                material: {
                    density: 2,
                    restitution: 1,
                    friction: 0.1,
                },
                copyMaterial: {
                    density: 2,
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
        const world = await PhysicsWorld2d.create();
        const platform = world.createBody({
            definition: {
                type: BodyType.Kinematic,
                shapes: ballDefinition.shapes,
            },
            filter: touchingFilter,
            entityId: 1,
            bodyState: {},
        });
        platform.setTargetTransform({
            position: {
                x: 1,
                y: 2,
            },
            rotation: 0.5,
            stepSeconds: 1 / 60,
        });
        world.step(1 / 60);
        const first = {
            position: roundCoords(platform.getPosition()),
            rotation: round(platform.getRotation(), {
                digits: 2,
            }),
        };
        platform.setTargetTransform({
            position: {
                x: 3,
                y: 2,
            },
            stepSeconds: 1 / 60,
        });
        world.step(1 / 60);

        assert.deepEquals(
            {
                first,
                second: {
                    position: roundCoords(platform.getPosition()),
                    rotation: round(platform.getRotation(), {
                        digits: 2,
                    }),
                },
            },
            {
                first: {
                    position: {
                        x: 1,
                        y: 2,
                    },
                    rotation: 0.5,
                },
                second: {
                    position: {
                        x: 3,
                        y: 2,
                    },
                    rotation: 0.5,
                },
            },
        );
        world.destroy();
    });

    it('pushes bodies away from explosions', async () => {
        const world = await PhysicsWorld2d.create();
        const [
            near,
            far,
            masked,
        ] = [
            {
                position: {
                    x: 2,
                    y: 0,
                },
                category: 1n,
            },
            {
                position: {
                    x: 20,
                    y: 0,
                },
                category: 1n,
            },
            {
                position: {
                    x: 0,
                    y: 2,
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
            },
            radius: 3,
            impulsePerLength: 10,
            mask: 1n,
        });
        world.explode({
            position: {
                x: 0,
                y: 0,
            },
            radius: 3,
            falloff: 1,
            impulsePerLength: 0,
        });

        assert.deepEquals(
            {
                isNearPushedAway: assertWrap.isDefined(near).getVelocity().x > 1,
                nearSideways: round(assertWrap.isDefined(near).getVelocity().y, {
                    digits: 3,
                }),
                far: assertWrap.isDefined(far).getVelocity(),
                masked: assertWrap.isDefined(masked).getVelocity(),
            },
            {
                isNearPushedAway: true,
                nearSideways: 0,
                far: {
                    x: 0,
                    y: 0,
                },
                masked: {
                    x: 0,
                    y: 0,
                },
            },
        );
        world.destroy();
    });

    it('moves character movers along surfaces', async () => {
        const world = await PhysicsWorld2d.create();
        createWall(world);
        const capsule = {
            center1: {
                x: 0,
                y: -0.25,
            },
            center2: {
                x: 0,
                y: 0.25,
            },
            radius: 0.5,
        };
        const origin = {
            x: 0,
            y: 0,
        };
        const touchingPosition = {
            x: 3.5,
            y: 0,
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
                    },
                }),
                filteredOut: world.castMover({
                    capsule,
                    position: origin,
                    translation: {
                        x: 10,
                        y: 0,
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
                        },
                        velocity: {
                            x: 5,
                            y: 5,
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
                    },
                    velocity: {
                        x: 5,
                        y: 5,
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
                        },
                        offset: 0,
                        point: {
                            x: 4,
                            y: -0.25,
                        },
                    },
                ],
                nothingNearby: [],
                filteredPlanes: [],
                solved: {
                    delta: {
                        x: 0.005,
                        y: 1,
                    },
                    velocity: {
                        x: 0,
                        y: 5,
                    },
                },
                soft: {
                    delta: {
                        x: 1,
                        y: 1,
                    },
                    velocity: {
                        x: 5,
                        y: 5,
                    },
                },
            },
        );
        world.destroy();
    });

    it('only collides one-way shapes from the side they point to', async () => {
        /** A 20 wide, 2 tall platform centered on the origin, in a world with downward gravity. */
        async function createPlatformWorld(rotation: Readonly<BodyState['rotation']>) {
            const world = await PhysicsWorld2d.create();
            world.setGravity({
                x: 0,
                y: -10,
            });
            world.createBody({
                definition: {
                    type: BodyType.Static,
                    shapes: [
                        {
                            type: ShapeType.Box,
                            width: 20,
                            height: 2,
                            oneWayDirection: {
                                x: 0,
                                y: 1,
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
        const world = await createPlatformWorld(bodyStateShape.default.rotation);
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
            /** Peaks with its center half a unit above the platform's center. */
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
                    },
                    velocity: {
                        x: 0,
                        y: velocityY,
                    },
                },
            });
        });
        world.step(1 / 60);
        const fastRisingAfterOneStep = assertWrap.isDefined(fastRising).getPosition().y;
        stepWorld(world, 179);

        const flippedWorld = await createPlatformWorld({
            cosine: -1,
            sine: 0,
        });
        const fallingThroughFlipped = flippedWorld.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                position: {
                    x: 0,
                    y: 3,
                },
            },
        });
        createArray(120, () => flippedWorld.step(1 / 60));

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

    it('creates capsule, segment, and rounded shapes', async () => {
        const world = await PhysicsWorld2d.create();
        const masses = (
            [
                {
                    type: ShapeType.Capsule,
                    center1: {
                        x: -1,
                        y: 0,
                    },
                    center2: {
                        x: 1,
                        y: 0,
                    },
                    radius: 0.5,
                    offset: {
                        x: 0,
                        y: 1,
                    },
                },
                {
                    type: ShapeType.Capsule,
                    center1: {
                        x: 0,
                        y: -1,
                    },
                    center2: {
                        x: 0,
                        y: 1,
                    },
                    radius: 0.5,
                },
                {
                    type: ShapeType.Box,
                    width: 2,
                    height: 2,
                    cornerRadius: 0.5,
                },
                {
                    type: ShapeType.Polygon,
                    cornerRadius: 0.5,
                    points: [
                        {
                            x: 0,
                            y: 0,
                        },
                        {
                            x: 1,
                            y: 0,
                        },
                        {
                            x: 0,
                            y: 1,
                        },
                    ],
                },
            ] as const satisfies ReadonlyArray<PhysicsShapeDefinition>
        ).map((shape, index) => {
            return round(
                world
                    .createBody({
                        definition: {
                            type: BodyType.Dynamic,
                            shapes: [shape],
                        },
                        filter: touchingFilter,
                        entityId: index + 1,
                        bodyState: {
                            position: {
                                x: index * 10,
                                y: 0,
                            },
                        },
                    })
                    .getMass(),
                {
                    digits: 2,
                },
            );
        });
        world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Segment,
                        point1: {
                            x: -1,
                            y: 0,
                        },
                        point2: {
                            x: 1,
                            y: 0,
                        },
                        offset: {
                            x: 0,
                            y: 20,
                        },
                    },
                    {
                        type: ShapeType.Segment,
                        point1: {
                            x: -1,
                            y: 0,
                        },
                        point2: {
                            x: 1,
                            y: 0,
                        },
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 9,
            bodyState: {},
        });

        assert.deepEquals(
            {
                masses,
                segmentHit: selectFrom(
                    assertWrap.isDefined(
                        world.castRay({
                            origin: {
                                x: 0,
                                y: 15,
                            },
                            translation: {
                                x: 0,
                                y: 10,
                            },
                        }),
                    ),
                    {
                        entityId: true,
                        point: true,
                    },
                ),
            },
            {
                masses: [
                    /** A 2 by 1 rectangle plus two half circles of radius 0.5. */
                    round(2 + Math.PI / 4, {
                        digits: 2,
                    }),
                    round(2 + Math.PI / 4, {
                        digits: 2,
                    }),
                    /**
                     * Box2D approximates the mass of rounded boxes and polygons by pushing their
                     * corners outward.
                     */
                    3.99,
                    2.29,
                ],
                segmentHit: {
                    entityId: 9,
                    point: {
                        x: 0,
                        y: 20,
                    },
                },
            },
        );
        world.destroy();
    });

    it('collides shapes by collision group over their filters', async () => {
        const world = await PhysicsWorld2d.create();
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
        const world = await PhysicsWorld2d.create();
        world.setGravity({
            x: 0,
            y: -10,
        });
        const floorShape = {
            type: ShapeType.Box,
            width: 10,
            height: 1,
        } as const satisfies PhysicsShapeDefinition;
        const bodies = (
            [
                {
                    rollingResistance: 0,
                },
                {
                    rollingResistance: 0.5,
                },
                {
                    tangentSpeed: 2,
                },
            ] as const
        ).map((floorMaterial, index) => {
            world.createBody({
                definition: {
                    type: BodyType.Static,
                    shapes: [
                        {
                            ...floorShape,
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
                    },
                },
            });
            return world.createBody({
                definition: {
                    type: BodyType.Dynamic,
                    shapes: [
                        index === 2
                            ? {
                                  type: ShapeType.Box,
                                  width: 1,
                                  height: 1,
                              }
                            : ballDefinition.shapes[0],
                    ],
                },
                filter: touchingFilter,
                entityId: index * 2 + 2,
                bodyState: {
                    position: {
                        x: index * 20,
                        y: 1.5,
                    },
                    velocity: {
                        x: index === 2 ? 0 : 4,
                        y: 0,
                    },
                },
            });
        });
        stepWorld(world, 60);

        assert.deepEquals(
            {
                rolledSpeeds: bodies.slice(0, 2).map((body) => body.getVelocity().x > 2),
                conveyorSpeed: round(bodies[2]?.getVelocity().x ?? 0, {
                    digits: 1,
                }),
            },
            {
                rolledSpeeds: [
                    true,
                    false,
                ],
                conveyorSpeed: 2,
            },
        );
        world.destroy();
    });

    it('gives chain segments their own materials', async () => {
        const world = await PhysicsWorld2d.create();
        world.setGravity({
            x: 0,
            y: -10,
        });
        const chainShape = {
            type: ShapeType.Chain,
            /** Right to left, since chains only collide on their right side. */
            points: [
                {
                    x: 10,
                    y: 0,
                },
                {
                    x: 0,
                    y: 0,
                },
                {
                    x: -10,
                    y: 0,
                },
            ],
            material: {
                restitution: 1,
            },
            segmentMaterials: [
                {
                    restitution: 0,
                },
                {},
            ],
        } as const satisfies PhysicsShapeDefinition;
        const floors = [
            {},
            {
                restitution: 0,
            },
        ].map((material, index) => {
            return world.createBody({
                definition: {
                    type: BodyType.Static,
                    shapes: [chainShape],
                },
                filter: touchingFilter,
                entityId: index + 1,
                bodyState: {
                    position: {
                        x: 0,
                        y: index * 50,
                    },
                    material,
                },
            });
        });
        const balls = floors.flatMap((floor, floorIndex) => {
            return [
                -5,
                5,
            ].map((x, index) => {
                return world.createBody({
                    definition: ballDefinition,
                    filter: touchingFilter,
                    entityId: 10 + floorIndex * 2 + index,
                    bodyState: {
                        position: {
                            x,
                            y: floorIndex * 50 + 3,
                        },
                    },
                });
            });
        });
        stepWorld(world, 45);

        assert.deepEquals(
            balls.map((ball) => ball.getVelocity().y > 1),
            [
                true,
                false,
                false,
                false,
            ],
        );
        world.destroy();
    });

    it('replaces shapes and keeps them in body state', async () => {
        const world = await PhysicsWorld2d.create();
        const boxShapes = [
            {
                type: ShapeType.Box,
                width: 2,
                height: 4,
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
                },
            },
        });
        const failedReplacements = [
            [
                {
                    type: ShapeType.Polygon,
                    points: createArray(3, (index) => {
                        return {
                            x: index,
                            y: 0,
                        };
                    }),
                },
            ],
            [
                {
                    type: ShapeType.Box,
                    width: 2,
                    height: 2,
                    cornerRadius: 2,
                },
            ],
        ] as const satisfies ReadonlyArray<ReadonlyArray<PhysicsShapeDefinition>>;
        const failureMessages = failedReplacements.map((shapes) => {
            try {
                ball.setShapes(shapes);
                return undefined;
            } catch (error) {
                return assertWrap.instanceOf(error, Error).message;
            }
        });

        assert.deepEquals(
            {
                definitionShapes,
                stateShapes: state.shapes,
                shapes: ball.getShapes(),
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
                masses: [
                    16,
                    16,
                ],
                failureMessages: [
                    'Polygon points must not all lie on one line.',
                    'A box corner radius must be from 0 to half its smallest side, got 2.',
                ],
                isValidState: true,
            },
        );
        world.destroy();
    });

    it('lets shapeless bodies sleep once they get shapes', async () => {
        const world = await PhysicsWorld2d.create();
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

    it('rejects mismatched chain segment materials and negative corner radii', async () => {
        const world = await PhysicsWorld2d.create();
        const invalidShapes = [
            {
                shape: {
                    type: ShapeType.Chain,
                    isLoop: true,
                    points: createArray(3, (index) => {
                        return {
                            x: index,
                            y: index % 2,
                        };
                    }),
                    segmentMaterials: [{}],
                },
                message: 'A chain with 3 segments needs 3 segment materials, got 1.',
            },
            {
                shape: {
                    type: ShapeType.Polygon,
                    cornerRadius: -1,
                    points: createArray(3, (index) => {
                        return {
                            x: index,
                            y: index % 2,
                        };
                    }),
                },
                message:
                    'A polygon corner radius must be from 0 to half its smallest side, got -1.',
            },
        ] as const satisfies ReadonlyArray<{
            shape: PhysicsShapeDefinition;
            message: string;
        }>;

        invalidShapes.forEach(({shape, message}) => {
            assert.throws(
                () => {
                    world.createBody({
                        definition: {
                            type: BodyType.Static,
                            shapes: [shape],
                        },
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
    it('changes damping, sleep, and hit event settings and keeps them in body state', async () => {
        const world = await PhysicsWorld2d.create();
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
        const world = await PhysicsWorld2d.create();
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
                },
            },
            {
                velocity: {
                    x: 1,
                    y: 0,
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
                    },
                    gravityScale: 0,
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
        const world = await PhysicsWorld2d.create();
        const ball = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                velocity: {
                    x: 10,
                    y: 0,
                },
            },
        });
        createWall(world);
        const hitsWhileDisabled = stepWorld(world, 60).flatMap((events) => events.hits);
        ball.setHitEventsEnabled(true);
        ball.setPosition({
            x: 0,
            y: 0,
        });
        ball.setVelocity({
            x: 10,
            y: 0,
        });
        const hitsWhileEnabled = stepWorld(world, 60).flatMap((events) => events.hits);
        ball.setShapes(ballDefinition.shapes);
        ball.setPosition({
            x: 0,
            y: 0,
        });
        ball.setVelocity({
            x: 10,
            y: 0,
        });
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
        const world = await PhysicsWorld2d.create();
        const massData = {
            mass: 10,
            center: {
                x: 0.5,
                y: 0,
            },
            rotationalInertia: 2,
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
                            entityId: 3,
                            bodyState: {
                                massData: {
                                    ...massData,
                                    rotationalInertia: Number.NaN,
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
                massFromShapes: 3.142,
                overridden: massData,
                afterShapes: 10,
                afterDensity: 10,
                whileStatic: 0,
                afterType: 10,
                state: massData,
                restored: 12,
                restoredState: undefined,
                loaded: massData,
                invalid: [
                    'Mass and rotational inertia must be 0 or more, got -1 and 2.',
                    'Mass and rotational inertia must be 0 or more, got 10 and NaN.',
                ],
            },
        );
        world.destroy();
    });

    it('finds points, rays, and bounds on one body', async () => {
        const world = await PhysicsWorld2d.create();
        const wall = createWall(world);
        const blocker = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 4,
            bodyState: {
                position: {
                    x: 2,
                    y: 0,
                },
                gravityScale: 0,
            },
        });
        const segment = world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Segment,
                        point1: {
                            x: -1,
                            y: 0,
                        },
                        point2: {
                            x: 1,
                            y: 0,
                        },
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 5,
            bodyState: {
                position: {
                    x: 0,
                    y: 10,
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
                },
            },
        });
        const hit = assertWrap.isDefined(
            wall.castRay({
                origin: {
                    x: 0,
                    y: 0,
                },
                translation: {
                    x: 10,
                    y: 0,
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
                miss: wall.castRay({
                    origin: {
                        x: 0,
                        y: 5,
                    },
                    translation: {
                        x: 10,
                        y: 0,
                    },
                }),
                shapelessHit: shapeless.castRay({
                    origin: {
                        x: 0,
                        y: -10,
                    },
                    translation: {
                        x: 1,
                        y: 0,
                    },
                }),
                closestOutside: wall.getClosestPoint({
                    x: 0,
                    y: 0,
                }),
                closestInside: wall.getClosestPoint({
                    x: 5,
                    y: 0.5,
                }),
                closestOnSegment: segment.getClosestPoint({
                    x: 3,
                    y: 12,
                }),
                closestShapeless: shapeless.getClosestPoint({
                    x: 0,
                    y: 0,
                }),
                containsPoint: [
                    wall.containsPoint({
                        x: 5,
                        y: 0,
                    }),
                    wall.containsPoint({
                        x: 0,
                        y: 0,
                    }),
                    segment.containsPoint({
                        x: 0,
                        y: 10,
                    }),
                    blocker.containsPoint({
                        x: 2.5,
                        y: 0,
                    }),
                ],
            },
            {
                bounds: {
                    lowerBound: {
                        x: 3.98,
                        y: -1.02,
                    },
                    upperBound: {
                        x: 6.02,
                        y: 1.02,
                    },
                },
                shapelessBounds: {
                    lowerBound: {
                        x: 0,
                        y: -10,
                    },
                    upperBound: {
                        x: 0,
                        y: -10,
                    },
                },
                hit: {
                    entityId: 3,
                    point: {
                        x: 4,
                        y: 0,
                    },
                    normal: {
                        x: -1,
                        y: 0,
                    },
                    fraction: 0.4,
                },
                miss: undefined,
                shapelessHit: undefined,
                closestOutside: {
                    x: 4,
                    y: 0,
                },
                closestInside: {
                    x: 5,
                    y: 0.5,
                },
                closestOnSegment: {
                    x: 1,
                    y: 10,
                },
                closestShapeless: undefined,
                containsPoint: [
                    true,
                    false,
                    false,
                    true,
                ],
            },
        );
        world.destroy();
    });

    it('reads velocities at points that move with the body', async () => {
        const world = await PhysicsWorld2d.create();
        const body = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                position: {
                    x: 2,
                    y: 0,
                },
                rotation: Math.PI / 2,
                velocity: {
                    x: 1,
                    y: 0,
                },
                angularVelocity: 1,
            },
        });

        assert.deepEquals(
            {
                local: roundCoords(
                    body.getLocalPointVelocity({
                        x: 1,
                        y: 0,
                    }),
                ),
                world: roundCoords(
                    body.getPointVelocity({
                        x: 2,
                        y: 1,
                    }),
                ),
            },
            {
                local: {
                    x: 0,
                    y: 0,
                },
                world: {
                    x: 0,
                    y: 0,
                },
            },
        );
        world.destroy();
    });

    it('blows bodies with wind and clears forces', async () => {
        const world = await PhysicsWorld2d.create();
        /** A square's lift cancels out between its two faces that face the wind. */
        const tiltedPlate = [
            {
                type: ShapeType.Box,
                width: 2,
                height: 0.2,
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
                shapes: tiltedPlate,
                drag: 1,
            },
            {
                shapes: tiltedPlate,
                drag: 1,
                lift: 1,
            },
            {
                shapes: [
                    {
                        type: ShapeType.Segment,
                        point1: {
                            x: -1,
                            y: 0,
                        },
                        point2: {
                            x: 1,
                            y: 0,
                        },
                    },
                ] as const,
                drag: 1,
            },
        ].map(({shapes, drag, lift, velocity}, index) => {
            const body = world.createBody({
                definition: {
                    type: BodyType.Dynamic,
                    shapes,
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
                    },
                    rotation: Math.PI / 8,
                    velocity: {
                        x: velocity ?? 0,
                        y: 0,
                    },
                    gravityScale: 0,
                },
            });
            body.applyWind({
                wind: {
                    x: 10,
                    y: 0,
                },
                drag,
                lift,
            });
            return body;
        });
        const cleared = world.createBody({
            definition: ballDefinition,
            filter: {
                category: 1n,
                mask: 0n,
            },
            entityId: 9,
            bodyState: {
                position: {
                    x: 0,
                    y: 20,
                },
                gravityScale: 0,
            },
        });
        cleared.applyForce({
            x: 10,
            y: 10,
        });
        cleared.clearForces();
        world.step(1 / 60);

        assert.deepEquals(
            [
                ...bodies,
                cleared,
            ].map((body) => {
                return roundCoords(body.getVelocity());
            }),
            [
                {
                    x: 0.65,
                    y: 0,
                },
                {
                    x: 10,
                    y: 0,
                },
                {
                    x: 10.65,
                    y: 0,
                },
                {
                    x: 2.43,
                    y: 0,
                },
                {
                    x: 2.43,
                    y: -1.628,
                },
                {
                    x: 0,
                    y: 0,
                },
                {
                    x: 0,
                    y: 0,
                },
            ],
        );
        world.destroy();
    });

    it('wakes bodies touching a body', async () => {
        const world = await PhysicsWorld2d.create();
        world.setGravity({
            x: 0,
            y: 10,
        });
        const ground = createWall(world);
        const ball = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                position: {
                    x: 5,
                    y: -2,
                },
            },
        });
        stepWorld(world, 180);
        const awakeBefore = ball.isAwake();
        ground.wakeTouching();

        assert.deepEquals(
            {
                awakeBefore,
                awakeAfter: ball.isAwake(),
            },
            {
                awakeBefore: false,
                awakeAfter: true,
            },
        );
        world.destroy();
    });

    it('reads which entities are inside sensor shapes', async () => {
        const world = await PhysicsWorld2d.create();
        const sensor = world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Box,
                        width: 4,
                        height: 4,
                        isSensor: true,
                    },
                    {
                        type: ShapeType.Box,
                        width: 4,
                        height: 4,
                        isSensor: true,
                    },
                    {
                        type: ShapeType.Circle,
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
                bodyState: {
                    gravityScale: 0,
                },
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
        const world = await PhysicsWorld2d.create({
            pixelsPerMeter: 10,
        });
        const defaults = world.getSettings();
        world.setSettings({
            maximumLinearSpeed: 20,
            isSleepDisabled: true,
        });
        world.reset();
        const body = world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                velocity: {
                    x: 100,
                    y: 0,
                },
            },
        });
        world.step(1 / 60);
        const cappedVelocity = roundCoords(body.getVelocity());
        body.setVelocity({
            x: 0,
            y: 0,
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
                    {
                        restitutionIterations: 1.5,
                    },
                    {
                        restitutionIterations: 64,
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
                    restitutionThreshold: 10,
                    restitutionIterations: 2,
                    enableRestitutionPropagation: false,
                    contactHertz: 30,
                    contactDampingRatio: 10,
                    contactSpeed: 30,
                    maximumLinearSpeed: 4000,
                    contactRecycleDistance: 0.5,
                    isSleepDisabled: false,
                    isContinuousDisabled: false,
                    isWarmStartingDisabled: false,
                },
                afterReset: {
                    maximumLinearSpeed: 20,
                    isSleepDisabled: true,
                    contactHertz: 30,
                },
                cappedVelocity: {
                    x: 20,
                    y: 0,
                },
                isAwake: true,
                invalid: [
                    'World setting contactHertz must be a finite number of 0 or more, got -1.',
                    'World setting contactSpeed must be a finite number of 0 or more, got NaN.',
                    'World setting maximumLinearSpeed must be more than 0.',
                    'World setting restitutionIterations must be a whole number up to 63, got 1.5.',
                    'World setting restitutionIterations must be a whole number up to 63, got 64.',
                ],
                afterInvalid: 30,
            },
        );
        world.destroy();
    });

    it('asks the custom filter hook about shapes that enable it, through resets', async () => {
        const world = await PhysicsWorld2d.create();
        const askedPairs: number[][] = [];
        const customFilter: NonNullable<WorldHooks2d['customFilter']> = ({entityA, entityB}) => {
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
                    },
                    velocity: {
                        x: 10,
                        y: 0,
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
        const world = await PhysicsWorld2d.create();
        world.setGravity({
            x: 0,
            y: -10,
        });
        const contacts: Parameters<NonNullable<WorldHooks2d['preSolve']>>[0][] = [];
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
                    return round(value, {
                        digits: 1,
                    });
                }),
                normalFromFloor: roundCoords(
                    firstContact.entityA === 3
                        ? firstContact.normal
                        : {
                              x: -firstContact.normal.x,
                              y: -firstContact.normal.y,
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
                },
                normalFromFloor: {
                    x: 0,
                    y: 1,
                },
            },
        );
        world.destroy();
    });

    it('mixes friction and restitution with hooks that see user material ids', async () => {
        const world = await PhysicsWorld2d.create();
        world.setGravity({
            x: 0,
            y: -10,
        });
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
                        type: ShapeType.Chain,
                        points: [
                            {
                                x: 10,
                                y: 0,
                            },
                            {
                                x: 0,
                                y: 0,
                            },
                            {
                                x: -10,
                                y: 0,
                            },
                        ],
                        material: {
                            userMaterialId: 9,
                        },
                        segmentMaterials: [
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
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 2,
            bodyState: {
                position: {
                    x: 0,
                    y: 50,
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
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 12,
            bodyState: {
                position: {
                    x: 0,
                    y: 51,
                },
                velocity: {
                    x: 4,
                    y: 0,
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

    it('rejects user material ids that are not 32-bit whole numbers', async () => {
        const world = await PhysicsWorld2d.create();
        const body = world.createBody({
            definition: ballDefinition,
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
                        type: ShapeType.Circle,
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
                        type: ShapeType.Chain,
                        points: [
                            {
                                x: 0,
                                y: 0,
                            },
                            {
                                x: 1,
                                y: 0,
                            },
                        ],
                        segmentMaterials: [
                            {
                                userMaterialId: 2 ** 31,
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
            'A userMaterialId must be a whole number from 0 to 2147483647, got -1.',
            'A userMaterialId must be a whole number from 0 to 2147483647, got 1.5.',
            'A userMaterialId must be a whole number from 0 to 2147483647, got 2147483648.',
        ]);
        world.destroy();
    });
    it('restores physics states into other worlds, keeping one-way passes and current world settings', async () => {
        /** A ball partway through rising past a one-way platform. */
        async function createPassingWorld() {
            const world = await PhysicsWorld2d.create();
            world.setGravity({
                x: 0,
                y: -10,
            });
            const bodies = [
                world.createBody({
                    definition: {
                        type: BodyType.Static,
                        shapes: [
                            {
                                type: ShapeType.Box,
                                width: 20,
                                height: 2,
                                oneWayDirection: {
                                    x: 0,
                                    y: 1,
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
                        },
                        velocity: {
                            x: 0,
                            y: 8.4,
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

    it('rejects physics states that do not match', async () => {
        const world = await PhysicsWorld2d.create();
        const ball = world.createBody({
            definition: ballDefinition,
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
        const corrupted = state.slice();
        const box2dSize = new DataView(state.buffer).getInt32(7 * 4, true);
        corrupted[state.length - box2dSize] = 0;

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
                matchMessage: 'Box2D could not restore the physics state',
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
        });
        stepWorld(world, 60);
        assert.deepEquals(roundCoords(ball.getPosition()), {
            x: 1,
            y: 0,
        });

        world.destroy();
    });

    it('reads awake bodies, step timings, and counters', async () => {
        const world = await PhysicsWorld2d.create();
        world.setGravity({
            x: 0,
            y: -10,
        });
        world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Box,
                        width: 40,
                        height: 2,
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
            },
            {
                awakeBodyCount: 100,
                bodyCount: 101,
                shapeCount: 101,
                jointCount: 0,
            },
        );
        assert.isAbove(counters.contactCount, 0);
        assert.isLengthExactly(counters.colorCounts, 24);

        world.destroy();
    });

    it('draws only the enabled parts of the world', async () => {
        const world = await PhysicsWorld2d.create();
        createWall(world);
        createJoinedPair(world, {
            type: JointType.Weld,
        });
        createJoinedPair(world, {
            type: JointType.Revolute,
        });
        world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Capsule,
                        center1: {
                            x: -1,
                            y: 0,
                        },
                        center2: {
                            x: 1,
                            y: 0,
                        },
                        radius: 0.5,
                    },
                ],
            },
            filter: touchingFilter,
            entityId: 4,
            bodyState: {
                position: {
                    x: 0,
                    y: 10,
                },
            },
        });
        const shapes = world.drawDebug({
            drawShapes: true,
        });
        world.step(1 / 60);
        const everything = world.drawDebug({
            drawContacts: true,
            drawAnchorA: true,
            drawShapes: true,
            drawChainNormals: true,
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
            {
                wall: shapes.solidPolygons.map((polygon) => polygon.vertices.map(roundCoords)),
                ballCenters: shapes.solidCircles.map((circle) => roundCoords(circle.center)),
                capsules: shapes.solidCapsules.map((capsule) => {
                    return {
                        start: roundCoords(capsule.start),
                        end: roundCoords(capsule.end),
                        radius: capsule.radius,
                    };
                }),
                lineCount: shapes.lines.length,
            },
            {
                wall: [
                    [
                        {
                            x: 4,
                            y: -1,
                        },
                        {
                            x: 6,
                            y: -1,
                        },
                        {
                            x: 6,
                            y: 1,
                        },
                        {
                            x: 4,
                            y: 1,
                        },
                    ],
                ],
                ballCenters: [
                    {
                        x: 4,
                        y: 0,
                    },
                    {
                        x: 4,
                        y: 0,
                    },
                ],
                capsules: [
                    {
                        start: {
                            x: -1,
                            y: 10,
                        },
                        end: {
                            x: 1,
                            y: 10,
                        },
                        radius: 0.5,
                    },
                ],
                lineCount: 0,
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
                        },
                        upper: {
                            x: 101,
                            y: 101,
                        },
                    },
                }),
                (key, drawn) => drawn.length,
            ),
            mapObjectValues(world.drawDebug({}), () => 0),
        );
        assert.isTrue(getObjectTypedValues(everything).every((drawn) => drawn.length > 0));
        assert.isTrue(everything.strings.every((drawn) => drawn.text.length > 0));

        world.destroy();
    });

    it('records steps, changes, and queries for replays', async () => {
        const world = await PhysicsWorld2d.create({
            pixelsPerMeter: 2,
        });
        world.setGravity({
            x: 0,
            y: -10,
        });
        world.startRecording();
        world.createBody({
            definition: {
                type: BodyType.Static,
                shapes: [
                    {
                        type: ShapeType.Box,
                        width: 20,
                        height: 2,
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
                },
                translation: {
                    x: 0,
                    y: -20,
                },
                filter: touchingFilter,
            });
        });
        world.destroyBody(doomed);
        const isRecording = world.isRecording();
        const recording = world.stopRecording();

        const replay = await PhysicsReplay2d.create(recording);
        const replayedHeights = createArray(30, () => {
            replay.stepFrame();
            return assertWrap.isDefined(replay.getBodies()[1]).position.y;
        });
        const queries = replay.getFrameQueries();
        function countDrawnLines(options: Parameters<PhysicsReplay2d['drawDebug']>[0]) {
            return replay.drawDebug(options).lines.length;
        }

        assert.deepEquals(
            {
                isRecording,
                isRecordingAfter: world.isRecording(),
                info: selectFrom(replay.getInfo(), {
                    frameCount: true,
                    subStepCount: true,
                    pixelsPerMeter: true,
                }),
                replayedHeights,
                isAtEnd: !replay.stepFrame(),
                status: selectFrom(replay.getStatus(), {
                    frame: true,
                    isAtEnd: true,
                    divergedFrame: true,
                }),
                doomed: replay.getBodies()[2],
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
                drawnQueryLines: {
                    none: countDrawnLines({}),
                    second: countDrawnLines({
                        drawFrameQueries: true,
                        frameQueryIndex: 1,
                    }),
                    missing: countDrawnLines({
                        drawFrameQueries: true,
                        frameQueryIndex: 5,
                    }),
                },
            },
            {
                isRecording: true,
                isRecordingAfter: false,
                info: {
                    frameCount: 30,
                    subStepCount: 4,
                    pixelsPerMeter: 2,
                },
                replayedHeights: heights,
                isAtEnd: true,
                status: {
                    frame: 30,
                    isAtEnd: true,
                    divergedFrame: undefined,
                },
                doomed: undefined,
                queries: [
                    0,
                    8,
                ].map((x) => {
                    return {
                        type: ReplayQueryType2d.CastRayClosest,
                        filter: touchingFilter,
                        origin: {
                            x,
                            y: 10,
                        },
                        translation: {
                            x: 0,
                            y: -20,
                        },
                        hits: [
                            {
                                bodyIndex: x ? undefined : 1,
                                point: roundCoords({
                                    x,
                                    y: assertWrap.isDefined(heights.at(-1)) + 1,
                                }),
                                normal: {
                                    x: 0,
                                    y: 1,
                                },
                            },
                        ],
                    };
                }),
                drawnQueryLines: {
                    none: 0,
                    second:
                        countDrawnLines({
                            drawFrameQueries: true,
                        }) / 2,
                    missing: 0,
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
                replaysExactly: await PhysicsReplay2d.replaysExactly(recording),
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
        const world = await PhysicsWorld2d.create();
        world.startRecording();
        world.createBody({
            definition: ballDefinition,
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                position: {
                    x: 0,
                    y: 5.25,
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
        const replay = await PhysicsReplay2d.create(edited);

        await awaitedForEach(
            [
                new Uint8Array(4),
                recording.slice(0, 40),
            ],
            async (invalidRecording) => {
                await assert.throws(PhysicsReplay2d.create(invalidRecording), {
                    matchMessage: 'it is not from PhysicsWorld2d.stopRecording',
                });
                assert.isFalse(await PhysicsReplay2d.replaysExactly(invalidRecording));
            },
        );
        createArray(10, () => replay.stepFrame());
        assert.deepEquals(
            {
                divergedFrame: replay.getStatus().divergedFrame,
                replaysExactly: await PhysicsReplay2d.replaysExactly(edited),
            },
            {
                divergedFrame: 1,
                replaysExactly: false,
            },
        );

        replay.destroy();
        world.destroy();
    });

    it('refuses hooks, pre-solve shapes, and physics states while recording', async () => {
        const world = await PhysicsWorld2d.create();
        world.setGravity({
            x: 0,
            y: -10,
        });
        const platformDefinition = {
            type: BodyType.Static,
            shapes: [
                {
                    type: ShapeType.Box,
                    width: 20,
                    height: 2,
                    oneWayDirection: {
                        x: 0,
                        y: 1,
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
                },
                velocity: {
                    x: 0,
                    y: 12,
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
                    return world.startRecording();
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
                    return createPlatform();
                },
                message: 'cannot have shapes with oneWayDirection',
            },
            {
                refuse() {
                    ball.setShapes([
                        {
                            type: ShapeType.Circle,
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

const geometryShapes = {
    circle: {
        type: ShapeType.Circle,
        radius: 1,
        offset: {
            x: 1,
            y: 0,
        },
    },
    capsule: {
        type: ShapeType.Capsule,
        center1: {
            x: -1,
            y: 0,
        },
        center2: {
            x: 1,
            y: 0,
        },
        radius: 0.5,
    },
    segment: {
        type: ShapeType.Segment,
        point1: {
            x: -1,
            y: 0,
        },
        point2: {
            x: 1,
            y: 0,
        },
    },
    box: {
        type: ShapeType.Box,
        width: 2,
        height: 4,
        material: {
            density: 2,
        },
    },
    polygon: {
        type: ShapeType.Polygon,
        points: [
            {
                x: 0,
                y: 0,
            },
            {
                x: 2,
                y: 0,
            },
            {
                x: 0,
                y: 2,
            },
        ],
        cornerRadius: 0.1,
    },
    chainSegment: {
        type: GeometryShapeType2d.ChainSegment,
        ghost1: {
            x: -2,
            y: 0,
        },
        point1: {
            x: -1,
            y: 0,
        },
        point2: {
            x: 1,
            y: 0,
        },
        ghost2: {
            x: 2,
            y: 0,
        },
    },
} as const satisfies Record<string, GeometryShape2d>;

const flatPolygon = {
    type: ShapeType.Polygon,
    points: [
        {
            x: 0,
            y: 0,
        },
        {
            x: 1,
            y: 0,
        },
        {
            x: 2,
            y: 0,
        },
    ],
} as const satisfies GeometryShape2d;

const identity = {
    position: {
        x: 0,
        y: 0,
    },
    rotation: 0,
};

const allTreeBits = 2n ** 64n - 1n;

function roundNumber(value: number) {
    return (
        round(value, {
            digits: 3,
        }) + 0
    );
}

function roundGeometry(value: unknown): unknown {
    /** Recursion keeps this return type from being inferred. */
    if (check.isNumber(value)) {
        return roundNumber(value);
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

describe(PhysicsGeometry2d.name, () => {
    it('computes mass, bounds, and points inside single shapes', async () => {
        const geometry = await PhysicsGeometry2d.create();
        const transform = {
            position: {
                x: 10,
                y: 0,
            },
            rotation: Math.PI / 2,
        };

        assert.deepEquals(
            roundGeometry(
                mapObjectValues(geometryShapes, (name, shape) => {
                    return {
                        mass: geometry.computeMass(shape),
                        bounds: geometry.computeBounds({
                            shape,
                            transform,
                        }),
                        originBounds: geometry.computeBounds({
                            shape,
                        }),
                        containsCenter: geometry.containsPoint({
                            shape,
                            transform,
                            point: {
                                x: 10,
                                y: 0.5,
                            },
                        }),
                        containsFarPoint: geometry.containsPoint({
                            shape,
                            point: {
                                x: 10,
                                y: 10,
                            },
                        }),
                    };
                }),
            ),
            {
                circle: {
                    mass: {
                        mass: 3.142,
                        center: {
                            x: 1,
                            y: 0,
                        },
                        rotationalInertia: 1.571,
                    },
                    bounds: {
                        lowerBound: {
                            x: 9,
                            y: 0,
                        },
                        upperBound: {
                            x: 11,
                            y: 2,
                        },
                    },
                    originBounds: {
                        lowerBound: {
                            x: 0,
                            y: -1,
                        },
                        upperBound: {
                            x: 2,
                            y: 1,
                        },
                    },
                    containsCenter: true,
                    containsFarPoint: false,
                },
                capsule: {
                    mass: {
                        mass: 2.785,
                        center: {
                            x: 0,
                            y: 0,
                        },
                        rotationalInertia: 2.05,
                    },
                    bounds: {
                        lowerBound: {
                            x: 9.5,
                            y: -1.5,
                        },
                        upperBound: {
                            x: 10.5,
                            y: 1.5,
                        },
                    },
                    originBounds: {
                        lowerBound: {
                            x: -1.5,
                            y: -0.5,
                        },
                        upperBound: {
                            x: 1.5,
                            y: 0.5,
                        },
                    },
                    containsCenter: true,
                    containsFarPoint: false,
                },
                segment: {
                    mass: {
                        mass: 0,
                        center: {
                            x: 0,
                            y: 0,
                        },
                        rotationalInertia: 0,
                    },
                    bounds: {
                        lowerBound: {
                            x: 10,
                            y: -1,
                        },
                        upperBound: {
                            x: 10,
                            y: 1,
                        },
                    },
                    originBounds: {
                        lowerBound: {
                            x: -1,
                            y: 0,
                        },
                        upperBound: {
                            x: 1,
                            y: 0,
                        },
                    },
                    containsCenter: false,
                    containsFarPoint: false,
                },
                box: {
                    mass: {
                        mass: 16,
                        center: {
                            x: 0,
                            y: 0,
                        },
                        rotationalInertia: 26.667,
                    },
                    bounds: {
                        lowerBound: {
                            x: 8,
                            y: -1,
                        },
                        upperBound: {
                            x: 12,
                            y: 1,
                        },
                    },
                    originBounds: {
                        lowerBound: {
                            x: -1,
                            y: -2,
                        },
                        upperBound: {
                            x: 1,
                            y: 2,
                        },
                    },
                    containsCenter: true,
                    containsFarPoint: false,
                },
                polygon: {
                    mass: {
                        mass: 2.486,
                        center: {
                            x: 0.659,
                            y: 0.659,
                        },
                        rotationalInertia: 1.346,
                    },
                    bounds: {
                        lowerBound: {
                            x: 7.9,
                            y: -0.1,
                        },
                        upperBound: {
                            x: 10.1,
                            y: 2.1,
                        },
                    },
                    originBounds: {
                        lowerBound: {
                            x: -0.1,
                            y: -0.1,
                        },
                        upperBound: {
                            x: 2.1,
                            y: 2.1,
                        },
                    },
                    containsCenter: true,
                    containsFarPoint: false,
                },
                chainSegment: {
                    mass: {
                        mass: 0,
                        center: {
                            x: 0,
                            y: 0,
                        },
                        rotationalInertia: 0,
                    },
                    bounds: {
                        lowerBound: {
                            x: 10,
                            y: -1,
                        },
                        upperBound: {
                            x: 10,
                            y: 1,
                        },
                    },
                    originBounds: {
                        lowerBound: {
                            x: -1,
                            y: 0,
                        },
                        upperBound: {
                            x: 1,
                            y: 0,
                        },
                    },
                    containsCenter: false,
                    containsFarPoint: false,
                },
            },
        );
        assert.throws(() => geometry.computeMass(flatPolygon), {
            matchMessage: 'Polygon points must not all lie on one line.',
        });
        assert.throws(
            () => {
                return geometry.computeMass({
                    type: ShapeType.Polygon,
                    points: [],
                });
            },
            {
                matchMessage: 'polygon',
            },
        );
    });

    it('casts rays and shapes at single shapes', async () => {
        const geometry = await PhysicsGeometry2d.create();

        assert.deepEquals(
            roundGeometry({
                rays: mapObjectValues(geometryShapes, (name, shape) => {
                    return geometry.castRay({
                        shape,
                        transform: {
                            position: {
                                x: 0,
                                y: 5,
                            },
                            rotation: 0,
                        },
                        origin: {
                            x: 0.25,
                            y: 0,
                        },
                        translation: {
                            x: 0,
                            y: 10,
                        },
                    });
                }),
                fromBelowChain: geometry.castRay({
                    shape: geometryShapes.chainSegment,
                    origin: {
                        x: 0,
                        y: 5,
                    },
                    translation: {
                        x: 0,
                        y: -10,
                    },
                }),
                shortRay: geometry.castRay({
                    shape: geometryShapes.circle,
                    origin: {
                        x: 1,
                        y: -5,
                    },
                    translation: {
                        x: 0,
                        y: 10,
                    },
                    maxFraction: 0.1,
                }),
                shape: geometry.castShape({
                    shapeA: geometryShapes.box,
                    shapeB: geometryShapes.circle,
                    transformB: {
                        position: {
                            x: -6,
                            y: 0,
                        },
                        rotation: 0,
                    },
                    translation: {
                        x: 10,
                        y: 0,
                    },
                }),
                touchingShape: geometry.castShape({
                    shapeA: geometryShapes.box,
                    transformA: {
                        position: {
                            x: 0,
                            y: 0,
                        },
                        rotation: Math.PI / 2,
                    },
                    shapeB: geometryShapes.circle,
                    transformB: {
                        position: {
                            x: 1,
                            y: 0,
                        },
                        rotation: 0,
                    },
                    translation: {
                        x: 0,
                        y: -1,
                    },
                    canEncroach: true,
                }),
                missedShape: geometry.castShape({
                    shapeA: geometryShapes.box,
                    shapeB: geometryShapes.circle,
                    transformB: {
                        position: {
                            x: -6,
                            y: 0,
                        },
                        rotation: 0,
                    },
                    translation: {
                        x: 10,
                        y: 0,
                    },
                    maxFraction: 0.1,
                }),
            }),
            {
                rays: {
                    circle: {
                        point: {
                            x: 0.25,
                            y: 4.339,
                        },
                        normal: {
                            x: -0.75,
                            y: -0.661,
                        },
                        fraction: 0.434,
                    },
                    capsule: {
                        point: {
                            x: 0.25,
                            y: 4.5,
                        },
                        normal: {
                            x: 0,
                            y: -1,
                        },
                        fraction: 0.45,
                    },
                    segment: {
                        point: {
                            x: 0.25,
                            y: 5,
                        },
                        normal: {
                            x: 0,
                            y: -1,
                        },
                        fraction: 0.5,
                    },
                    box: {
                        point: {
                            x: 0.25,
                            y: 3,
                        },
                        normal: {
                            x: 0,
                            y: -1,
                        },
                        fraction: 0.3,
                    },
                    polygon: {
                        point: {
                            x: 0.25,
                            y: 4.9,
                        },
                        normal: {
                            x: 0,
                            y: -1,
                        },
                        fraction: 0.491,
                    },
                    chainSegment: {
                        point: {
                            x: 0.25,
                            y: 5,
                        },
                        normal: {
                            x: 0,
                            y: -1,
                        },
                        fraction: 0.5,
                    },
                },
                fromBelowChain: undefined,
                shortRay: undefined,
                shape: {
                    point: {
                        x: -1,
                        y: 0,
                    },
                    normal: {
                        x: -1,
                        y: 0,
                    },
                    fraction: 0.301,
                },
                touchingShape: {
                    point: {
                        x: 2,
                        y: 0,
                    },
                    normal: {
                        x: 0,
                        y: 0,
                    },
                    fraction: 0,
                },
                missedShape: undefined,
            },
        );
    });

    it('measures distances and times of impact between shapes', async () => {
        const geometry = await PhysicsGeometry2d.create();
        const apart = {
            shapeA: geometryShapes.box,
            shapeB: geometryShapes.circle,
            transformB: {
                position: {
                    x: 3,
                    y: 0,
                },
                rotation: 0,
            },
        } as const;

        assert.deepEquals(
            roundGeometry({
                distance: geometry.computeDistance(apart),
                coreDistance: geometry.computeDistance({
                    ...apart,
                    ignoreRadii: true,
                }),
                segments: geometry.computeSegmentDistance({
                    segment1: geometryShapes.segment,
                    segment2: {
                        point1: {
                            x: 0,
                            y: 2,
                        },
                        point2: {
                            x: 3,
                            y: 3,
                        },
                    },
                }),
                hit: geometry.computeTimeOfImpact({
                    shapeA: geometryShapes.box,
                    sweepA: {
                        start: {
                            position: {
                                x: 0,
                                y: 0,
                            },
                            rotation: 0,
                        },
                        end: {
                            position: {
                                x: 0,
                                y: 0,
                            },
                            rotation: Math.PI / 2,
                        },
                    },
                    shapeB: geometryShapes.capsule,
                    sweepB: {
                        localCenter: {
                            x: 1,
                            y: 0,
                        },
                        start: {
                            position: {
                                x: 10,
                                y: 0,
                            },
                            rotation: 0,
                        },
                        end: {
                            position: {
                                x: -10,
                                y: 0,
                            },
                            rotation: 0,
                        },
                    },
                }),
                separated: geometry.computeTimeOfImpact({
                    shapeA: geometryShapes.box,
                    sweepA: {
                        start: identity,
                        end: identity,
                    },
                    shapeB: geometryShapes.capsule,
                    sweepB: {
                        start: {
                            position: {
                                x: 10,
                                y: 0,
                            },
                            rotation: 0,
                        },
                        end: {
                            position: {
                                x: -10,
                                y: 0,
                            },
                            rotation: 0,
                        },
                    },
                    maxFraction: 0.1,
                }),
                overlapped: geometry.computeTimeOfImpact({
                    shapeA: geometryShapes.box,
                    sweepA: {
                        start: identity,
                        end: identity,
                    },
                    shapeB: geometryShapes.capsule,
                    sweepB: {
                        start: identity,
                        end: identity,
                    },
                }).state,
            }),
            {
                distance: {
                    pointA: {
                        x: 1,
                        y: 0,
                    },
                    pointB: {
                        x: 3,
                        y: 0,
                    },
                    normal: {
                        x: 1,
                        y: 0,
                    },
                    distance: 2,
                    iterations: 3,
                },
                coreDistance: {
                    pointA: {
                        x: 1,
                        y: 0,
                    },
                    pointB: {
                        x: 4,
                        y: 0,
                    },
                    normal: {
                        x: 1,
                        y: 0,
                    },
                    distance: 3,
                    iterations: 3,
                },
                segments: {
                    closest1: {
                        x: 0,
                        y: 0,
                    },
                    closest2: {
                        x: 0,
                        y: 2,
                    },
                    fraction1: 0.5,
                    fraction2: 0,
                    distance: 2,
                },
                hit: {
                    state: TimeOfImpactState2d.Hit,
                    point: {
                        x: 1.29,
                        y: -0.247,
                    },
                    normal: {
                        x: 0.868,
                        y: 0.497,
                    },
                    fraction: 0.364,
                },
                separated: {
                    state: TimeOfImpactState2d.Separated,
                    point: {
                        x: 0,
                        y: 0,
                    },
                    normal: {
                        x: 0,
                        y: 0,
                    },
                    fraction: 0.1,
                },
                overlapped: TimeOfImpactState2d.Overlapped,
            },
        );
    });

    it('collides every pair of shapes in either order', async () => {
        const geometry = await PhysicsGeometry2d.create();
        const transformB = {
            position: {
                x: 0.5,
                y: 0.8,
            },
            rotation: 0.1,
        };
        const pairs = mapObjectValues(geometryShapes, (nameA, shapeA) => {
            return mapObjectValues(geometryShapes, (nameB, shapeB) => {
                const manifold = geometry.collide({
                    shapeA,
                    shapeB,
                    transformB,
                });
                const swapped = geometry.collide({
                    shapeA: shapeB,
                    transformA: transformB,
                    shapeB: shapeA,
                });
                return {
                    pointCount: manifold.points.length,
                    matchesSwapped:
                        JSON.stringify(
                            roundGeometry([
                                manifold.points.length ? manifold.normal : undefined,
                                manifold.points
                                    .map((point) => omitObjectKeys(point, ['id']))
                                    .toSorted((first, second) => first.point.x - second.point.x),
                            ]),
                        ) ===
                        JSON.stringify(
                            roundGeometry([
                                swapped.points.length
                                    ? {
                                          x: -swapped.normal.x,
                                          y: -swapped.normal.y,
                                      }
                                    : undefined,
                                swapped.points
                                    .map((point) => omitObjectKeys(point, ['id']))
                                    .toSorted((first, second) => first.point.x - second.point.x),
                            ]),
                        ),
                };
            });
        });

        assert.deepEquals(
            mapObjectValues(pairs, (nameA, results) => {
                return mapObjectValues(results, (nameB, result) => {
                    return result.pointCount;
                });
            }),
            {
                circle: {
                    circle: 1,
                    capsule: 1,
                    segment: 1,
                    box: 1,
                    polygon: 1,
                    chainSegment: 1,
                },
                capsule: {
                    circle: 1,
                    capsule: 2,
                    segment: 0,
                    box: 2,
                    polygon: 0,
                    chainSegment: 0,
                },
                segment: {
                    circle: 0,
                    capsule: 0,
                    segment: 0,
                    box: 2,
                    polygon: 0,
                    chainSegment: 0,
                },
                box: {
                    circle: 1,
                    capsule: 2,
                    segment: 2,
                    box: 2,
                    polygon: 2,
                    chainSegment: 2,
                },
                polygon: {
                    circle: 1,
                    capsule: 2,
                    segment: 2,
                    box: 2,
                    polygon: 2,
                    chainSegment: 2,
                },
                chainSegment: {
                    circle: 0,
                    capsule: 0,
                    segment: 0,
                    box: 0,
                    polygon: 0,
                    chainSegment: 0,
                },
            },
        );
        assert.isTrue(
            getObjectTypedValues(pairs).every((results) => {
                return getObjectTypedValues(results).every((result) => result.matchesSwapped);
            }),
        );
        assert.deepEquals(
            roundGeometry(
                geometry.collide({
                    shapeA: geometryShapes.circle,
                    shapeB: geometryShapes.box,
                    transformB: {
                        position: {
                            x: 2.9,
                            y: 0,
                        },
                        rotation: 0,
                    },
                }),
            ),
            {
                normal: {
                    x: 1,
                    y: 0,
                },
                points: [
                    {
                        point: {
                            x: 1.95,
                            y: 0,
                        },
                        separation: -0.1,
                        id: 0,
                    },
                ],
            },
        );
    });

    it('computes convex hulls', async () => {
        const geometry = await PhysicsGeometry2d.create();

        assert.deepEquals(
            {
                square: geometry.computeHull([
                    {
                        x: 0,
                        y: 0,
                    },
                    {
                        x: 1,
                        y: 1,
                    },
                    {
                        x: 0.5,
                        y: 0.5,
                    },
                    {
                        x: 1,
                        y: 0,
                    },
                    {
                        x: 0,
                        y: 1,
                    },
                ]),
                line: geometry.computeHull(flatPolygon.points),
                tooMany: geometry.computeHull(
                    createArray(9, (index) => {
                        return {
                            x: Math.cos(index),
                            y: Math.sin(index),
                        };
                    }),
                ),
            },
            {
                square: [
                    {
                        x: 0,
                        y: 0,
                    },
                    {
                        x: 1,
                        y: 0,
                    },
                    {
                        x: 1,
                        y: 1,
                    },
                    {
                        x: 0,
                        y: 1,
                    },
                ],
                line: undefined,
                tooMany: undefined,
            },
        );
    });

    it('queries proxies in dynamic trees', async () => {
        const geometry = await PhysicsGeometry2d.create();
        const tree = geometry.createTree();
        const proxyIds = createArray(5, (index) => {
            return tree.createProxy({
                bounds: {
                    lowerBound: {
                        x: index * 10,
                        y: 0,
                    },
                    upperBound: {
                        x: index * 10 + 1,
                        y: 1,
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
        tree.moveProxy({
            proxyId: second,
            bounds: {
                lowerBound: {
                    x: 0,
                    y: 5,
                },
                upperBound: {
                    x: 1,
                    y: 6,
                },
            },
        });
        tree.setProxyCategory({
            proxyId: third,
            category: 4n,
        });
        tree.destroyProxy(fourth);

        assert.deepEquals(
            roundGeometry({
                found: tree
                    .queryBounds({
                        bounds: {
                            lowerBound: {
                                x: -1,
                                y: -1,
                            },
                            upperBound: {
                                x: 100,
                                y: 2,
                            },
                        },
                    })
                    .toSorted(),
                masked: tree.queryBounds({
                    bounds: {
                        lowerBound: {
                            x: -1,
                            y: -1,
                        },
                        upperBound: {
                            x: 100,
                            y: 2,
                        },
                    },
                    mask: 2n,
                }),
                ray: tree
                    .castRay({
                        origin: {
                            x: 0.5,
                            y: -1,
                        },
                        translation: {
                            x: 0,
                            y: 10,
                        },
                    })
                    .toSorted(),
                shortRay: tree.castRay({
                    origin: {
                        x: 0.5,
                        y: -1,
                    },
                    translation: {
                        x: 0,
                        y: 10,
                    },
                    maxFraction: 0.3,
                    mask: allTreeBits,
                }),
                box: tree
                    .castBox({
                        bounds: {
                            lowerBound: {
                                x: -2,
                                y: 0,
                            },
                            upperBound: {
                                x: -1,
                                y: 1,
                            },
                        },
                        translation: {
                            x: 50,
                            y: 0,
                        },
                    })
                    .toSorted(),
                shortBox: tree.castBox({
                    bounds: {
                        lowerBound: {
                            x: -2,
                            y: 0,
                        },
                        upperBound: {
                            x: -1,
                            y: 1,
                        },
                    },
                    translation: {
                        x: 50,
                        y: 0,
                    },
                    maxFraction: 0.1,
                    mask: 1n,
                }),
                categories: [
                    tree.getProxyCategory(first),
                    tree.getProxyCategory(third),
                    tree.getProxyCategory(fifth),
                ],
                bounds: tree.getProxyBounds(second),
                stats: omitObjectKeys(tree.getStats(), ['byteCount']),
            }),
            {
                found: [
                    0,
                    2,
                    4,
                ],
                masked: [
                    4,
                    0,
                ],
                ray: [
                    0,
                    1,
                ],
                shortRay: [
                    0,
                ],
                box: [
                    0,
                    2,
                    4,
                ],
                shortBox: [
                    0,
                ],
                categories: [
                    allTreeBits,
                    4n,
                    2n,
                ],
                bounds: {
                    lowerBound: {
                        x: 0,
                        y: 5,
                    },
                    upperBound: {
                        x: 1,
                        y: 6,
                    },
                },
                stats: {
                    height: 2,
                    areaRatio: 0.617,
                    proxyCount: 4,
                    rootBounds: {
                        lowerBound: {
                            x: 0,
                            y: 0,
                        },
                        upperBound: {
                            x: 41,
                            y: 6,
                        },
                    },
                },
            },
        );
        assert.isAbove(tree.getStats().byteCount, 0);
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
