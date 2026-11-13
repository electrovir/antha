import {
    defineSerializedEntityShape,
    defineSerializedJointShape,
    EntityStore,
    interpolate,
    type AddEntityOptions,
    type AddEntityParams,
    type EntitySnapshot,
    type EntityStoreConstructorParams,
    type SerializedEntity,
    type SerializedJoint,
} from '@antha/entity-core';
import {type PixiApplication} from '@antha/graphics-2d';
import {type AnyObject, type Writable} from '@augment-vir/common';
import {type BaseEntity2d, type Entity2dConstructor} from './entity.js';
import {
    bodyStateShape,
    jointDefinition2dShape,
    type InitialBodyState,
    type PhysicsOptions,
    type PhysicsWorld2d,
} from './physics.js';

/**
 * Options for {@link EntityStore.addEntity}.
 *
 * @category Internal
 */
export type AddEntity2dOptions<Params> = AddEntityOptions<Params, InitialBodyState>;

/**
 * Parameters for {@link EntityStore.addEntity}. The options are optional when the entity has no
 * params.
 *
 * @category Internal
 */
export type AddEntity2dParams<ThisConstructor extends Entity2dConstructor> = AddEntityParams<
    ThisConstructor,
    PhysicsWorld2d
>;

/**
 * Physics options for an entity suite's stores.
 *
 * @category Internal
 */
export type EntityStore2dPhysicsOptions = PhysicsOptions &
    Pick<EntityStoreConstructorParams<AnyObject, PhysicsWorld2d>, 'stepDuration'>;

/**
 * Parameters for the constructor of {@link EntityStore2d}.
 *
 * @category Internal
 */
export type EntityStore2dConstructorParams<State extends AnyObject = any> =
    EntityStoreConstructorParams<State, PhysicsWorld2d> & {
        /**
         * A PixiJS [`Application`](https://pixijs.download/release/docs/app.Application.html)
         * instance from the [`pixi.js`](https://www.npmjs.com/package/pixi.js) package.
         */
        pixi: PixiApplication;
    };

/**
 * Shape definition for {@link SerializedEntity2d}.
 *
 * @category Internal
 */
export const serializedEntity2dShape = defineSerializedEntityShape(bodyStateShape);

/**
 * One entity in a snapshot from {@link EntityStore.createSnapshot}.
 *
 * @category Internal
 */
export type SerializedEntity2d = SerializedEntity<PhysicsWorld2d>;

/**
 * Shape definition for {@link SerializedJoint2d}.
 *
 * @category Internal
 */
export const serializedJoint2dShape = defineSerializedJointShape(jointDefinition2dShape);

/**
 * One joint in a snapshot from {@link EntityStore.createSnapshot}.
 *
 * @category Internal
 */
export type SerializedJoint2d = SerializedJoint<PhysicsWorld2d>;

/**
 * A snapshot from {@link EntityStore.createSnapshot}.
 *
 * @category Internal
 */
export type EntitySnapshot2d = EntitySnapshot<PhysicsWorld2d>;

/** Turns the short way around, so that crossing from `π` to `-π` is not a full spin. */
function interpolateAngle({
    start,
    end,
    progress,
}: Readonly<{start: number; end: number; progress: number}>) {
    const fullTurn = Math.PI * 2;
    const difference = ((((end - start) % fullTurn) + fullTurn * 1.5) % fullTurn) - Math.PI;
    return start + difference * progress;
}

/**
 * The top level storage class of all 2D entities. Add entities with {@link EntityStore.addEntity}.
 *
 * @category Internal
 */
export class EntityStore2d<State extends AnyObject = any> extends EntityStore<
    State,
    PhysicsWorld2d,
    BaseEntity2d
> {
    /** Original pixi app. */
    public readonly pixi: PixiApplication;

    constructor(args: Readonly<EntityStore2dConstructorParams<State>>) {
        super(args);
        this.pixi = args.pixi;
    }

    /** Moves and turns the view to the body's transform, blended between the last two steps. */
    protected override placeView(entity: BaseEntity2d, progress: number) {
        const {previousTransform, currentTransform} = entity.physics;
        entity.view.position.set(
            interpolate({
                start: previousTransform.position.x,
                end: currentTransform.position.x,
                progress,
            }),
            interpolate({
                start: previousTransform.position.y,
                end: currentTransform.position.y,
                progress,
            }),
        );
        entity.view.rotation = interpolateAngle({
            start: previousTransform.rotation,
            end: currentTransform.rotation,
            progress,
        });
    }

    /** Removes the view from the PixiJS stage. */
    protected override detachView(entity: BaseEntity2d) {
        // eslint-disable-next-line unicorn/prefer-dom-node-remove
        this.pixi.stage.removeChild(entity.view);
    }

    /** Destroys the entity store, all entities contained inside it, and its physics world. */
    public override destroy() {
        super.destroy();
        delete (this as Writable<Partial<EntityStore2d>>).pixi;
    }
}
