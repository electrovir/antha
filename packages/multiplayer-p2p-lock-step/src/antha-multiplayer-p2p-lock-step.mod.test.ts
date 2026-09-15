import {AnthaEngine} from '@antha/engine';
import {
    createNewRoom,
    MultiplayerConnectionState,
    MultiplayerControllerConnectionEvent,
    MultiplayerControllerRoomListEvent,
    type MultiplayerClientRooms,
} from '@antha/multiplayer-core';
import {assert, assertWrap} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {
    createAnthaMultiplayerP2pLockStepMod,
    isMultiplayerRoomConnected,
    type AnthaMultiplayerP2pLockStepState,
} from './antha-multiplayer-p2p-lock-step.mod.js';
import {MultiplayerControllerFrameEvent} from './p2p-lock-step-multiplayer-controller.js';

type TestEngineState = Partial<AnthaMultiplayerP2pLockStepState<string>>;

describe(createAnthaMultiplayerP2pLockStepMod.name, () => {
    it('creates the lock-step mod and mirrors controller room state', async () => {
        const mod = createAnthaMultiplayerP2pLockStepMod<string>({
            gameId: 'lock-step-mod-test',
            debugMultiplayer: false,
            acceptConnection() {
                return true;
            },
        });
        const engine = new AnthaEngine<TestEngineState>({
            mods: [
                mod,
            ],
        });
        const room = createNewRoom({
            roomName: 'Room Name',
        });

        await engine.runSingleTick();
        await engine.runSingleTick();

        const multiplayerState = assertWrap.isDefined(engine.state.multiplayerP2pLockStep);
        let availableRooms: Readonly<MultiplayerClientRooms> = {};
        let receivedFrame: boolean = false;

        assert.strictEquals(mod.modName, 'antha-multiplayer-p2p-lock-step');

        multiplayerState.multiplayerController.listen(
            MultiplayerControllerRoomListEvent,
            ({detail}) => {
                availableRooms = detail;
            },
        );
        engine.listen(MultiplayerControllerFrameEvent, () => {
            receivedFrame = true;
        });

        multiplayerState.multiplayerController.startSingleplayer();
        multiplayerState.multiplayerController.dispatch(
            new MultiplayerControllerRoomListEvent({
                detail: {
                    [room.roomId]: {
                        clientCount: 1,
                        hasRoomPassword: false,
                        roomId: room.roomId,
                        roomName: room.roomName,
                    },
                },
            }),
        );

        assert.isTrue(receivedFrame);
        assert.deepEquals(
            {
                availableRooms,
                connectionState: multiplayerState.connectionState,
                isRoomConnected: isMultiplayerRoomConnected(engine.state),
            },
            {
                availableRooms: {
                    [room.roomId]: {
                        clientCount: 1,
                        hasRoomPassword: false,
                        roomId: room.roomId,
                        roomName: room.roomName,
                    },
                },
                connectionState: {
                    api: MultiplayerConnectionState.Connected,
                    room: MultiplayerConnectionState.Disconnected,
                },
                isRoomConnected: false,
            },
        );

        await engine.reset();
    });

    it('uses default options and ignores events after state is removed', async () => {
        const mod = createAnthaMultiplayerP2pLockStepMod<string>();
        const engine = new AnthaEngine<TestEngineState>({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();

        const multiplayerState = assertWrap.isDefined(engine.state.multiplayerP2pLockStep);
        delete engine.state.multiplayerP2pLockStep;

        multiplayerState.multiplayerController.dispatch(
            new MultiplayerControllerConnectionEvent({
                detail: {
                    api: MultiplayerConnectionState.Connected,
                    room: MultiplayerConnectionState.Disconnected,
                },
            }),
        );
        multiplayerState.multiplayerController.dispatch(
            new MultiplayerControllerRoomListEvent({
                detail: {},
            }),
        );

        assert.isUndefined(engine.state.multiplayerP2pLockStep);

        await engine.reset();
    });
});
