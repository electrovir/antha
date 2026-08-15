import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {type AnthaGraphics2dModState, createAnthaGraphics2dMod, Graphics} from '../index.js';

type GameState = AnthaGraphics2dModState & {
    hasAddedCircle: boolean;
};

const engine = new AnthaEngine<GameState>({
    initState: {
        hasAddedCircle: false,
    },
    mods: [
        createAnthaGraphics2dMod(),
        defineAnthaMod<GameState>({
            modName: 'game-logic',
            execute({state}) {
                if (!state.pixi?.pixiApplication || state.hasAddedCircle) {
                    return;
                }

                state.hasAddedCircle = true;
                state.pixi.pixiApplication.stage.addChild(
                    new Graphics().circle(0, 0, 20).fill('white'),
                );
            },
        }),
    ],
});

engine.startLoop();
