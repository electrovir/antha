import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {createAnthaGraphics2dMod} from '@antha/graphics-2d';
import {
    type AnthaGraphics3dModState,
    createAnthaGraphics3dMod,
    CubeGeometry,
    DirectionalLight,
    Material3D,
    Mesh3D,
} from '../index.js';

type GameState = AnthaGraphics3dModState & {
    hasAddedCube: boolean;
};

const engine = new AnthaEngine<GameState>({
    initState: {
        hasAddedCube: false,
    },
    mods: [
        createAnthaGraphics2dMod(),
        createAnthaGraphics3dMod(),
        defineAnthaMod<GameState>({
            modName: 'game-logic',
            execute({state}) {
                const view = state.graphics3d?.view;
                if (!view || state.hasAddedCube) {
                    return;
                }

                state.hasAddedCube = true;
                view.root.addChild(
                    new DirectionalLight({
                        intensity: 3,
                    }),
                    new Mesh3D({
                        geometry: new CubeGeometry(),
                        material: new Material3D({
                            baseColor: '#44aaff',
                        }),
                    }),
                );
                view.camera.position.set(0, 1, 4);
            },
        }),
    ],
});

engine.startLoop();
