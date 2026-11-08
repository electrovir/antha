import {
    type ClientId,
    createMultiplayerId,
    createNewRoom,
    MessageDelivery,
    MultiplayerConnectionState,
    type MultiplayerConnectionUpdate,
    MultiplayerControllerClientStatusEvent,
    MultiplayerControllerConnectionEvent,
    MultiplayerControllerMessageEvent,
    type MultiplayerRoomConnection,
} from '@antha/multiplayer-core';
import {assert, waitUntil} from '@augment-vir/assert';
import {type PartialWithUndefined} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {
    type ClientStateUpdate,
    MultiplayerControllerClientLeaveEvent,
    MultiplayerControllerClientStateEvent,
    type P2pAuthoritativeClientMessage,
    P2pAuthoritativeClientMessageType,
    P2pAuthoritativeClientMultiplayerController,
    type P2pAuthoritativeClientMultiplayerControllerParams,
} from './p2p-authoritative-client-multiplayer-controller.js';

type TestClientState = {
    x: number;
};
type TestMessage = P2pAuthoritativeClientMessage<TestClientState>;

type SentMessage = {
    message: TestMessage;
    delivery: MessageDelivery | undefined;
} & PartialWithUndefined<{
    toClientId: ClientId;
}>;

type FakeRoomConnection = MultiplayerRoomConnection<TestMessage> & {
    sentMessages: SentMessage[];
};

class TestController extends P2pAuthoritativeClientMultiplayerController<TestClientState> {
    public sendClientStatesForTest() {
        this.sendClientStates();
    }
}

function createFakeRoomConnection({
    isHost,
    connectedClientIds,
}: Readonly<{
    isHost: boolean;
    connectedClientIds: ReadonlyArray<ClientId>;
}>): FakeRoomConnection {
    const sentMessages: SentMessage[] = [];

    return {
        clientId: createMultiplayerId.client(),
        sentMessages,
        destroy() {},
        getAllClientIds() {
            return [
                this.clientId,
                ...connectedClientIds,
            ];
        },
        getConnectedClientIds() {
            return [
                ...connectedClientIds,
            ];
        },
        isConnected() {
            return true;
        },
        isHost() {
            return isHost;
        },
        sendMessage(message, delivery) {
            sentMessages.push({
                message,
                delivery,
            });
        },
        sendToOnlyOneClient(toClientId, message, delivery) {
            sentMessages.push({
                toClientId,
                message,
                delivery,
            });
        },
    };
}

async function createJoinedController({
    roomConnection,
    params = {},
}: Readonly<{
    roomConnection: FakeRoomConnection | undefined;
    params?: Partial<P2pAuthoritativeClientMultiplayerControllerParams<TestClientState>>;
}>) {
    const controller = new TestController({
        gameId: 'authoritative-client-test',
        sendInterval: {
            hours: 1,
        },
        ...params,
    });
    const stateEvents: ClientStateUpdate<TestClientState>[] = [];
    const leaveEvents: ClientId[] = [];

    controller.roomController.joinOrCreateRoom = () => {
        controller.roomController.currentConnection = roomConnection;
        return Promise.resolve();
    };
    controller.listen(MultiplayerControllerClientStateEvent, ({detail}) => {
        assert.isAbove(detail.receivedAt, 0);
        stateEvents.push({
            clientId: detail.clientId,
            sentAt: detail.sentAt,
            state: detail.state,
        });
    });
    controller.listen(MultiplayerControllerClientLeaveEvent, ({detail}) => {
        leaveEvents.push(detail.clientId);
    });

    await controller.joinOrCreateRoom(createNewRoom());

    return {
        controller,
        stateEvents,
        leaveEvents,
        receive(sourceClientId: ClientId, message: TestMessage) {
            controller.roomController.dispatch(
                new MultiplayerControllerMessageEvent(sourceClientId, message),
            );
        },
        updateStatus(detail: MultiplayerConnectionUpdate) {
            controller.roomController.dispatch(
                new MultiplayerControllerClientStatusEvent({
                    detail,
                }),
            );
        },
    };
}

function createStatesMessage(
    clientStates: ReadonlyArray<ClientStateUpdate<TestClientState>>,
): TestMessage {
    return {
        type: P2pAuthoritativeClientMessageType.ClientStates,
        clientStates: [
            ...clientStates,
        ],
    };
}

