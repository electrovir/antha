import {AssetLoader} from '@antha/asset';
import {
    AnthaEngine,
    ModExecutionTriggerType,
    type ModExecuteParams,
    type ModInstanceId,
} from '@antha/engine';
import {
    applyBrand,
    type AnyObject,
    type Constructor,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {type AnyDuration} from 'date-vir';
import {defineShape, type Shape} from 'object-shape-tester';
import {EntityStore} from './entity-store.js';
import {
    createEntitySuite,
    type DefineEntityArgs,
    type EntityModState,
    type EntitySuiteOptions,
} from './entity-suite.js';
import {
    BaseEntity,
    type BaseEntityAssetDefinitions,
    type EntityConstructor,
    type StaticEntityParts,
} from './entity.js';
import {
    type CollisionFilter,
    type ContactEvents,
    type EntityBody,
    type EntityJoint,
    type PhysicsWorld,
} from './physics-world.js';

export type TestBodyState = {
    x: number;
};

export type TestPhysicsDefinition = {
    size: number;
};

export class TestBody implements EntityBody<TestBodyState> {
    public stepCount = 0;
    public x: number;

    constructor(
        public readonly creation: Readonly<{
            definition: Readonly<TestPhysicsDefinition> | undefined;
            filter: Readonly<CollisionFilter>;
            entityId: number;
        }>,
        bodyState: Readonly<Partial<TestBodyState>>,
    ) {
        this.x = bodyState.x ?? 0;
    }

    public recordStep() {
        this.stepCount++;
    }

    public getState(): TestBodyState {
        return {
            x: this.x,
        };
    }
}

export type TestJointDefinition = {
    stiffness: number;
};

export class TestJoint implements EntityJoint<TestJointDefinition> {
    constructor(
        public readonly jointId: number,
        public readonly bodies: Readonly<
            [
                TestBody,
                TestBody,
            ]
        >,
        public definition: TestJointDefinition,
    ) {}

    public getDefinition() {
        return this.definition;
    }
}

/** A physics world with no physics: steps report whatever contacts the test queued. */
export class TestPhysicsWorld
    implements
        PhysicsWorld<
            TestPhysicsDefinition,
            TestBody,
            Partial<TestBodyState>,
            string,
            TestJointDefinition,
            TestJoint
        >
{
    public readonly bodyStateShape = defineShape({
        x: 0,
    });
    public readonly jointDefinitionShape = defineShape({
        stiffness: 0,
    });
    public readonly bodies = new Set<TestBody>();
    public readonly joints = new Set<TestJoint>();
    public readonly stepSeconds: number[] = [];
    public queuedContacts: ContactEvents<string> = {
        started: [],
        ended: [],
        sensorStarted: [],
        sensorEnded: [],
        hits: [],
        strainedJoints: [],
    };
    public resetCount = 0;
    public isDestroyed = false;

    public createBody({
        definition,
        filter,
        entityId,
        bodyState,
    }: Readonly<{
        definition: Readonly<TestPhysicsDefinition> | undefined;
        filter: Readonly<CollisionFilter>;
        entityId: number;
        bodyState: Readonly<Partial<TestBodyState>>;
    }>) {
        const body = new TestBody(
            {
                definition,
                filter,
                entityId,
            },
            bodyState,
        );
        this.bodies.add(body);
        return body;
    }

    public destroyBody(body: TestBody) {
        this.bodies.delete(body);
    }

    public createJoint({
        bodies,
        definition,
        jointId,
    }: Readonly<{
        bodies: Readonly<
            [
                TestBody,
                TestBody,
            ]
        >;
        definition: Readonly<TestJointDefinition>;
        jointId: number;
    }>) {
        const joint = new TestJoint(jointId, bodies, {
            ...definition,
        });
        this.joints.add(joint);
        return joint;
    }

    public destroyJoint(joint: TestJoint) {
        this.joints.delete(joint);
    }

    public step(stepSeconds: number) {
        this.stepSeconds.push(stepSeconds);
        const contacts = this.queuedContacts;
        this.queuedContacts = {
            started: [],
            ended: [],
            sensorStarted: [],
            sensorEnded: [],
            hits: [],
            strainedJoints: [],
        };
        return contacts;
    }

    /** What each {@link TestPhysicsWorld.restorePhysicsState} call received. */
    public readonly restoredStates: {
        state: Uint8Array;
        bodies: ReadonlyArray<TestBody>;
        joints: ReadonlyArray<TestJoint>;
    }[] = [];

    /** Only saves how many of each it got. */
    public createPhysicsState({
        bodies,
        droppedBodies,
        joints,
    }: Readonly<{
        bodies: ReadonlyArray<TestBody>;
        droppedBodies: ReadonlyArray<TestBody>;
        joints: ReadonlyArray<TestJoint>;
    }>) {
        return new Uint8Array([
            bodies.length,
            droppedBodies.length,
            joints.length,
        ]);
    }

    public assertValidPhysicsState({
        state,
        bodyCount,
        jointCount,
    }: Readonly<{
        state: Uint8Array;
        bodyCount: number;
        jointCount: number;
    }>) {
        if (state[0] !== bodyCount || state[2] !== jointCount) {
            throw new Error('Test physics state does not match.');
        }
    }

    public restorePhysicsState(
        params: Readonly<{
            state: Uint8Array;
            bodies: ReadonlyArray<TestBody>;
            joints: ReadonlyArray<TestJoint>;
        }>,
    ) {
        this.restoredStates.push(params);
    }

    public reset() {
        this.resetCount++;
        this.bodies.clear();
        this.joints.clear();
    }

    public destroy() {
        this.isDestroyed = true;
    }
}

export class TestEntity<
    State extends AnyObject = any,
    Params extends Record<string, any> | undefined = any,
    EntityAssets extends BaseEntityAssetDefinitions | undefined = any,
> extends BaseEntity<State, Params, EntityAssets, TestPhysicsWorld> {
    public declare readonly entityStore: TestEntityStore<State>;
    public viewDestroyCount = 0;

    protected override destroyView() {
        this.viewDestroyCount++;
    }
}

export class TestEntityStore<State extends AnyObject = any> extends EntityStore<
    State,
    TestPhysicsWorld,
    TestEntity
> {
    public readonly placedViews: {
        entityId: number;
        progress: number;
    }[] = [];
    public readonly detachedEntityIds: number[] = [];

    protected override placeView(entity: TestEntity, progress: number) {
        this.placedViews.push({
            entityId: entity.entityId,
            progress,
        });
    }

    protected override detachView(entity: TestEntity) {
        this.detachedEntityIds.push(entity.entityId);
    }
}

export function createTestStore(
    options: PartialWithUndefined<{
        stepDuration: AnyDuration;
        preregisteredEntities: ReadonlyArray<EntityConstructor>;
    }> = {},
) {
    return new TestEntityStore({
        ...options,
        state: {},
        assetLoader: new AssetLoader(),
        physicsWorld: new TestPhysicsWorld(),
    });
}

export type TestModState = EntityModState<TestEntityStore> & {
    canCreateStore: boolean;
};

type DefineTestEntity = <
    const ParamsShape extends Shape | undefined,
    const EntityAssets extends BaseEntityAssetDefinitions | undefined,
>(
    params: DefineEntityArgs<
        ParamsShape,
        EntityAssets,
        TestPhysicsWorld,
        EntityConstructor<TestEntity>
    >,
) => Constructor<
    TestEntity<
        TestModState,
        ParamsShape extends Shape ? ParamsShape['runtimeType'] : undefined,
        EntityAssets
    >,
    ConstructorParameters<typeof TestEntity>
> &
    StaticEntityParts<TestModState, ParamsShape, EntityAssets>;

export function createTestSuite(options: Readonly<EntitySuiteOptions> = {}) {
    const suite = createEntitySuite<TestEntityStore, TestModState>({
        modName: 'test-entity-update',
        baseEntityClass: TestEntity,
        options,
        createEntityStore(state) {
            return state.canCreateStore ? Promise.resolve(createTestStore()) : undefined;
        },
    });

    return {
        ...suite,
        defineEntity: suite.defineEntity as DefineTestEntity,
    };
}

const testEngine = new AnthaEngine();

export const emptyEntityUpdateParams = {
    currentTick: 0,
    engine: testEngine,
    executionTrigger: {
        type: ModExecutionTriggerType.Tick,
    },
    trigger: undefined,
    hostElement: document.createElement('div'),
    lastExecution: undefined,
    modInstanceId: applyBrand<ModInstanceId>('entity-test'),
    msSinceLastExecute: 0,
    state: testEngine.state,
    ticksSinceLastExecute: 0,
} satisfies ModExecuteParams;
