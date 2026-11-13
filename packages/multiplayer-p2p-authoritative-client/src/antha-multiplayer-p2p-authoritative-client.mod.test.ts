import {AnthaEngine} from '@antha/engine';
import {
    createMultiplayerId,
    createNewRoom,
    MultiplayerConnectionState,
    type MultiplayerRoomConnection,
} from '@antha/multiplayer-core';
import {assert, assertWrap} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {
    type AnthaMultiplayerP2pAuthoritativeClientState,
    createAnthaMultiplayerP2pAuthoritativeClientMod,
} from './antha-multiplayer-p2p-authoritative-client.mod.js';
import {
    MultiplayerControllerClientStateEvent,
    type P2pAuthoritativeClientMessage,
    P2pAuthoritativeClientMessageType,
} from './p2p-authoritative-client-multiplayer-controller.js';

type TestEngineState = AnthaMultiplayerP2pAuthoritativeClientState<number> & {
    localValue: number;
};

describe(createAnthaMultiplayerP2pAuthoritativeClientMod.name, () => {
    it('creates the controller once, mirrors connection state, and forwards events', async () => {
        const engine = new AnthaEngine<Partial<TestEngineState>>({
            mods: [
                createAnthaMultiplayerP2pAuthoritativeClientMod<number, TestEngineState>({
                    gameId: 'authoritative-client-mod-test',
                    createLocalState({state}) {
                        return state.localValue;
                    },
                }),
            ],
        });

        await engine.runSingleTick();
        const multiplayerState = assertWrap.isDefined(
            engine.state.multiplayerP2pAuthoritativeClient,
        );
        await engine.runSingleTick();

        const forwardedStates: number[] = [];
        const sentMessages: P2pAuthoritativeClientMessage<number>[] = [];
        const memberClientId = createMultiplayerId.client();
        const roomConnection: MultiplayerRoomConnection<P2pAuthoritativeClientMessage<number>> = {
            clientId: createMultiplayerId.client(),
            destroy() {},
            dropHost() {},
            getAllClientIds() {
                return [];
            },
            getConnectedClientIds() {
                return [
                    memberClientId,
                ];
            },
            isConnected() {
                return true;
            },
            isHost() {
                return true;
            },
            sendMessage(message) {
                sentMessages.push(message);
            },
            sendToOnlyOneClient() {},
        };

        engine.listen(MultiplayerControllerClientStateEvent<number>, ({detail}) => {
            forwardedStates.push(detail.state);
        });
        multiplayerState.multiplayerController.startSingleplayer();
        assert.deepEquals(multiplayerState.connectionState, {
            api: MultiplayerConnectionState.Connected,
            room: MultiplayerConnectionState.Disconnected,
        });

        multiplayerState.multiplayerController.roomController.joinOrCreateRoom = () => {
            multiplayerState.multiplayerController.roomController.currentConnection =
                roomConnection;
            return Promise.resolve();
        };
        await multiplayerState.multiplayerController.joinOrCreateRoom(createNewRoom());
        engine.state.localValue = 7;
        multiplayerState.multiplayerController['sendClientStates']();
        multiplayerState.multiplayerController['handleReceivedMessage'](memberClientId, {
            type: P2pAuthoritativeClientMessageType.ClientStates,
            clientStates: [
                {
                    clientId: memberClientId,
                    sentAt: 1,
                    sequence: 1,
                    echoes: [],
                    state: 3,
                },
            ],
        });

        assert.strictEquals(engine.state.multiplayerP2pAuthoritativeClient, multiplayerState);
        assert.deepEquals(
            {
                forwardedStates,
                sentStates: sentMessages.map((message) => {
                    return message.type === P2pAuthoritativeClientMessageType.ClientStates
                        ? message.clientStates.map(({state}) => state)
                        : [];
                }),
            },
            {
                forwardedStates: [
                    3,
                ],
                sentStates: [
                    [
                        7,
                    ],
                ],
            },
        );

        await engine.reset();
        multiplayerState.multiplayerController.dispatch(
            new MultiplayerControllerClientStateEvent<number>({
                detail: {
                    clientId: memberClientId,
                    receivedAt: 2,
                    sentAt: 2,
                    smoothedReceivedAt: 2,
                    sequence: 2,
                    echoes: [],
                    roundTrip: undefined,
                    state: 4,
                },
            }),
        );

        assert.deepEquals(forwardedStates, [
            3,
        ]);
    });

    it('sends nothing without createLocalState', async () => {
        const engine = new AnthaEngine<Partial<TestEngineState>>({
            mods: [
                createAnthaMultiplayerP2pAuthoritativeClientMod({
                    debugMultiplayer: true,
                }),
            ],
        });

        await engine.runSingleTick();

        assert.isUndefined(
            assertWrap.isDefined(engine.state.multiplayerP2pAuthoritativeClient)
                .multiplayerController['params'].createLocalState,
        );
        await engine.reset();
    });
});
