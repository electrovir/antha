import {
    type ClientId,
    ControllerClientEvent,
    ControllerConnectionEvent,
    ControllerMessageEvent,
    ControllerRoomListEvent,
    createMockRoomHandlerServerApiClient,
    createMultiplayerId,
    createNewRoom,
    MultiplayerConnectionState,
    type MultiplayerRoomConnection,
    multiplayerRoomsEndpoint,
} from '@antha/multiplayer-core';
import {assert, assertWrap} from '@augment-vir/assert';
import {type MaybePromise, wait} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {
    ControllerFrameEvent,
    type FrameEventDetail,
    type P2pLockStepMessage,
    P2pLockStepMessageType,
    P2pLockStepMultiplayerController,
} from './p2p-lock-step-multiplayer-controller.js';

class InspectableP2pLockStepMultiplayerController extends P2pLockStepMultiplayerController<string> {
    public forceUndefinedClientIdForTest = false;

    public override getClientId() {
        return this.forceUndefinedClientIdForTest ? undefined : super.getClientId();
    }

    public setRoomConnectionForTest(
        roomConnection: MultiplayerRoomConnection<P2pLockStepMessage<string>> | undefined,
    ) {
        this.roomConnection = roomConnection;
    }

    public setFrameMsForTest(frameMs: number | undefined) {
        this.frameMs = frameMs;
    }

    public setFrameTickReadyForTest(frameTickReady: boolean) {
        this.frameTickReady = frameTickReady;
    }

    public calculateFpsForTest() {
        this.calculateFps();
    }

    public setLastFpsCalculationForTest(
        lastFpsCalculation: Readonly<{timestamp: number; frameCount: number}>,
    ) {
        this.lastFpsCalculation = lastFpsCalculation;
    }

    public get roomConnectionForTest() {
        return this.roomConnection;
    }

    public get localClientIdForTest() {
        return this.localClientId;
    }
}

class FakeDataChannel extends EventTarget {
    public readonly sentMessages: string[] = [];
    public isClosed = false;

    public send(message: string) {
        this.sentMessages.push(message);
    }

    public close() {
        this.isClosed = true;
    }
}

class FakePeerConnection extends EventTarget {
    public static readonly instances: FakePeerConnection[] = [];

    public readonly createdDataChannels: FakeDataChannel[] = [];
    public localDescription: RTCSessionDescriptionInit | undefined;
    public remoteDescription: RTCSessionDescriptionInit | undefined;

    constructor() {
        super();
        FakePeerConnection.instances.push(this);
    }

    public override addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: AddEventListenerOptions | boolean | undefined,
    ) {
        super.addEventListener(type, listener, options);

        if (type === 'icecandidate' && listener) {
            queueMicrotask(() => {
                this.dispatchEvent(
                    Object.assign(new Event('icecandidate'), {
                        candidate: undefined,
                    }),
                );
            });
        }
    }

    public createDataChannel() {
        const dataChannel = new FakeDataChannel();
        this.createdDataChannels.push(dataChannel);

        return dataChannel;
    }

    public createOffer(): Promise<RTCSessionDescriptionInit> {
        return Promise.resolve({
            type: 'offer',
            sdp: 'mock offer',
        });
    }

    public createAnswer(): Promise<RTCSessionDescriptionInit> {
        return Promise.resolve({
            type: 'answer',
            sdp: 'mock answer',
        });
    }

    public setLocalDescription(description: RTCSessionDescriptionInit) {
        this.localDescription = description;

        return Promise.resolve();
    }

    public setRemoteDescription(description: RTCSessionDescriptionInit) {
        this.remoteDescription = description;

        if (description.type === 'offer') {
            const dataChannel = new FakeDataChannel();
            this.createdDataChannels.push(dataChannel);
            this.dispatchEvent(
                Object.assign(new Event('datachannel'), {
                    channel: dataChannel,
                }),
            );
            setTimeout(() => dataChannel.dispatchEvent(new Event('open')), 50);
        } else if (description.type === 'answer') {
            const dataChannel = this.createdDataChannels[0];
            assert.isDefined(dataChannel);
            setTimeout(() => dataChannel.dispatchEvent(new Event('open')), 1000);
        }

        return Promise.resolve();
    }

    public close() {}
}

