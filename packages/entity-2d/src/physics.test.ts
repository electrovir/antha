import {assert} from '@augment-vir/assert';
import {awaitedForEach, createArray} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {BodyType, PhysicsWorld2d, ShapeType, type EntityPhysicsDefinition} from './physics.js';

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
                    fixedRotation: true,
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
});
