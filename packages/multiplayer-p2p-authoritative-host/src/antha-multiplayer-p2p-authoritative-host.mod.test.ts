import {AnthaEngine} from '@antha/engine';
import {
    ControllerConnectionEvent,
    ControllerRoomListEvent,
    createNewRoom,
    MultiplayerConnectionState,
} from '@antha/multiplayer-core';
import {assert, assertWrap} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {
    createAnthaMultiplayerP2pAuthoritativeHostMod,
    type AnthaMultiplayerP2pAuthoritativeHostState,
} from './antha-multiplayer-p2p-authoritative-host.mod.js';
import {ControllerStateEvent} from './p2p-authoritative-host-multiplayer-controller.js';

type CounterState = {
    count: number;
};

type TestEngineState = Partial<AnthaMultiplayerP2pAuthoritativeHostState<number, CounterState>>;

describe(createAnthaMultiplayerP2pAuthoritativeHostMod.name, () => {
    it('creates the authoritative host mod and mirrors controller state', async () => {
        const mod = createAnthaMultiplayerP2pAuthoritativeHostMod<number, CounterState>({
            gameId: 'authoritative-host-mod-test',
            createInitialState() {
                return {
                    count: 0,
                };
            },
            applyInput({state, input}) {
                return {
                    count: state.count + input,
                };
            },
            shouldAcceptInput({input}) {
                return input > 0;
            },
            tick({state, elapsedMs}) {
                return {
                    count: state.count + elapsedMs,
                };
            },
            acceptConnection() {
                return true;
            },
        });
        const engine = new AnthaEngine<TestEngineState>({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();
        await engine.runSingleTick();

        const multiplayerState = assertWrap.isDefined(engine.state.multiplayerP2pAuthoritativeHost);
        const room = createNewRoom({
            roomName: 'Room Name',
        });

        assert.strictEquals(mod.modName, 'antha-multiplayer-p2p-authoritative-host');
        const initialCount: number = multiplayerState.currentState.count;
        assert.strictEquals(initialCount, 0);

        multiplayerState.multiplayerController.startSingleplayer();
        multiplayerState.multiplayerController.act(2);
        multiplayerState.multiplayerController.act(-1);
        multiplayerState.multiplayerController.tick(3);

        multiplayerState.multiplayerController.dispatch(
            new ControllerRoomListEvent({
                detail: {
                    [room.roomId]: {
                        clientCount: 1,
                        hasRoomPassword: false,
                        roomId: room.roomId,
                        roomName: 'Room Name',
                    },
                },
            }),
        );

        assert.deepEquals(
            {
                availableRooms: multiplayerState.availableRooms,
                connectionState: multiplayerState.connectionState,
                currentState: multiplayerState.currentState,
            },
            {
                availableRooms: {
                    [room.roomId]: {
                        clientCount: 1,
                        hasRoomPassword: false,
                        roomId: room.roomId,
                        roomName: 'Room Name',
                    },
                },
                connectionState: {
                    api: MultiplayerConnectionState.Connected,
                    room: MultiplayerConnectionState.Disconnected,
                },
                currentState: multiplayerState.currentState,
            },
        );
        const finalCount: number = multiplayerState.currentState.count;
        assert.strictEquals(finalCount, 5);

        await engine.reset();
    });

    it('uses default options and ignores events after state is removed', async () => {
        const mod = createAnthaMultiplayerP2pAuthoritativeHostMod<number, CounterState>({
            createInitialState() {
                return {
                    count: 0,
                };
            },
            applyInput({state, input}) {
                return {
                    count: state.count + input,
                };
            },
        });
        const engine = new AnthaEngine<TestEngineState>({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();

        const multiplayerState = assertWrap.isDefined(engine.state.multiplayerP2pAuthoritativeHost);
        delete engine.state.multiplayerP2pAuthoritativeHost;

        multiplayerState.multiplayerController.dispatch(
            new ControllerConnectionEvent({
                detail: {
                    api: MultiplayerConnectionState.Connected,
                    room: MultiplayerConnectionState.Disconnected,
                },
            }),
        );
        multiplayerState.multiplayerController.dispatch(
            new ControllerRoomListEvent({
                detail: {},
            }),
        );
        multiplayerState.multiplayerController.dispatch(
            new ControllerStateEvent<CounterState, number>({
                detail: {
                    sequence: 1,
                    state: {
                        count: 5,
                    },
                },
            }),
        );

        assert.isUndefined(engine.state.multiplayerP2pAuthoritativeHost);

        await engine.reset();
    });
});
