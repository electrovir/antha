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
import {assert, assertWrap, waitUntil} from '@augment-vir/assert';
import {createArray, type PartialWithUndefined, selectFrom} from '@augment-vir/common';
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

    public syncClientClockForTest(
        params: Readonly<{
            clientId: ClientId;
            sentAt: number;
            receivedAt: number;
        }>,
    ) {
        return this.syncClientClock(params);
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
    const stateEvents: Pick<ClientStateUpdate<TestClientState>, 'clientId' | 'sentAt' | 'state'>[] =
        [];
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

/** Fills in a `sequence` that matches `sentAt` and no echoes, unless given. */
function createStatesMessage(
    clientStates: ReadonlyArray<
        Omit<ClientStateUpdate<TestClientState>, 'sequence' | 'echoes'> &
            Partial<Pick<ClientStateUpdate<TestClientState>, 'sequence' | 'echoes'>>
    >,
): TestMessage {
    return {
        type: P2pAuthoritativeClientMessageType.ClientStates,
        clientStates: clientStates.map((clientState) => {
            return {
                sequence: clientState.sentAt,
                echoes: [],
                ...clientState,
            };
        }),
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
                        toClientId: firstMemberId,
                        delivery: MessageDelivery.Unreliable,
                        message: createStatesMessage([
                            {
                                clientId: secondMemberId,
                                sentAt: 2,
                                state: {
                                    x: 2,
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

    it('repeats the previous states in each send', async () => {
        const hostClientId = createMultiplayerId.client();
        const memberRoomConnection = createFakeRoomConnection({
            isHost: false,
            connectedClientIds: [
                hostClientId,
            ],
        });
        const nextX = [
            1,
            2,
            3,
            4,
        ];
        const member = await createJoinedController({
            roomConnection: memberRoomConnection,
            params: {
                createLocalState() {
                    const x = nextX.shift();
                    return x == undefined
                        ? undefined
                        : {
                              x,
                          };
                },
            },
        });
        const firstMemberId = createMultiplayerId.client();
        const secondMemberId = createMultiplayerId.client();
        const hostRoomConnection = createFakeRoomConnection({
            isHost: true,
            connectedClientIds: [
                firstMemberId,
                secondMemberId,
            ],
        });
        const host = await createJoinedController({
            roomConnection: hostRoomConnection,
        });

        createArray(4, () => member.controller.sendClientStatesForTest());
        [
            1,
            2,
        ].forEach((sentAt) => {
            host.receive(
                firstMemberId,
                createStatesMessage([
                    {
                        clientId: firstMemberId,
                        sentAt,
                        state: {
                            x: sentAt,
                        },
                    },
                ]),
            );
        });
        host.controller.sendClientStatesForTest();

        assert.deepEquals(
            {
                memberSends: memberRoomConnection.sentMessages.map(({message}) => {
                    return message.type === P2pAuthoritativeClientMessageType.ClientStates
                        ? message.clientStates.map(({state}) => state.x)
                        : [];
                }),
                hostSends: hostRoomConnection.sentMessages.map(({toClientId, message}) => {
                    return {
                        toClientId,
                        sentAts:
                            message.type === P2pAuthoritativeClientMessageType.ClientStates
                                ? message.clientStates.map(({sentAt}) => sentAt)
                                : [],
                    };
                }),
            },
            {
                memberSends: [
                    [
                        1,
                    ],
                    [
                        1,
                        2,
                    ],
                    [
                        1,
                        2,
                        3,
                    ],
                    [
                        2,
                        3,
                        4,
                    ],
                ],
                hostSends: [
                    {
                        toClientId: secondMemberId,
                        sentAts: [
                            1,
                        ],
                    },
                    {
                        toClientId: secondMemberId,
                        sentAts: [
                            1,
                            2,
                        ],
                    },
                ],
            },
        );
    });

    it('moves the smoothed delay slowly toward the fastest recent delivery', async () => {
        const {controller} = await createJoinedController({
            roomConnection: createFakeRoomConnection({
                isHost: false,
                connectedClientIds: [],
            }),
        });
        const clientId = createMultiplayerId.client();

        assert.deepEquals(
            [
                [
                    0,
                    100,
                ],
                [
                    100,
                    150,
                ],
                [
                    200,
                    400,
                ],
                [
                    3000,
                    3300,
                ],
            ].map(
                ([
                    sentAt,
                    receivedAt,
                ]) => {
                    return controller.syncClientClockForTest({
                        clientId,
                        sentAt: assertWrap.isDefined(sentAt),
                        receivedAt: assertWrap.isDefined(receivedAt),
                    });
                },
            ),
            [
                100,
                95,
                90,
                230,
            ],
        );
    });

    it('measures connection stats and round trips, and drops invalid states', async () => {
        const hostClientId = createMultiplayerId.client();
        const otherClientId = createMultiplayerId.client();
        const repeatOnlyClientId = createMultiplayerId.client();
        const roomConnection = createFakeRoomConnection({
            isHost: false,
            connectedClientIds: [
                hostClientId,
            ],
        });
        const joined = await createJoinedController({
            roomConnection,
            params: {
                createLocalState() {
                    return {
                        x: 0,
                    };
                },
                isValidState({next}) {
                    return next.state.x !== 666;
                },
            },
        });
        const echoSentAt = performance.now() - 40;

        [
            [
                1,
                2,
            ],
            [
                3,
                4,
                5,
            ],
            [
                8,
            ],
            [
                9,
            ],
        ].forEach((sequences) => {
            joined.receive(
                hostClientId,
                createStatesMessage(
                    sequences.map((sequence) => {
                        return {
                            clientId: otherClientId,
                            sentAt: sequence * 100,
                            sequence,
                            echoes:
                                sequence === 5
                                    ? [
                                          {
                                              clientId: roomConnection.clientId,
                                              sentAt: echoSentAt,
                                              receivedAt: 490,
                                          },
                                      ]
                                    : [],
                            state: {
                                x: sequence === 9 ? 666 : sequence,
                            },
                        };
                    }),
                ),
            );
        });
        joined.receive(
            hostClientId,
            createStatesMessage([
                {
                    clientId: repeatOnlyClientId,
                    sentAt: 1,
                    state: {
                        x: 1,
                    },
                },
                {
                    clientId: repeatOnlyClientId,
                    sentAt: 2,
                    state: {
                        x: 666,
                    },
                },
            ]),
        );
        joined.controller.sendClientStatesForTest();

        const stats = joined.controller.getConnectionStats({
            seconds: 10,
        });
        const otherStats = assertWrap.isDefined(stats[otherClientId]);
        const roundTrip = assertWrap.isDefined(otherStats.roundTrip).milliseconds;
        const sentMessage = assertWrap.isDefined(roomConnection.sentMessages[0]).message;

        assert.isAtLeast(roundTrip, 30);
        assert.isBelow(roundTrip, 1000);
        assert.deepEquals(
            {
                echoes:
                    sentMessage.type === P2pAuthoritativeClientMessageType.ClientStates
                        ? sentMessage.clientStates.flatMap(({echoes}) => {
                              return echoes.map(({clientId, sentAt}) => {
                                  return {
                                      clientId,
                                      sentAt,
                                  };
                              });
                          })
                        : [],
                otherState: joined.controller.remoteClientStates[otherClientId]?.state,
                otherRoundTrip: joined.controller.remoteClientStates[otherClientId]?.roundTrip,
                otherStats: selectFrom(otherStats, {
                    receivedCount: true,
                    recoveredCount: true,
                    missedCount: true,
                }),
                repeatOnlyStats: selectFrom(assertWrap.isDefined(stats[repeatOnlyClientId]), {
                    receivedCount: true,
                    recoveredCount: true,
                    jitter: true,
                    roundTrip: true,
                }),
                emptyWindowStats: selectFrom(
                    assertWrap.isDefined(
                        joined.controller.getConnectionStats({
                            milliseconds: 0,
                        })[otherClientId],
                    ),
                    {
                        receivedCount: true,
                        missedCount: true,
                    },
                ),
            },
            {
                echoes: [
                    {
                        clientId: otherClientId,
                        sentAt: 800,
                    },
                    {
                        clientId: repeatOnlyClientId,
                        sentAt: 1,
                    },
                ],
                otherState: {
                    x: 8,
                },
                otherRoundTrip: {
                    milliseconds: roundTrip,
                },
                otherStats: {
                    receivedCount: 6,
                    recoveredCount: 3,
                    missedCount: 2,
                },
                repeatOnlyStats: {
                    receivedCount: 1,
                    recoveredCount: 1,
                    jitter: {
                        milliseconds: 0,
                    },
                    roundTrip: undefined,
                },
                emptyWindowStats: {
                    receivedCount: 0,
                    missedCount: 0,
                },
            },
        );
    });

    it('hands off the host while its page is hidden and joins again once shown', async () => {
        const pageVisibility = {
            hidden: false,
        };
        Object.defineProperty(globalThis.document, 'hidden', {
            configurable: true,
            get() {
                return pageVisibility.hidden;
            },
        });

        function setPageHidden(hidden: boolean) {
            pageVisibility.hidden = hidden;
            globalThis.document.dispatchEvent(new Event('visibilitychange'));
        }

        try {
            const memberId = createMultiplayerId.client();
            const roomConnection = createFakeRoomConnection({
                isHost: true,
                connectedClientIds: [
                    memberId,
                ],
            });
            const lonelyRoomConnection = createFakeRoomConnection({
                isHost: true,
                connectedClientIds: [],
            });
            const joined = await createJoinedController({
                roomConnection,
                params: {
                    hostHandoffDelay: {
                        milliseconds: 1,
                    },
                },
            });
            const lonely = await createJoinedController({
                roomConnection: lonelyRoomConnection,
                params: {
                    hostHandoffDelay: {
                        milliseconds: 1,
                    },
                },
            });

            setPageHidden(true);
            await waitUntil.isFalse(() => joined.controller.isConnected());
            assert.isTrue(lonely.controller.isConnected());

            setPageHidden(false);
            await waitUntil.isTrue(() => joined.controller.isConnected());

            setPageHidden(true);
            await waitUntil.isFalse(() => joined.controller.isConnected());
            const failedJoins: Error[] = [];
            joined.controller.roomController.joinOrCreateRoom = () => {
                const error = new Error('room server is down');
                failedJoins.push(error);
                return Promise.reject(error);
            };
            setPageHidden(false);
            await waitUntil.isLengthExactly(1, () => failedJoins);

            assert.isFalse(joined.controller.isConnected());
            joined.controller.destroy();
            lonely.controller.destroy();
        } finally {
            Reflect.deleteProperty(globalThis.document, 'hidden');
        }
    });
});
