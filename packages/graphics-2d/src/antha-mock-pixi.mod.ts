import {defineAnthaMod} from '@antha/engine';
import {type AnthaGraphics2dModState} from './antha-graphics-2d.mod.js';
import {createMockPixi, MockPixiApp} from './mock-pixi.js';

/**
 * A mode made for testing with Pixi. It attaches a {@link MockPixiApp} to the
 * state.pixi.pixiApplication.
 *
 * @category Testing
 */
export const AnthaMockPixiMod = defineAnthaMod<AnthaGraphics2dModState>({
    modName: 'mock-pixi-setup',
    execute({state}) {
        if (!state.pixi) {
            state.pixi = {
                pixiApplication: createMockPixi(),
            };
        }
    },
    cleanup({state}) {
        state.pixi?.pixiApplication?.destroy();
        state.pixi?.canvas?.remove();
    },
});
