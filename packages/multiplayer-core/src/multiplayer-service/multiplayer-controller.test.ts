import {waitUntil} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {
    ControllerConnectionEvent,
    MultiplayerController,
    type ServiceAndRoomConnectionState,
} from './multiplayer-controller.js';

describe(MultiplayerController.name, () => {
    it('handles failure to connect to a room with port scanning', async () => {
        let externalState: undefined | ServiceAndRoomConnectionState;

        const controller = new MultiplayerController({
            gameId: 'some id',
        });

        controller.listen(ControllerConnectionEvent, (event) => {
            externalState = event.detail;
        });
        controller.startMultiplayer({
            backendOrigin: 'http://localhost:0',
            portScanOptions: {
                timeout: {
                    seconds: 5,
                },
            },
        });

        await waitUntil.instanceOf(Error, () => externalState?.service);
    });
    it('handles failure to connect to a room', async () => {
        let externalState: undefined | ServiceAndRoomConnectionState;

        const controller = new MultiplayerController({
            gameId: 'some id',
        });
        controller.listen(ControllerConnectionEvent, (event) => {
            externalState = event.detail;
        });
        controller.startMultiplayer({
            backendOrigin: 'http://localhost:0',
        });

        await waitUntil.instanceOf(Error, () => externalState?.service, {
            timeout: {
                seconds: 20,
            },
        });
    });
});