async function withMockPeerConnection(callback: () => MaybePromise<void>) {
    const originalPeerConnection = globalThis.RTCPeerConnection;
    FakePeerConnection.instances.length = 0;

    Object.defineProperty(globalThis, 'RTCPeerConnection', {
        configurable: true,
        value: FakePeerConnection,
        writable: true,
    });

    try {
        await callback();
    } finally {
        Object.defineProperty(globalThis, 'RTCPeerConnection', {
            configurable: true,
            value: originalPeerConnection,
            writable: true,
        });
    }
}

function createController({
    acceptConnection,
    debugMultiplayer = false,
    gameId = 'lock-step-test',
}: Readonly<{
    acceptConnection?: ((connectingClientId: ClientId) => MaybePromise<boolean>) | undefined;
    debugMultiplayer?: boolean | undefined;
    gameId?: string | undefined;
}> = {}) {
    return new InspectableP2pLockStepMultiplayerController({
        gameId,
        debugMultiplayer,
        ...(acceptConnection && {
            acceptConnection,
        }),
        frameDuration: {
            milliseconds: 1,
        },
    });
}

function createFakeConnection({
    connected = true,
    connectedClientIds,
    host = true,
}: Readonly<{
    connected?: boolean | undefined;
    connectedClientIds?: ReadonlyArray<ClientId> | undefined;
    host?: boolean | undefined;
}> = {}): MultiplayerRoomConnection<P2pLockStepMessage<string>> & {
    setHost: (isHost: boolean) => void;
    sentMessages: ReadonlyArray<P2pLockStepMessage<string>>;
    onlyOneClientMessages: ReadonlyArray<{
        clientId: ClientId;
        message: P2pLockStepMessage<string>;
    }>;
} {
    const clientId = createMultiplayerId.client();
    const sentMessages: P2pLockStepMessage<string>[] = [];
    const onlyOneClientMessages: {
        clientId: ClientId;
        message: P2pLockStepMessage<string>;
    }[] = [];
    let isHost = host;

    return {
        clientId,
        setHost(nextIsHost) {
            isHost = nextIsHost;
        },
        sentMessages,
        onlyOneClientMessages,
        destroy() {},
        getAllClientIds() {
            return [
                this.clientId,
                ...(connectedClientIds || []),
            ];
        },
        getConnectedClientIds() {
            return connected ? [...(connectedClientIds || [this.clientId])] : [];
        },
        isConnected() {
            return connected;
        },
        isHost() {
            return isHost;
        },
        sendMessage(message) {
            sentMessages.push(message);
        },
        sendToOnlyOneClient(clientId, message) {
            onlyOneClientMessages.push({
                clientId,
                message,
            });
        },
    };
}

function createActionsMessage({
    actions,
    sourceClientId = createMultiplayerId.client(),
}: Readonly<{
    actions: string[];
    sourceClientId?: ClientId | undefined;
}>): P2pLockStepMessage<string> {
    return {
        actions,
        sourceClientId,
        type: P2pLockStepMessageType.Actions,
    };
}

