import {BodyType} from '@antha/entity-core';
import {assert} from '@augment-vir/assert';
import {createArray, mapObjectValues, round, type PartialWithUndefined} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {PhysicsWorld3d, ShapeType, type EntityPhysicsDefinition} from './physics.js';

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
                    fixedRotation: true,
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

    it('locks rotation with fixedRotation', async () => {
        const world = await PhysicsWorld3d.create();
        const body = world.createBody({
            definition: {
                ...ballDefinition,
                fixedRotation: true,
            },
            filter: touchingFilter,
            entityId: 1,
            bodyState: {
                angularVelocity: {
                    x: 1,
                    y: 2,
                    z: 3,
                },
            },
        });
        world.step(1 / 60);

        assert.deepEquals(roundCoords(body.getAngularVelocity()), {
            x: 0,
            y: 0,
            z: 0,
        });
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
});
