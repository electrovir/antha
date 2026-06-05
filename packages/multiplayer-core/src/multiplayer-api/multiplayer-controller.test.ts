import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {
    ControllerConnectionEvent,
    MultiplayerRoomController,
    type ApiAndRoomConnectionState,
} from './multiplayer-controller.js';

describe(MultiplayerRoomController.name, () => {
    it('handles failure to connect to a room with port scanning', async () => {
        let externalState: undefined | ApiAndRoomConnectionState;

        const controller = new MultiplayerRoomController({
            gameId: 'some id',
        });

        controller.listen(ControllerConnectionEvent, (event) => {
            externalState = event.detail;
        });
        await assert.throws(
            () =>
                controller.initMultiplayer({
                    backendOrigin: 'http://localhost:0',
                    portScanOptions: {
                        timeout: {
                            seconds: 5,
                        },
                    },
                }),
            {
                matchMessage: 'Cannot find dev origin',
            },
        );

        assert.instanceOf(externalState?.api, Error);
    });
    it('handles failure to connect to a room', async () => {
        let externalState: undefined | ApiAndRoomConnectionState;

        const controller = new MultiplayerRoomController({
            gameId: 'some id',
        });
        controller.listen(ControllerConnectionEvent, (event) => {
            externalState = event.detail;
        });
        await assert.throws(() =>
            controller.initMultiplayer({
                backendOrigin: 'http://localhost:0',
            }),
        );

        assert.instanceOf(externalState?.api, Error);
    });
});
