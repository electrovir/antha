import {defineAnthaMod} from '@antha/engine';
import {type AnthaGraphics2dModState} from '@antha/graphics-2d';
import {getOrSet, type PartialWithUndefined} from '@augment-vir/common';
import {View3D, type View3DOptions} from '@pixi/3d';

/**
 * Engine State for {@link createAnthaGraphics3dMod}.
 *
 * @category Internal
 */
export type AnthaGraphics3dModState = AnthaGraphics2dModState & {
    graphics3d: Partial<{
        /**
         * The 3D scene. Add 3D content to `view.root` and move `view.camera` to look around.
         * Created once the PixiJS application from `@antha/graphics-2d` exists.
         */
        view: View3D;
    }>;
};

/**
 * Options for {@link createAnthaGraphics3dMod}.
 *
 * @category Internal
 */
export type AnthaGraphics3dModOptions = PartialWithUndefined<{
    /** Options for the scene's `View3D`, merged over {@link defaultView3dOptions}. */
    viewOptions: View3DOptions;
}>;

/**
 * Default `viewOptions` values for {@link createAnthaGraphics3dMod}.
 *
 * @category Internal
 */
export const defaultView3dOptions = {
    autoResize: true,
    environment: {
        skyColor: '#dde8ff',
        groundColor: '#443322',
    },
} satisfies View3DOptions;

/**
 * A mod that adds a 3D scene, drawn with [`@pixi/3d`](https://www.npmjs.com/package/@pixi/3d),
 * behind everything else on the stage of the `@antha/graphics-2d` PixiJS application. Does nothing
 * until `createAnthaGraphics2dMod` in the same engine has created its PixiJS application.
 *
 * @category Pre-Built Mods
 */
export function createAnthaGraphics3dMod(
    modOptions?: Readonly<AnthaGraphics3dModOptions> | undefined,
) {
    return defineAnthaMod<AnthaGraphics3dModState>({
        modName: 'antha-graphics-3d',
        cleanup({state}) {
            state.graphics3d?.view?.destroy({
                children: true,
            });
            delete state.graphics3d?.view;
        },
        execute({state}) {
            const graphics3dState = getOrSet(state, 'graphics3d', () => {
                return {};
            });
            const pixiApplication = state.pixi?.pixiApplication;

            if (!graphics3dState.view && pixiApplication) {
                const view = new View3D({
                    ...defaultView3dOptions,
                    ...modOptions?.viewOptions,
                });
                pixiApplication.stage.addChildAt(view, 0);
                graphics3dState.view = view;
            }
        },
    });
}
