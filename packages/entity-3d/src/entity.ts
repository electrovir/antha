import {
    BaseEntity,
    type BaseEntityAssetDefinitions,
    type EntityConstructor,
    type EntityConstructorParams,
} from '@antha/entity-core';
import {Container3D, type Destroy3DOptions, type View3D} from '@antha/graphics-3d';
import {
    type AnyObject,
    type MaybePromise,
    type PartialWithUndefined,
    type Writable,
} from '@augment-vir/common';
import {type EntityStore3d} from './entity-store-3d.js';
import {type PhysicsWorld3d} from './physics.js';

/**
 * A constructor that creates a 3D entity, as well as the static entity data that should be attached
 * to it.
 *
 * @category Internal
 */
export type Entity3dConstructor = EntityConstructor<BaseEntity3d>;

/**
 * Parameters for a 3D entity's constructor.
 *
 * @category Internal
 */
export type Entity3dConstructorParams<
    State extends AnyObject = any,
    Params extends Record<string, any> | undefined = undefined,
> = EntityConstructorParams<State, Params, PhysicsWorld3d> & {
    entityStore: EntityStore3d<State>;
};

/**
 * Output of {@link BaseEntity3d.createView}.
 *
 * @category Internal
 */
export type ViewCreation3d = PartialWithUndefined<{
    /**
     * A 3D view for rendering. Create with, for example, `new Model3D` or `new Mesh3D` imported
     * from `@antha/graphics-3d`. Build it centered on `(0, 0, 0)`: it is moved and rotated with the
     * entity's physics body.
     */
    view: Container3D;
}>;

/**
 * Base 3D entity class, with a Box3D body and a PixiJS 3D view.
 *
 * @category Internal
 */
export abstract class BaseEntity3d<
    State extends AnyObject = any,
    Params extends Record<string, any> | undefined = any,
    EntityAssets extends BaseEntityAssetDefinitions | undefined = any,
> extends BaseEntity<State, Params, EntityAssets, PhysicsWorld3d> {
    /** The entity store to add all entities to. */
    public declare readonly entityStore: EntityStore3d<State>;
    /**
     * The entity's 3D view. If `createView` returns no view, this is an empty container that is
     * never added to the scene.
     */
    public view!: Container3D;
    /** The 3D scene from `@antha/graphics-3d`. */
    public readonly view3d: View3D;
    /**
     * Passed to the view's `destroy` when the entity is destroyed. Geometry and materials are kept
     * by default because entities often share them. Set `geometry` and `material` when this
     * entity's view owns its own, or they are never freed.
     */
    protected readonly viewDestroyOptions: Readonly<Destroy3DOptions> = {
        children: true,
    };

    constructor(args: Readonly<Entity3dConstructorParams<NoInfer<State>, NoInfer<Params>>>) {
        super(args);
        this.view3d = args.entityStore.view3d;
    }

    /**
     * Creates the entity's 3D view. Called once when the entity is added, and added to the root of
     * the 3D scene.
     */
    public createView(): MaybePromise<ViewCreation3d> {
        return {};
    }

    /**
     * Called when one of this entity's shapes starts touching a shape of `otherEntity`. Both
     * entities get this call.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public override contactStart(otherEntity: BaseEntity3d): MaybePromise<void> {}

    /** Called when this entity stops touching `otherEntity`. Both entities get this call. */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public override contactEnd(otherEntity: BaseEntity3d): MaybePromise<void> {}

    /** Creates the view and adds it to the scene. Called by the entity store. */
    public override async initInstance() {
        const {view} = await this.createView();

        if (view) {
            this.view = view;
            /** Pixi can draw a frame before the entity store first places this view. */
            this.view.position.copyFrom(this.physics.currentTransform.position);
            this.view.quaternion.copyFrom(this.physics.currentTransform.rotation);
            this.view3d.root.addChild(this.view);
        } else {
            this.view = new Container3D({
                visible: false,
            });
        }
    }

    /** Destroys the view with {@link BaseEntity3d.viewDestroyOptions}. */
    protected override destroyView() {
        (this.view as typeof this.view | undefined)?.destroy(this.viewDestroyOptions);
        delete (this as Writable<Partial<BaseEntity3d>>).view;
    }
}
