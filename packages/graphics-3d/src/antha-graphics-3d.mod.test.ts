import {AnthaEngine} from '@antha/engine';
import {createMockPixi} from '@antha/graphics-2d';
import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {View3D} from '@pixi/3d';
import {Container} from 'pixi.js';
import {createAnthaGraphics3dMod, type AnthaGraphics3dModState} from './antha-graphics-3d.mod.js';

describe(createAnthaGraphics3dMod.name, () => {
    it('waits for the PixiJS application', async () => {
        const engine = new AnthaEngine<AnthaGraphics3dModState>({
            mods: [
                createAnthaGraphics3dMod(),
            ],
        });

        await engine.runSingleTick();

        assert.deepEquals(engine.state.graphics3d, {});
    });

    it('adds one view behind the rest of the stage', async () => {
        const engine = new AnthaEngine<AnthaGraphics3dModState>({
            mods: [
                createAnthaGraphics3dMod({
                    viewOptions: {
                        exposure: 2,
                    },
                }),
            ],
        });
        const pixiApplication = createMockPixi();
        const existingChild = pixiApplication.stage.addChild(new Container());
        engine.state.pixi = {
            pixiApplication,
        };

        await engine.runSingleTick();
        const view = engine.state.graphics3d?.view;
        await engine.runSingleTick();

        assert.instanceOf(view, View3D);
        assert.deepEquals(
            {
                stageChildren: pixiApplication.stage.children,
                isSameView: engine.state.graphics3d?.view === view,
                exposure: view.exposure,
                autoResize: view.autoResize,
            },
            {
                stageChildren: [
                    view,
                    existingChild,
                ],
                isSameView: true,
                exposure: 2,
                autoResize: true,
            },
        );
    });

    it('destroys the view on cleanup', async () => {
        const engine = new AnthaEngine<AnthaGraphics3dModState>({
            mods: [
                createAnthaGraphics3dMod(),
            ],
        });
        engine.state.pixi = {
            pixiApplication: createMockPixi(),
        };
        await engine.runSingleTick();
        const view = engine.state.graphics3d?.view;

        await engine.reset();

        assert.isTrue(view?.destroyed);
    });
});
