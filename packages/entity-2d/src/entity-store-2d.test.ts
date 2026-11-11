import {BodyType} from '@antha/entity-core';
import {assert, assertWrap} from '@augment-vir/assert';
import {awaitedForEach, createArray, type Coords} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {defineShape} from 'object-shape-tester';
import {Graphics} from 'pixi.js';
import {createAnthaEntity2dSuite} from './antha-entity-2d.mod.js';
import {EntityStore2d, type SerializedEntity2d} from './entity-store-2d.js';
import {createTestStore, emptyEntityUpdateParams} from './entity-store-2d.mock.js';
import {type BaseEntity2d, type ViewCreation2d} from './entity.js';
import {
    bodyStateShape,
    JointType,
    ShapeType,
    type EntityPhysicsDefinition,
    type JointDefinition2d,
} from './physics.js';

const ballPhysics = {
    type: BodyType.Dynamic,
    shapes: [
        {
            type: ShapeType.Circle,
            radius: 1,
        },
    ],
} as const satisfies EntityPhysicsDefinition;

async function createBallSuite() {
    const suite = createAnthaEntity2dSuite();
    const contactLog: string[] = [];

    class Ball extends suite.defineEntity({
        key: 'Ball',
        paramsShape: defineShape({
            name: '',
        }),
        physics: ballPhysics,
        touchesSelf: true,
    }) {
        public override createView(): ViewCreation2d {
            return {
                view: new Graphics().circle(0, 0, 1).fill('blue'),
            };
        }

        public override contactStart(otherEntity: BaseEntity2d) {
            contactLog.push(`${this.params.name} started touching ${otherEntity.params.name}`);
        }

        public override contactEnd(otherEntity: BaseEntity2d) {
            contactLog.push(`${this.params.name} stopped touching ${otherEntity.params.name}`);
        }
    }

    return {
        suite,
        store: await createTestStore(suite),
        contactLog,
        Ball,
    };
}

async function stepTimes(store: EntityStore2d, stepCount: number) {
    await awaitedForEach(
        createArray(stepCount, () => undefined),
        async () => {
            await store.updateAllEntities(emptyEntityUpdateParams);
        },
    );
}

function roundCoords(coords: Readonly<Coords>): Coords {
    return {
        x: Math.round(coords.x * 100) / 100,
        y: Math.round(coords.y * 100) / 100,
    };
}

