// cspell:word slerp

import {
    defineSerializedEntityShape,
    defineSerializedJointShape,
    EntityStore,
    type AddEntityOptions,
    type AddEntityParams,
    type EntitySnapshot,
    type EntityStoreConstructorParams,
    type SerializedEntity,
    type SerializedJoint,
} from '@antha/entity-core';
import {lerp, type View3D} from '@antha/graphics-3d';
import {type AnyObject, type PartialWithUndefined, type Writable} from '@augment-vir/common';
import {type AnyDuration} from 'date-vir';
import {type BaseEntity3d, type Entity3dConstructor} from './entity.js';
import {
    bodyStateShape,
    jointDefinition3dShape,
    type InitialBodyState,
    type PhysicsWorld3d,
} from './physics.js';

/**
 * Options for {@link EntityStore.addEntity}.
 *
 * @category Internal
 */
export type AddEntity3dOptions<Params> = AddEntityOptions<Params, InitialBodyState>;

/**
 * Parameters for {@link EntityStore.addEntity}. The options are optional when the entity has no
 * params.
 *
 * @category Internal
 */
export type AddEntity3dParams<ThisConstructor extends Entity3dConstructor> = AddEntityParams<
    ThisConstructor,
    PhysicsWorld3d
>;

/**
 * Physics options for an entity suite's stores.
 *
 * @category Internal
 */
export type EntityStore3dPhysicsOptions = PartialWithUndefined<{
    /**
     * How much time each {@link EntityStore.updateAllEntities} call simulates. Shorter steps cost
     * more but let fast bodies collide more accurately.
     *
     * @default {seconds: 1 / 120}
     */
    stepDuration: AnyDuration;
}>;

/**
 * Parameters for the constructor of {@link EntityStore3d}.
 *
 * @category Internal
 */
export type EntityStore3dConstructorParams<State extends AnyObject = any> =
    EntityStoreConstructorParams<State, PhysicsWorld3d> & {
        /** The 3D scene from `@antha/graphics-3d`. Entity views are added to its `root`. */
        view3d: View3D;
    };

/**
 * Shape definition for {@link SerializedEntity3d}.
 *
 * @category Internal
 */
export const serializedEntity3dShape = defineSerializedEntityShape(bodyStateShape);

/**
 * One entity in a snapshot from {@link EntityStore.createSnapshot}.
 *
 * @category Internal
 */
export type SerializedEntity3d = SerializedEntity<PhysicsWorld3d>;

/**
 * Shape definition for {@link SerializedJoint3d}.
 *
 * @category Internal
 */
export const serializedJoint3dShape = defineSerializedJointShape(jointDefinition3dShape);

/**
 * One joint in a snapshot from {@link EntityStore.createSnapshot}.
 *
 * @category Internal
 */
export type SerializedJoint3d = SerializedJoint<PhysicsWorld3d>;

/**
 * A snapshot from {@link EntityStore.createSnapshot}.
 *
 * @category Internal
 */
export type EntitySnapshot3d = EntitySnapshot<PhysicsWorld3d>;

/**
 * The top level storage class of all 3D entities. Add entities with {@link EntityStore.addEntity}.
 *
 * @category Internal
 */
export class EntityStore3d<State extends AnyObject = any> extends EntityStore<
    State,
    PhysicsWorld3d,
    BaseEntity3d
> {
    /** The 3D scene from `@antha/graphics-3d`. */
    public readonly view3d: View3D;

    constructor(args: Readonly<EntityStore3dConstructorParams<State>>) {
        super(args);
        this.view3d = args.view3d;
    }

    /** Moves and turns the view to the body's transform, blended between the last two steps. */
    protected override placeView(entity: BaseEntity3d, progress: number) {
        const {previousTransform, currentTransform} = entity.physics;
        entity.view.position.set(
            lerp(previousTransform.position.x, currentTransform.position.x, progress),
            lerp(previousTransform.position.y, currentTransform.position.y, progress),
            lerp(previousTransform.position.z, currentTransform.position.z, progress),
        );
        entity.view.quaternion
            .copyFrom(previousTransform.rotation)
            .slerp(currentTransform.rotation, progress);
    }

    /** Removes the view from the 3D scene. */
    protected override detachView(entity: BaseEntity3d) {
        entity.view.removeFromParent();
    }

    /** Destroys the entity store, all entities contained inside it, and its physics world. */
    public override destroy() {
        super.destroy();
        delete (this as Writable<Partial<EntityStore3d>>).view3d;
    }
}