function createFrameMessage(
    actions: ReadonlyArray<FrameEventDetail<string>>,
): P2pLockStepMessage<string> {
    return {
        actions: [
            ...actions,
        ],
        type: P2pLockStepMessageType.Frame,
    };
}

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
                    sourceClientId: clientId,
                    packet: 'one',
                },
            ],
            [
                {
                    sourceClientId: clientId,
                    packet: 'two',
                },
                {
                    sourceClientId: clientId,
                    packet: 'three',
                },
            ],
        ]);
        controller.destroy();
    });

    it('exposes connection state and guards invalid lifecycle calls', async () => {
        const controller = createController();

        assert.deepEquals(
            {
                allClientIds: controller.getAllClientIds(),
                apiConnectionState: controller.apiConnectionState,
                clientId: controller.getClientId(),
                connectedClientIds: controller.getConnectedClientIds(),
                currentConnection: controller.currentConnection,
                fps: controller.getFps(),
                isConnected: controller.isConnected(),
                isHost: controller.isHost(),
                knownErrors: controller.knownErrors,
                multiplayerApiClient: controller.multiplayerApiClient,
                roomConnectionState: controller.roomConnectionState,
                roomId: controller.roomId,
                staticEvents: Object.keys(P2pLockStepMultiplayerController.events).toSorted(),
                staticKnownErrors: P2pLockStepMultiplayerController.knownErrors,
            },
            {
                allClientIds: [],
                apiConnectionState: MultiplayerConnectionState.Disconnected,
                clientId: undefined,
                connectedClientIds: [],
                currentConnection: undefined,
                fps: 0,
                isConnected: false,
                isHost: false,
                knownErrors: P2pLockStepMultiplayerController.knownErrors,
                multiplayerApiClient: undefined,
                roomConnectionState: MultiplayerConnectionState.Disconnected,
                roomId: undefined,
                staticEvents: [
                    'ControllerFrameEvent',
                ],
                staticKnownErrors: controller.knownErrors,
            },
        );

        controller.startRoomUpdates();
        controller.stopRoomUpdates();

        assert.throws(() => controller.act('before-connect'));
        assert.throws(() => controller.runFrame());

        controller.startSingleplayer();

        assert.throws(() => controller.startSingleplayer(), {
            matchMessage: 'Cannot start singleplayer with a connection already present.',
        });
        await assert.throws(() => controller.joinOrCreateRoom(createNewRoom()), {
            matchMessage: 'Please start this controller in multiplayer mode',
        });

        controller.leaveRoom();
        controller.leaveRoom();
        controller.destroy();

        assert.isFalse(controller.isConnected());
    });

    it('opens an ongoing singleplayer game to multiplayer', async () => {
        await withMockPeerConnection(async () => {
            const room = createNewRoom({
                roomName: 'Opened Lock Step Room',
            });
            const apiClient = createMockRoomHandlerServerApiClient();
            const controller = createController({
                gameId: 'opened-lock-step-test',
            });
            const state: {
                frames: ReadonlyArray<ReadonlyArray<FrameEventDetail<string>>>;
            } = {
                frames: [],
            };

            controller.listen(ControllerFrameEvent, ({detail}) => {
                if (detail.length) {
                    state.frames = [
                        ...state.frames,
                        detail,
                    ];
                }
            });

            controller.startSingleplayer();
            const singleplayerClientId = assertWrap.isDefined(controller.getClientId());
            controller.act('before-opening');
            await wait({
                milliseconds: 5,
            });

            const roomsBeforeOpening = await apiClient.fetch(multiplayerRoomsEndpoint).GET({
                searchParams: {
                    gameId: ['opened-lock-step-test'],
                },
            });
            assert.isDefined(roomsBeforeOpening.Ok);

            await controller.initMultiplayer({
                backendOrigin: 'http://mock.example',
                multiplayerApiClient: apiClient,
            });

            const roomsBeforeJoining = await apiClient.fetch(multiplayerRoomsEndpoint).GET({
                searchParams: {
                    gameId: ['opened-lock-step-test'],
                },
            });
            assert.isDefined(roomsBeforeJoining.Ok);
            await controller.joinOrCreateRoom(room);

            const roomsAfterOpening = await apiClient.fetch(multiplayerRoomsEndpoint).GET({
                searchParams: {
                    gameId: ['opened-lock-step-test'],
                },
            });
            assert.isDefined(roomsAfterOpening.Ok);

            assert.deepEquals(
                {
                    clientId: controller.getClientId(),
                    frames: state.frames,
                    isHost: controller.isHost(),
                    roomBeforeOpening: roomsBeforeOpening.Ok.responseData,
                    roomBeforeJoining: roomsBeforeJoining.Ok.responseData,
                    roomAfterOpening: roomsAfterOpening.Ok.responseData,
                },
                {
                    clientId: singleplayerClientId,
                    frames: [
                        [
                            {
                                packet: 'before-opening',
                                sourceClientId: singleplayerClientId,
                            },
                        ],
                    ],
                    isHost: true,
                    roomBeforeOpening: {},
                    roomBeforeJoining: {},
                    roomAfterOpening: {
                        [room.roomId]: {
                            clientCount: 1,
                            hasRoomPassword: false,
                            roomId: room.roomId,
                            roomName: room.roomName,
                        },
                    },
                },
            );

            controller.destroy();
        });
    });

    it('forwards room controller events and host actions', () => {
        const controller = createController();
        const memberClientId = createMultiplayerId.client();
        const fakeConnection = createFakeConnection({
            connectedClientIds: [
                memberClientId,
            ],
        });
        const room = createNewRoom({
            roomName: 'Room Name',
        });
        const state: {
            clientEvents: unknown[];
            connectionEvents: unknown[];
            frames: ReadonlyArray<ReadonlyArray<FrameEventDetail<string>>>;
            roomListEvents: unknown[];
        } = {
            clientEvents: [],
            connectionEvents: [],
            frames: [],
            roomListEvents: [],
        };

        controller.listen(ControllerClientEvent, ({detail}) => {
            state.clientEvents.push(detail);
        });
        controller.listen(ControllerConnectionEvent, ({detail}) => {
            state.connectionEvents.push(detail);
        });
        controller.listen(ControllerFrameEvent, ({detail}) => {
            state.frames = [
                ...state.frames,
                detail,
            ];
        });
        controller.listen(ControllerRoomListEvent, ({detail}) => {
            state.roomListEvents.push(detail);
        });

        controller.setRoomConnectionForTest(fakeConnection);
        assert.strictEquals(controller.clientId, fakeConnection.clientId);
        controller.roomController.dispatch(
            new ControllerRoomListEvent({
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
        controller.roomController.dispatch(
            new ControllerConnectionEvent({
                detail: {
                    api: MultiplayerConnectionState.Connected,
                    room: MultiplayerConnectionState.Connected,
                },
            }),
        );
        controller.roomController.dispatch(
            new ControllerClientEvent({
                detail: {
                    newMember: memberClientId,
                },
            }),
        );
        controller.act('host-action');
        controller.setFrameTickReadyForTest(true);
        controller.roomController.dispatch(
            new ControllerMessageEvent(
                memberClientId,
                createActionsMessage({
                    actions: [
                        'member-action',
                    ],
                    sourceClientId: memberClientId,
                }),
            ),
        );
        controller.roomController.dispatch(
            new ControllerMessageEvent(
                memberClientId,
                createActionsMessage({
                    actions: [
                        'ignored-action',
                    ],
                    sourceClientId: memberClientId,
                }),
            ),
        );
        controller.setRoomConnectionForTest(undefined);
        controller.roomController.dispatch(
            new ControllerMessageEvent(
                memberClientId,
                createActionsMessage({
                    actions: [
                        'missing-connection-action',
                    ],
                    sourceClientId: memberClientId,
                }),
            ),
        );

        assert.deepEquals(
            {
                clientEvents: state.clientEvents,
                connectionEvents: state.connectionEvents,
                frames: state.frames,
                onlyOneClientMessages: fakeConnection.onlyOneClientMessages,
                roomListEvents: state.roomListEvents,
                sentMessages: fakeConnection.sentMessages,
            },
            {
                clientEvents: [
                    {
                        newMember: memberClientId,
                    },
                ],
                connectionEvents: [
                    {
                        api: MultiplayerConnectionState.Connected,
                        room: MultiplayerConnectionState.Connected,
                    },
                ],
                frames: [
                    [
                        {
                            sourceClientId: fakeConnection.clientId,
                            packet: 'host-action',
                        },
                        {
                            sourceClientId: memberClientId,
                            packet: 'member-action',
                        },
                    ],
                ],
                onlyOneClientMessages: [
                    {
                        clientId: memberClientId,
                        message: {
                            actions: [],
                            type: P2pLockStepMessageType.Frame,
                        },
                    },
                ],
                roomListEvents: [
                    {
                        [room.roomId]: {
                            clientCount: 1,
                            hasRoomPassword: false,
                            roomId: room.roomId,
                            roomName: room.roomName,
                        },
                    },
                ],
                sentMessages: [
                    {
                        actions: [
                            {
                                sourceClientId: fakeConnection.clientId,
                                packet: 'host-action',
                            },
                            {
                                sourceClientId: memberClientId,
                                packet: 'member-action',
                            },
                        ],
                        type: P2pLockStepMessageType.Frame,
                    },
                ],
            },
        );
    });

    it('sends member actions after receiving frames', () => {
        const controller = createController();
        const fakeConnection = createFakeConnection({
            host: false,
        });
        const hostClientId = createMultiplayerId.client();
        const state: {
            frames: ReadonlyArray<ReadonlyArray<FrameEventDetail<string>>>;
        } = {
            frames: [],
        };

        controller.listen(ControllerFrameEvent, ({detail}) => {
            state.frames = [
                ...state.frames,
                detail,
            ];
        });

        controller.setRoomConnectionForTest(fakeConnection);
        controller.act([
            'member-one',
            'member-two',
        ]);
        controller.roomController.dispatch(
            new ControllerMessageEvent(
                hostClientId,
                createFrameMessage([
                    {
                        sourceClientId: hostClientId,
                        packet: 'host-frame',
                    },
                ]),
            ),
        );
        controller.roomController.dispatch(
            new ControllerMessageEvent(
                hostClientId,
                createActionsMessage({
                    actions: [
                        'ignored-member-input',
                    ],
                    sourceClientId: hostClientId,
                }),
            ),
        );

        assert.deepEquals(
            {
                frames: state.frames,
                sentMessages: fakeConnection.sentMessages,
            },
            {
                frames: [
                    [
                        {
                            sourceClientId: hostClientId,
                            packet: 'host-frame',
                        },
                    ],
                ],
                sentMessages: [
                    {
                        actions: [
                            'member-one',
                            'member-two',
                        ],
                        sourceClientId: fakeConnection.clientId,
                        type: P2pLockStepMessageType.Actions,
                    },
                ],
            },
        );
    });

    it('restarts frame production after becoming the host', () => {
        const controller = createController();
        const fakeConnection = createFakeConnection({
            host: false,
        });
        controller.setFrameMsForTest(undefined);
        controller.setRoomConnectionForTest(fakeConnection);
        fakeConnection.setHost(true);

        controller.roomController.dispatch(
            new ControllerClientEvent({
                detail: {
                    newHost: controller.localClientIdForTest,
                },
            }),
        );

        assert.deepEquals(fakeConnection.sentMessages, [
            {
                actions: [],
                type: P2pLockStepMessageType.Frame,
            },
        ]);
        controller.destroy();
    });

    it('runs manual frames when automatic frame duration is disabled', () => {
        const controller = createController();
        const state: {
            frames: ReadonlyArray<ReadonlyArray<FrameEventDetail<string>>>;
        } = {
            frames: [],
        };

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
        controller.setFrameMsForTest(undefined);
        controller.runFrame([
            'manual',
        ]);

        assert.deepEquals(state.frames, [
            [
                {
                    sourceClientId: clientId,
                    packet: 'manual',
                },
            ],
        ]);
    });

    it('calculates fps across elapsed time windows', () => {
        const controller = createController();

        controller.calculateFpsForTest();
        controller.setLastFpsCalculationForTest({
            frameCount: 4,
            timestamp: Date.now() - 2000,
        });
        controller.calculateFpsForTest();

        assert.isAbove(controller.getFps(), 0);
    });

    it('uses unknown client fallback in debug logs', async () => {
        const singleplayerController = createController({
            debugMultiplayer: true,
        });
        singleplayerController.forceUndefinedClientIdForTest = true;
        singleplayerController.startSingleplayer();
        singleplayerController.destroy();

        const multiplayerController = createController({
            debugMultiplayer: true,
        });
        multiplayerController.forceUndefinedClientIdForTest = true;
        multiplayerController.roomController.joinOrCreateRoom = () => Promise.resolve();
        multiplayerController.roomController.currentConnection = createFakeConnection();

        await multiplayerController.joinOrCreateRoom(createNewRoom());

        multiplayerController.destroy();
    });

    it('joins rooms as host and member', async () => {
        await withMockPeerConnection(async () => {
            const room = createNewRoom({
                roomName: 'Lock Step Room',
            });
            const apiClient = createMockRoomHandlerServerApiClient();
            const host = createController({
                gameId: 'joined-lock-step-test',
                acceptConnection() {
                    return true;
                },
            });
            const member = createController({
                gameId: 'joined-lock-step-test',
            });
            const state: {
                hostFrames: ReadonlyArray<ReadonlyArray<FrameEventDetail<string>>>;
                memberFrames: ReadonlyArray<ReadonlyArray<FrameEventDetail<string>>>;
            } = {
                hostFrames: [],
                memberFrames: [],
            };

            host.listen(ControllerFrameEvent, ({detail}) => {
                state.hostFrames = [
                    ...state.hostFrames,
                    detail,
                ];
            });
            member.listen(ControllerFrameEvent, ({detail}) => {
                state.memberFrames = [
                    ...state.memberFrames,
                    detail,
                ];
            });

            await host.initMultiplayer({
                backendOrigin: 'http://mock.example',
                multiplayerApiClient: apiClient,
            });
            await member.initMultiplayer({
                backendOrigin: 'http://mock.example',
                multiplayerApiClient: apiClient,
            });
            await host.joinOrCreateRoom(room);
            await member.joinOrCreateRoom(room);
            const hostClientId = assertWrap.isDefined(host.getClientId());
            const memberClientId = assertWrap.isDefined(member.getClientId());

            host.setFrameTickReadyForTest(true);
            host.roomController.dispatch(
                new ControllerMessageEvent(
                    memberClientId,
                    createActionsMessage({
                        actions: [
                            'member-action',
                        ],
                        sourceClientId: memberClientId,
                    }),
                ),
            );
            member.roomController.dispatch(
                new ControllerMessageEvent(
                    hostClientId,
                    createFrameMessage([
                        {
                            sourceClientId: memberClientId,
                            packet: 'member-action',
                        },
                    ]),
                ),
            );

            assert.deepEquals(
                {
                    hostAllClientIds: host.getAllClientIds().toSorted(),
                    hostConnectedClientIds: host.getConnectedClientIds(),
                    hostIsHost: host.isHost(),
                    memberAllClientIds: member.getAllClientIds().toSorted(),
                    memberFrames: state.memberFrames,
                    memberIsHost: member.isHost(),
                    memberRoomId: member.roomId,
                },
                {
                    hostAllClientIds: [
                        hostClientId,
                        memberClientId,
                    ].toSorted(),
                    hostConnectedClientIds: [
                        memberClientId,
                    ],
                    hostIsHost: true,
                    memberAllClientIds: [
                        hostClientId,
                        memberClientId,
                    ].toSorted(),
                    memberFrames: [
                        [
                            {
                                sourceClientId: memberClientId,
                                packet: 'member-action',
                            },
                        ],
                    ],
                    memberIsHost: false,
                    memberRoomId: room.roomId,
                },
            );
            assert.isLengthAtLeast(state.hostFrames, 1);

            host.destroy();
            member.destroy();
        });
    });

    it('resets frame state when joining another room while connected', async () => {
        const controller = createController();
        const previousConnection = createFakeConnection();
        const nextConnection = createFakeConnection({
            host: false,
        });

        controller.setRoomConnectionForTest(previousConnection);
        controller.setFrameTickReadyForTest(false);
        controller.roomController.joinOrCreateRoom = () => {
            controller.roomController.currentConnection = nextConnection;

            return Promise.resolve();
        };

        await controller.joinOrCreateRoom(createNewRoom());

        assert.deepEquals(
            {
                nextConnectionMessages: nextConnection.sentMessages,
                roomConnection: controller.roomConnectionForTest,
            },
            {
                nextConnectionMessages: [
                    {
                        actions: [],
                        sourceClientId: nextConnection.clientId,
                        type: P2pLockStepMessageType.Actions,
                    },
                ],
                roomConnection: nextConnection,
            },
        );
    });

    it('preserves room connection on join failures while connected', async () => {
        const disconnectedController = createController();
        const connectedController = createController();
        const previousConnection = createFakeConnection();

        disconnectedController.roomController.joinOrCreateRoom = () => Promise.resolve();

        await assert.throws(() => disconnectedController.joinOrCreateRoom(createNewRoom()), {
            matchMessage: 'room connection is missing',
        });

        assert.isUndefined(disconnectedController.roomConnectionForTest);

        connectedController.roomController.joinOrCreateRoom = () => Promise.resolve();
        connectedController.setRoomConnectionForTest(previousConnection);

        await assert.throws(() => connectedController.joinOrCreateRoom(createNewRoom()), {
            matchMessage: 'room connection is missing',
        });

        assert.strictEquals(connectedController.roomConnectionForTest, previousConnection);
    });

    it('passes through room rejection errors', async () => {
        await withMockPeerConnection(async () => {
            const room = createNewRoom({
                roomName: 'Rejected Lock Step Room',
            });
            const apiClient = createMockRoomHandlerServerApiClient();
            const host = createController({
                gameId: 'rejected-lock-step-test',
                acceptConnection() {
                    return false;
                },
            });
            const member = createController({
                gameId: 'rejected-lock-step-test',
            });

            await host.initMultiplayer({
                backendOrigin: 'http://mock.example',
                multiplayerApiClient: apiClient,
            });
            await member.initMultiplayer({
                backendOrigin: 'http://mock.example',
                multiplayerApiClient: apiClient,
            });
            await host.joinOrCreateRoom(room);

            await assert.throws(() => member.joinOrCreateRoom(room), {
                matchMessage: 'Room connection rejected',
            });

            assert.instanceOf(
                member.roomConnectionState,
                P2pLockStepMultiplayerController.knownErrors.RoomRejectionError,
            );

            host.destroy();
            member.destroy();
        });
    });
});
