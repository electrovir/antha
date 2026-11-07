import {
    BaseEntity,
    type BaseEntityAssetDefinitions,
    type EntityConstructor,
    type EntityConstructorParams,
} from '@antha/entity-core';
import {type PixiApplication} from '@antha/graphics-2d';
import {
    type AnyObject,
    type MaybePromise,
    type PartialWithUndefined,
    type Writable,
} from '@augment-vir/common';
import {ParticleContainer, type Container} from 'pixi.js';
import {type EntityStore2d} from './entity-store-2d.js';
import {type PhysicsWorld2d} from './physics.js';

/**
 * A constructor that creates a 2D entity, as well as the static entity data that should be attached
 * to it.
 *
 * @category Internal
 */
export type Entity2dConstructor = EntityConstructor<BaseEntity2d>;

/**
 * Parameters for a 2D entity's constructor.
 *
 * @category Internal
 */
export type Entity2dConstructorParams<
    State extends AnyObject = any,
    Params extends Record<string, any> | undefined = undefined,
> = EntityConstructorParams<State, Params, PhysicsWorld2d> & {
    entityStore: EntityStore2d<State>;
};

/**
 * Output of {@link BaseEntity2d.createView}.
 *
 * @category Internal
 */
export type ViewCreation2d = PartialWithUndefined<{
    /**
     * A view for rendering. Create with, for example, [`new
     * AnimatedSprite`](https://pixijs.download/release/docs/scene.AnimatedSprite.html) or [`new
     * Graphics`](https://pixijs.download/release/docs/scene.Graphics.html), etc. imported from the
     * [`pixi.js`](https://www.npmjs.com/package/pixi.js) package. Draw it centered on `(0, 0)`: it
     * is moved and rotated with the entity's physics body.
     */
    view: Container;
}>;

/**
 * Base 2D entity class, with a Box2D body and a PixiJS view.
 *
 * @category Internal
 */
export abstract class BaseEntity2d<
    State extends AnyObject = any,
    Params extends Record<string, any> | undefined = any,
    EntityAssets extends BaseEntityAssetDefinitions | undefined = any,
> extends BaseEntity<State, Params, EntityAssets, PhysicsWorld2d> {
    /** The entity store to add all entities to. */
    public declare readonly entityStore: EntityStore2d<State>;
    /**
     * The entity's PixiJS view. If `createView` returns no view, this is an empty container that is
     * never added to the stage.
     */
    public view!: Container;
    /** Original pixi app. */
    public readonly pixi: PixiApplication;

    constructor(args: Readonly<Entity2dConstructorParams<NoInfer<State>, NoInfer<Params>>>) {
        super(args);
        this.pixi = args.entityStore.pixi;
    }

    /**
     * Creates the entity's PixiJS view. Called once when the entity is added and added to the
     * PixiJS application stage.
     */
    public createView(): MaybePromise<ViewCreation2d> {
        return {};
    }

    /**
     * Called when one of this entity's shapes starts touching a shape of `otherEntity`. Both
     * entities get this call.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public override contactStart(otherEntity: BaseEntity2d): MaybePromise<void> {}

    /** Called when this entity stops touching `otherEntity`. Both entities get this call. */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public override contactEnd(otherEntity: BaseEntity2d): MaybePromise<void> {}

    /** Creates the view and adds it to the stage. Called by the entity store. */
    public override async initInstance() {
        const {view} = await this.createView();

        if (view) {
            this.view = view;
            /** Pixi can draw a frame before the entity store first places this view. */
            this.view.position.set(
                this.physics.currentTransform.position.x,
                this.physics.currentTransform.position.y,
            );
            this.view.rotation = this.physics.currentTransform.rotation;
            this.pixi.stage.addChild(this.view);
        } else {
            this.view = new ParticleContainer();
            this.view.visible = false;
        }
    }

    /** Destroys the view and its children. */
    protected override destroyView() {
        (this.view as typeof this.view | undefined)?.destroy({
            children: true,
        });
        delete (this as Writable<Partial<BaseEntity2d>>).view;
    }

    /** Detects if the current entity is still within the bounds of the render canvas. */
    public isInBounds(
        options: PartialWithUndefined<{
            /**
             * If `true`, the entire entity's bounds must be within the canvas's bounds. If `false`,
             * any portion of the entity being within the canvas bounds is counted.
             *
             * @default false
             */
            entirely?: boolean;
        }> = {},
    ): boolean {
        if (this.isDestroyed) {
            throw new Error('Cannot check bounds on destroyed entity.');
        } else if (options.entirely) {
            return this.pixi.screen.containsRect(this.view.getBounds().rectangle);
        } else {
            return this.pixi.screen.intersects(this.view.getBounds().rectangle);
        }
    }
}
