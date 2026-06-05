import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {
    ControllerFrameEvent,
    P2pLockStepMultiplayerController,
} from './p2p-lock-step-multiplayer-controller.js';

describe(P2pLockStepMultiplayerController.name, () => {
    it('runs singleplayer p2p-lock-step frames', () => {
        const state: {
            frames: ReadonlyArray<ReadonlyArray<string>>;
        } = {
            frames: [],
        };
        const controller = new P2pLockStepMultiplayerController<string>({
            gameId: 'singleplayer-test',
        });

        controller.listen(ControllerFrameEvent, ({detail}) => {
            state.frames = [
                ...state.frames,
                detail,
            ];
        });

        controller.startSingleplayer();
        assert.isLengthExactly(controller.getAllClientIds(), 1);
        controller.act('one');
        controller.runFrame();
        controller.act([
            'two',
            'three',
        ]);
        controller.runFrame();

        assert.deepEquals(state.frames, [
            [],
            [
                'one',
            ],
            [
                'two',
                'three',
            ],
        ]);
    });
});