describe(P2pAuthoritativeClientMultiplayerController.name, () => {
    it('starts singleplayer once without sending anything', () => {
        const controller = new TestController({
            gameId: 'authoritative-client-test',
            createLocalState() {
                return {
                    x: 1,
                };
            },
        });
        const connectionStates: unknown[] = [];

        controller.listen(MultiplayerControllerConnectionEvent, ({detail}) => {
            connectionStates.push(detail);
        });
        controller.startSingleplayer();
        controller.sendClientStatesForTest();

        assert.throws(() => controller.startSingleplayer());
        assert.deepEquals(
            {
                connectionStates,
                isHost: controller.isHost(),
            },
            {
                connectionStates: [
                    {
                        api: MultiplayerConnectionState.Connected,
                        room: MultiplayerConnectionState.Disconnected,
                    },
                ],
                isHost: true,
            },
        );
        controller.destroy();
    });

    it('accepts connections by default or by the given check', async () => {
        const rejectedClientId = createMultiplayerId.client();
        const defaultController = new TestController({
            gameId: 'authoritative-client-test',
        });
        const checkedController = new TestController({
            gameId: 'authoritative-client-test',
            acceptConnection(clientId) {
                return clientId !== rejectedClientId;
            },
        });

        assert.deepEquals(
            [
                await defaultController.roomController['params'].acceptConnection?.(
                    rejectedClientId,
                    defaultController.roomController,
                ),
                await checkedController.roomController['params'].acceptConnection?.(
                    rejectedClientId,
                    checkedController.roomController,
                ),
            ],
            [
                true,
                false,
            ],
        );
    });

    it('throws when the joined room has no connection', async () => {
        await assert.throws(
            () => {
                return createJoinedController({
                    roomConnection: undefined,
                });
            },
            {
                matchMessage: 'room connection is missing',
            },
        );
    });

    it('sends member state to the host and receives newer states from other clients', async () => {
        const hostClientId = createMultiplayerId.client();
        const otherClientId = createMultiplayerId.client();
        const roomConnection = createFakeRoomConnection({
            isHost: false,
            connectedClientIds: [
                hostClientId,
            ],
        });
        const localStates: (TestClientState | undefined)[] = [
            undefined,
            {
                x: 1,
            },
        ];
        const joined = await createJoinedController({
            roomConnection,
            params: {
                createLocalState() {
                    return localStates.shift();
                },
            },
        });

        joined.controller.sendClientStatesForTest();
        joined.controller.sendClientStatesForTest();
        joined.receive(
            hostClientId,
            createStatesMessage([
                {
                    clientId: hostClientId,
                    sentAt: 10,
                    state: {
                        x: 10,
                    },
                },
                {
                    clientId: otherClientId,
                    sentAt: 20,
                    state: {
                        x: 20,
                    },
                },
                {
                    clientId: roomConnection.clientId,
                    sentAt: 30,
                    state: {
                        x: 30,
                    },
                },
            ]),
        );
        joined.receive(
            hostClientId,
            createStatesMessage([
                {
                    clientId: otherClientId,
                    sentAt: 19,
                    state: {
                        x: 19,
                    },
                },
            ]),
        );
        joined.receive(hostClientId, {
            type: P2pAuthoritativeClientMessageType.ClientLeave,
            clientId: otherClientId,
        });
        joined.receive(hostClientId, {
            type: P2pAuthoritativeClientMessageType.ClientLeave,
            clientId: otherClientId,
        });
        joined.updateStatus({
            lostHost: hostClientId,
        });

        assert.deepEquals(
            {
                leaveEvents: joined.leaveEvents,
                remoteClientStates: joined.controller.remoteClientStates,
                sentMessages: roomConnection.sentMessages.map(({message, delivery}) => {
                    return {
                        delivery,
                        message:
                            message.type === P2pAuthoritativeClientMessageType.ClientStates
                                ? message.clientStates.map(({clientId, state}) => {
                                      return {
                                          clientId,
                                          state,
                                      };
                                  })
                                : message,
                    };
                }),
                stateEvents: joined.stateEvents,
            },
            {
                leaveEvents: [
                    otherClientId,
                    hostClientId,
                ],
                remoteClientStates: {},
                sentMessages: [
                    {
                        delivery: MessageDelivery.Unreliable,
                        message: [
                            {
                                clientId: roomConnection.clientId,
                                state: {
                                    x: 1,
                                },
                            },
                        ],
                    },
                ],
                stateEvents: [
                    {
                        clientId: hostClientId,
                        sentAt: 10,
                        state: {
                            x: 10,
                        },
                    },
                    {
                        clientId: otherClientId,
                        sentAt: 20,
                        state: {
                            x: 20,
                        },
                    },
                ],
            },
        );
    });

    it('relays member states from the host to every other member', async () => {
        const firstMemberId = createMultiplayerId.client();
        const secondMemberId = createMultiplayerId.client();
        const roomConnection = createFakeRoomConnection({
            isHost: true,
            connectedClientIds: [
                firstMemberId,
                secondMemberId,
            ],
        });
        const joined = await createJoinedController({
            roomConnection,
        });

        joined.receive(
            firstMemberId,
            createStatesMessage([
                {
                    clientId: firstMemberId,
                    sentAt: 1,
                    state: {
                        x: 1,
                    },
                },
                {
                    clientId: secondMemberId,
                    sentAt: 1,
                    state: {
                        x: 666,
                    },
                },
            ]),
        );
        joined.receive(firstMemberId, {
            type: P2pAuthoritativeClientMessageType.ClientLeave,
            clientId: firstMemberId,
        });
        joined.controller.sendClientStatesForTest();
        joined.controller.sendClientStatesForTest();
        joined.receive(
            secondMemberId,
            createStatesMessage([
                {
                    clientId: secondMemberId,
                    sentAt: 2,
                    state: {
                        x: 2,
                    },
                },
            ]),
        );
        joined.updateStatus({
            lostMember: secondMemberId,
        });
        joined.updateStatus({
            newHost: roomConnection.clientId,
        });
        joined.controller.sendClientStatesForTest();

        assert.deepEquals(
            {
                leaveEvents: joined.leaveEvents,
                remoteClientIds: Object.keys(joined.controller.remoteClientStates),
                sentMessages: roomConnection.sentMessages,
            },
            {
                leaveEvents: [
                    secondMemberId,
                ],
                remoteClientIds: [
                    firstMemberId,
                ],
                sentMessages: [
                    {
                        toClientId: secondMemberId,
                        delivery: MessageDelivery.Unreliable,
                        message: createStatesMessage([
                            {
                                clientId: firstMemberId,
                                sentAt: 1,
                                state: {
                                    x: 1,
                                },
                            },
                        ]),
                    },
                    {
                        delivery: undefined,
                        message: {
                            type: P2pAuthoritativeClientMessageType.ClientLeave,
                            clientId: secondMemberId,
                        },
                    },
                ],
            },
        );

        joined.controller.leaveRoom();

        assert.deepEquals(joined.leaveEvents, [
            secondMemberId,
            firstMemberId,
        ]);
    });

    it('sends the host state to every member on each send interval', async () => {
        const memberId = createMultiplayerId.client();
        const roomConnection = createFakeRoomConnection({
            isHost: true,
            connectedClientIds: [
                memberId,
            ],
        });
        const {controller} = await createJoinedController({
            roomConnection,
            params: {
                sendInterval: {
                    milliseconds: 1,
                },
                createLocalState() {
                    return {
                        x: 5,
                    };
                },
            },
        });

        await waitUntil.isLengthAtLeast(2, () => roomConnection.sentMessages);
        controller.destroy();

        const sentMessage = roomConnection.sentMessages[0];
        assert.isDefined(sentMessage);
        assert.deepEquals(
            {
                ...sentMessage,
                message:
                    sentMessage.message.type === P2pAuthoritativeClientMessageType.ClientStates
                        ? sentMessage.message.clientStates.map(({clientId, state}) => {
                              return {
                                  clientId,
                                  state,
                              };
                          })
                        : sentMessage.message,
            },
            {
                toClientId: memberId,
                delivery: MessageDelivery.Unreliable,
                message: [
                    {
                        clientId: roomConnection.clientId,
                        state: {
                            x: 5,
                        },
                    },
                ],
            },
        );
    });
});