describe(EntityStore2d.name, () => {
    it('throws from every method once destroyed', async () => {
        const {store, Ball} = await createBallSuite();
        const ball = await store.addEntity(Ball, {
            params: {
                name: 'a',
            },
        });
        store.destroy();

        const errors = await Promise.all(
            [
                () => store.updateAllEntities(emptyEntityUpdateParams),
                () => store.renderAllEntities(emptyEntityUpdateParams),
                () => store.createSnapshot(),
                () => store.removeEntity(ball),
                () => {
                    return store.deserializeEntity({
                        entityKey: 'Ball',
                        body: bodyStateShape.default,
                    });
                },
                () => {
                    return store.addEntity(Ball, {
                        params: {
                            name: 'b',
                        },
                    });
                },
                () => store.destroyAllEntities(),
            ].map(async (callback) => {
                try {
                    await Promise.resolve(callback());
                    return undefined;
                } catch (error) {
                    return (error as Error).message;
                }
            }),
        );

        assert.deepEquals(
            errors,
            createArray(7, () => 'Cannot operate on a destroyed entity store.'),
        );
        assert.throws(() => store.destroy(), {
            matchMessage: 'Entity store is already destroyed.',
        });
    });

    it('steps by stepDuration regardless of msSinceLastExecute', async () => {
        const suite = createAnthaEntity2dSuite({
            physics: {
                stepDuration: {
                    milliseconds: 100,
                },
            },
        });
        const store = await createTestStore(suite);

        class Mover extends suite.defineEntity({
            key: 'Mover',
            physics: ballPhysics,
        }) {}

        const mover = await store.addEntity(Mover, {
            velocity: {
                x: 10,
                y: 0,
            },
        });
        await store.updateAllEntities({
            ...emptyEntityUpdateParams,
            msSinceLastExecute: 5000,
        });

        assert.deepEquals(
            {
                stepMs: store.stepMs,
                position: roundCoords(mover.physics.getPosition()),
            },
            {
                stepMs: 100,
                position: {
                    x: 1,
                    y: 0,
                },
            },
        );
        store.destroy();
    });

    it('calls update before each step', async () => {
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);
        const velocitiesSeenInUpdate: Coords[] = [];

        class Pushed extends suite.defineEntity({
            key: 'Pushed',
            physics: ballPhysics,
        }) {
            public override update() {
                velocitiesSeenInUpdate.push(this.physics.getVelocity());
                this.physics.setVelocity({
                    x: 1,
                    y: 0,
                });
            }
        }

        await store.addEntity(Pushed);
        await stepTimes(store, 2);

        assert.deepEquals(velocitiesSeenInUpdate, [
            {
                x: 0,
                y: 0,
            },
            {
                x: 1,
                y: 0,
            },
        ]);
        store.destroy();
    });

    it('removes entities destroyed before or during their update', async () => {
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);
        const updatedKeys: string[] = [];

        class SelfDestructor extends suite.defineEntity({
            key: 'SelfDestructor',
        }) {
            public override update() {
                updatedKeys.push('SelfDestructor');
                this.destroy();
            }
        }

        class Survivor extends suite.defineEntity({
            key: 'Survivor',
        }) {
            public override update() {
                updatedKeys.push('Survivor');
            }
        }

        const destroyedEarly = await store.addEntity(Survivor);
        const selfDestructor = await store.addEntity(SelfDestructor);
        const survivor = await store.addEntity(Survivor);
        destroyedEarly.destroy();

        await stepTimes(store, 2);

        assert.deepEquals(
            {
                updatedKeys,
                remaining: [...store.currentEntityInstances],
                selfDestructorDestroyed: selfDestructor.isDestroyed,
            },
            {
                updatedKeys: [
                    'SelfDestructor',
                    'Survivor',
                    'Survivor',
                ],
                remaining: [
                    survivor,
                ],
                selfDestructorDestroyed: true,
            },
        );
        store.destroy();
    });

    it('calls contact hooks on both entities', async () => {
        const {store, contactLog, Ball} = await createBallSuite();

        await store.addEntity(Ball, {
            params: {
                name: 'left',
            },
            velocity: {
                x: 10,
                y: 0,
            },
        });
        const right = await store.addEntity(Ball, {
            params: {
                name: 'right',
            },
            position: {
                x: 4,
                y: 0,
            },
        });
        await stepTimes(store, 60);
        right.physics.setPosition({
            x: 100,
            y: 0,
        });
        await stepTimes(store, 1);

        assert.deepEquals(contactLog, [
            'left started touching right',
            'right started touching left',
            'left stopped touching right',
            'right stopped touching left',
        ]);
        store.destroy();
    });

    it('skips contact hooks for destroyed or unknown entities', async () => {
        const {store, contactLog, Ball} = await createBallSuite();

        const destroyedBall = await store.addEntity(Ball, {
            params: {
                name: 'destroyed',
            },
        });
        await store.addEntity(Ball, {
            params: {
                name: 'other',
            },
            position: {
                x: 1,
                y: 0,
            },
        });
        store.physicsWorld.createBody({
            definition: ballPhysics,
            filter: {
                category: Ball.collision.category,
                mask: Ball.collision.category,
            },
            entityId: 999,
            bodyState: {
                position: {
                    x: -1,
                    y: 0,
                },
            },
        });
        destroyedBall.destroy();
        await stepTimes(store, 1);

        assert.deepEquals(contactLog, []);
        store.destroy();
    });

    it('calls the default contact hooks', async () => {
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);

        class Quiet extends suite.defineEntity({
            key: 'Quiet',
            physics: ballPhysics,
            touchesSelf: true,
        }) {}

        const quiet = await store.addEntity(Quiet, {
            velocity: {
                x: 10,
                y: 0,
            },
        });
        const other = await store.addEntity(Quiet, {
            position: {
                x: 4,
                y: 0,
            },
        });
        await stepTimes(store, 60);
        const pushedX = other.physics.getPosition().x;
        other.physics.setPosition({
            x: 100,
            y: 0,
        });
        await stepTimes(store, 1);

        assert.isAbove(pushedX, 4);
        assert.isAbove(quiet.physics.getPosition().x, 0);
        store.destroy();
    });

    it('moves views to body positions blended between the last two steps', async () => {
        const suite = createAnthaEntity2dSuite({
            physics: {
                stepDuration: {
                    milliseconds: 100,
                },
            },
        });
        const store = await createTestStore(suite);

        class Mover extends suite.defineEntity({
            key: 'Mover',
            physics: ballPhysics,
        }) {}

        const mover = await store.addEntity(Mover, {
            velocity: {
                x: 10,
                y: 0,
            },
        });
        await store.renderAllEntities(emptyEntityUpdateParams);
        const beforeAnyStep = mover.view.x;

        await stepTimes(store, 1);
        const lastStepTime = performance.now() - 50;
        store.lastStepTime = lastStepTime;
        await store.renderAllEntities(emptyEntityUpdateParams);
        const halfwayX = mover.view.x;

        store.lastStepTime = performance.now() + 1000;
        await store.renderAllEntities(emptyEntityUpdateParams);
        const beforeStepX = mover.view.x;

        store.lastStepTime = performance.now() - 1000;
        await store.renderAllEntities(emptyEntityUpdateParams);

        assert.deepEquals(
            {
                beforeAnyStep,
                isHalfway: halfwayX > 0.4 && halfwayX < 0.6,
                beforeStepX,
                afterStepX: Math.round(mover.view.x * 100) / 100,
            },
            {
                beforeAnyStep: 0,
                isHalfway: true,
                beforeStepX: 0,
                afterStepX: 1,
            },
        );
        store.destroy();
    });

    it('turns views the short way around', async () => {
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);

        class Spinner extends suite.defineEntity({
            key: 'Spinner',
            physics: ballPhysics,
        }) {}

        const spinner = await store.addEntity(Spinner);
        spinner.physics.previousTransform = {
            position: {
                x: 0,
                y: 0,
            },
            rotation: Math.PI - 0.1,
        };
        spinner.physics.currentTransform = {
            position: {
                x: 0,
                y: 0,
            },
            rotation: -Math.PI + 0.1,
        };
        store.lastStepTime = performance.now() - store.stepMs / 2;
        await store.renderAllEntities(emptyEntityUpdateParams);

        assert.isTrue(Math.abs(spinner.view.rotation - Math.PI) < 0.02);
        store.destroy();
    });

    it('renders every entity that is not destroyed', async () => {
        const suite = createAnthaEntity2dSuite();
        const store = await createTestStore(suite);
        const renderedNames: string[] = [];

        class Named extends suite.defineEntity({
            key: 'Named',
            paramsShape: defineShape({
                name: '',
            }),
        }) {
            public override render() {
                renderedNames.push(this.params.name);
            }
        }

        class Plain extends suite.defineEntity({
            key: 'Plain',
        }) {}

        await store.addEntity(Plain);
        const destroyed = await store.addEntity(Named, {
            params: {
                name: 'destroyed',
            },
        });
        await store.addEntity(Named, {
            params: {
                name: 'kept',
            },
        });
        destroyed.destroy();
        await store.renderAllEntities(emptyEntityUpdateParams);

        assert.deepEquals(renderedNames, [
            'kept',
        ]);
        store.destroy();
    });

    it('gets and removes entities', async () => {
        const {store, Ball} = await createBallSuite();

        const ball = await store.addEntity(Ball, {
            params: {
                name: 'a',
            },
        });
        const foundBefore = [...store.getEntities(Ball)];
        store.removeEntity(ball);

        assert.deepEquals(
            {
                foundBefore,
                foundAfter: [...store.getEntities(Ball)],
                isViewOnStage: store.pixi.stage.children.includes(ball.view),
            },
            {
                foundBefore: [
                    ball,
                ],
                foundAfter: [],
                isViewOnStage: false,
            },
        );
        store.destroy();
    });

    it('snapshots and restores params, body state, and joints in order', async () => {
        const {suite, store, Ball} = await createBallSuite();

        class Marker extends suite.defineEntity({
            key: 'Marker',
        }) {}

        const first = await store.addEntity(Ball, {
            params: {
                name: 'first',
            },
            position: {
                x: 1,
                y: 2,
            },
            velocity: {
                x: 3,
                y: 0,
            },
            angularVelocity: 1,
        });
        const marker = await store.addEntity(Marker, {
            position: {
                x: 5,
                y: 5,
            },
        });
        const destroyed = await store.addEntity(Ball, {
            params: {
                name: 'destroyed',
            },
            position: {
                x: 50,
                y: 50,
            },
        });
        const jointDefinition = {
            type: JointType.Distance,
            frameA: {
                position: {
                    x: 0.5,
                    y: 0,
                },
                angle: 0,
            },
            length: 4,
            enableSpring: true,
            hertz: 2,
        } as const satisfies JointDefinition2d;
        store.addJoint({
            entities: [
                first,
                marker,
            ],
            definition: jointDefinition,
        });
        store.addJoint({
            entities: [
                first,
                destroyed,
            ],
            definition: {
                type: JointType.Weld,
            },
        });
        destroyed.destroy();
        await stepTimes(store, 3);
        const snapshot = store.createSnapshot();

        const otherStore = await createTestStore(suite);
        otherStore.registerEntities({
            entities: [
                Ball,
                Marker,
            ],
        });
        const loaded = await otherStore.loadSnapshot(snapshot);

        assert.deepEquals(
            {
                keys: snapshot.entities.map((entry) => entry.entityKey),
                joints: snapshot.joints,
                loadedClasses: loaded.entities.map((entity) => entity.constructor),
                loadedJoints: loaded.joints.map((joint) => joint.getDefinition()),
                hashesMatch: otherStore.hashEntities() === store.hashEntities(),
            },
            {
                keys: [
                    'Ball',
                    'Marker',
                ],
                joints: [
                    {
                        entityIndexes: [
                            0,
                            1,
                        ],
                        definition: jointDefinition,
                    },
                ],
                loadedClasses: [
                    Ball,
                    Marker,
                ],
                loadedJoints: [
                    jointDefinition,
                ],
                hashesMatch: true,
            },
        );

        await stepTimes(store, 10);
        await stepTimes(otherStore, 10);
        assert.strictEquals(otherStore.hashEntities(), store.hashEntities());

        store.destroy();
        otherStore.destroy();
    });

    it('continues the simulation exactly from snapshots with physics states', async () => {
        const {suite, store, Ball} = await createBallSuite();
        await awaitedForEach(
            [
                0,
                1.9,
                3.8,
                40,
            ],
            async (x, index) => {
                await store.addEntity(Ball, {
                    params: {
                        name: `ball ${index}`,
                    },
                    position: {
                        x,
                        y: index * 0.3,
                    },
                    velocity: {
                        x: index ? 0 : 6,
                        y: 0,
                    },
                });
            },
        );
        const [
            first,
            second,
            ,
            destroyed,
        ] = [...store.currentEntityInstances];
        store.addJoint({
            entities: [
                assertWrap.isDefined(first),
                assertWrap.isDefined(second),
            ],
            definition: {
                type: JointType.Distance,
                length: 3,
                enableSpring: true,
                hertz: 1,
            },
        });
        await stepTimes(store, 20);
        assertWrap.isDefined(destroyed).destroy();
        const snapshot = store.createSnapshot({
            includePhysicsState: true,
        });

        async function stepAndRead(steppedStore: EntityStore2d) {
            await stepTimes(steppedStore, 40);
            return {
                positions: [...steppedStore.currentEntityInstances].map((entity) => {
                    return entity.physics.getPosition();
                }),
                stateHash: steppedStore.physicsWorld.getStateHash(),
            };
        }

        async function createBallStore() {
            const ballStore = await createTestStore(suite);
            ballStore.registerEntities({
                entities: [
                    Ball,
                ],
            });
            return ballStore;
        }

        const expected = await stepAndRead(store);
        const stateStore = await createBallStore();
        await stateStore.loadSnapshot(snapshot);
        const plainStore = await createBallStore();
        await plainStore.loadSnapshot({
            ...snapshot,
            physicsState: undefined,
        });
        const fromState = await stepAndRead(stateStore);
        const fromPlain = await stepAndRead(plainStore);

        assert.deepEquals(
            {
                fromState,
                plainMatches: fromPlain.stateHash === expected.stateHash,
            },
            {
                fromState: expected,
                plainMatches: false,
            },
        );

        store.destroy();
        stateStore.destroy();
        plainStore.destroy();
    });

    it('replaces current entities when loading a snapshot', async () => {
        const {store, Ball} = await createBallSuite();

        const oldBall = await store.addEntity(Ball, {
            params: {
                name: 'old',
            },
        });
        const snapshot = store.createSnapshot();
        await store.loadSnapshot(snapshot);

        assert.deepEquals(
            {
                isOldBallDestroyed: oldBall.isDestroyed,
                names: [...store.currentEntityInstances].map((entity) => entity.params.name),
            },
            {
                isOldBallDestroyed: true,
                names: [
                    'old',
                ],
            },
        );
        store.destroy();
    });

    it('rejects a malformed snapshot without destroying current entities', async () => {
        const {store, Ball} = await createBallSuite();

        const ball = await store.addEntity(Ball, {
            params: {
                name: 'kept',
            },
        });

        await assert.throws(
            () => {
                return store.loadSnapshot({
                    entities: [
                        {
                            entityKey: 'Ball',
                        } as SerializedEntity2d,
                    ],
                    joints: [],
                });
            },
            {
                matchMessage: 'Invalid entity snapshot entry at index 0',
            },
        );
        assert.isFalse(ball.isDestroyed);
        store.destroy();
    });

    it('deserializes registered entities and rejects unknown keys', async () => {
        const {Ball} = await createBallSuite();
        const suite = createAnthaEntity2dSuite({
            preregisteredEntities: [
                Ball,
            ],
        });
        const store = await createTestStore(suite);
        const body = {
            ...bodyStateShape.default,
            position: {
                x: 1,
                y: 1,
            },
        };

        const ball = await store.deserializeEntity({
            entityKey: 'Ball',
            serializedParams: JSON.stringify({
                name: 'loaded',
            }),
            body,
        });
        store.registerEntities({
            entities: [],
            clearPreviousRegistrations: true,
        });

        assert.deepEquals(ball.params, {
            name: 'loaded',
        });
        await assert.throws(
            () => {
                return store.deserializeEntity({
                    entityKey: 'Ball',
                    body,
                });
            },
            {
                matchMessage: "No entity registered for key 'Ball'",
            },
        );
        store.destroy();
    });

    it('checks addEntity options against the params shape', async () => {
        const {suite, store, Ball} = await createBallSuite();

        class NoParams extends suite.defineEntity({
            key: 'NoParams',
        }) {}

        await store.addEntity(NoParams);
        await store.addEntity(NoParams, {
            position: {
                x: 1,
                y: 1,
            },
        });
        await store.addEntity(Ball, {
            params: {
                name: 'a',
            },
        });
        // @ts-expect-error: missing params
        await store.addEntity(Ball, {});
        // @ts-expect-error: missing options
        await store.addEntity(Ball);
        await store.addEntity(NoParams, {
            // @ts-expect-error: this entity does not accept params
            params: {
                name: 'a',
            },
        });
        store.destroy();
    });

    it('destroys all entities but stays usable', async () => {
        const {store, Ball} = await createBallSuite();

        const ball = await store.addEntity(Ball, {
            params: {
                name: 'a',
            },
        });
        store.destroyAllEntities();
        await store.addEntity(Ball, {
            params: {
                name: 'b',
            },
        });

        assert.deepEquals(
            {
                isFirstDestroyed: ball.isDestroyed,
                count: store.currentEntityInstances.size,
            },
            {
                isFirstDestroyed: true,
                count: 1,
            },
        );
        store.destroy();
    });
});
