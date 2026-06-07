import {assert, assertWrap} from '@augment-vir/assert';
import {wait} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {
    ControllerFrameEvent,
    type FrameEventDetail,
    P2pLockStepMultiplayerController,
} from './p2p-lock-step-multiplayer-controller.js';

describe(P2pLockStepMultiplayerController.name, () => {
    it('runs singleplayer p2p-lock-step frames', async () => {
        const state: {
            frames: ReadonlyArray<ReadonlyArray<FrameEventDetail<string>>>;
        } = {
            frames: [],
        };
        const controller = new P2pLockStepMultiplayerController<string>({
            frameDuration: {
                milliseconds: 1,
            },
            gameId: 'singleplayer-test',
        });

        controller.listen(ControllerFrameEvent, ({detail}) => {
            if (detail.length) {
                state.frames = [
                    ...state.frames,
                    detail,
                ];
            }
        });

        controller.startSingleplayer();
        const clientId = assertWrap.isDefined(controller.getClientId());
        assert.isLengthExactly(controller.getAllClientIds(), 1);
        controller.act('one');
        await wait({
            milliseconds: 5,
        });
        controller.act([
            'two',
            'three',
        ]);
        await wait({
            milliseconds: 5,
        });

        assert.deepEquals(state.frames, [
            [
                {
                    clientId,
                    packet: 'one',
                },
            ],
            [
                {
                    clientId,
                    packet: 'two',
                },
                {
                    clientId,
                    packet: 'three',
                },
            ],
        ]);
        controller.destroy();
    });
});
