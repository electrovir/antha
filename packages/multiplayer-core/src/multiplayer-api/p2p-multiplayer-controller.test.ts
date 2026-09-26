import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {type ClientId, createMultiplayerId} from '../multiplayer-id.js';
import {createMockRoomHandlerServerApiClient} from '../room-handler-server/mock-room-handler-server-api-client.js';
import {type MultiplayerConnectionUpdate} from '../webrtc/webrtc-multiplayer-controller.js';
import {
    MultiplayerConnectionState,
    MultiplayerControllerClientStatusEvent,
    MultiplayerControllerConnectionEvent,
    MultiplayerControllerMessageEvent,
    MultiplayerControllerRoomListEvent,
    type MultiplayerRoomConnection,
} from './multiplayer-controller.js';
import {P2pMultiplayerController} from './p2p-multiplayer-controller.js';

type TestMessage = {
    value: string;
};

class MinimalP2pController extends P2pMultiplayerController<TestMessage> {
    public readonly receivedMessages: {
        sourceClientId: ClientId;
        message: Readonly<TestMessage>;
    }[] = [];

    public acceptedClientId: ClientId | undefined;

    public setRoomConnectionForTest(
        roomConnection: MultiplayerRoomConnection<TestMessage> | undefined,
    ) {
        this.roomConnection = roomConnection;
    }

    public setSingleplayerForTest(singleplayer: boolean) {
        this.singleplayer = singleplayer;
    }

    public get localClientIdForTest() {
        return this.localClientId;
    }

    protected override shouldAcceptConnection(connectingClientId: ClientId) {
        return connectingClientId === this.acceptedClientId;
    }

    protected override handleReceivedMessage(
        sourceClientId: ClientId,
        message: Readonly<TestMessage>,
    ) {
        this.receivedMessages.push({
            sourceClientId,
            message,
        });
    }
}

class HookedP2pController extends MinimalP2pController {
    public readonly preparedConnections: Readonly<MultiplayerRoomConnection<TestMessage>>[] = [];
    public readonly clientStatuses: Readonly<MultiplayerConnectionUpdate>[] = [];

    protected override prepareRoomConnection(
        roomConnection: Readonly<MultiplayerRoomConnection<TestMessage>>,
    ) {
        this.preparedConnections.push(roomConnection);
    }

    protected override handleClientStatus(status: Readonly<MultiplayerConnectionUpdate>) {
        this.clientStatuses.push(status);
    }
}

function createFakeConnection({
    connected,
    host,
}: Readonly<{
    connected: boolean;
    host: boolean;
}>): MultiplayerRoomConnection<TestMessage> & {
    destroyed: boolean;
} {
    return {
        clientId: createMultiplayerId.client(),
        destroyed: false,
        destroy() {
            this.destroyed = true;
        },
        getAllClientIds() {
            return [
                this.clientId,
            ];
        },
        getConnectedClientIds() {
            return [
                this.clientId,
            ];
        },
        isConnected() {
            return connected;
        },
        isHost() {
            return host;
        },
        sendMessage() {},
        sendToOnlyOneClient() {},
    };
}

function readConnectionInfo(controller: Readonly<MinimalP2pController>) {
    return {
        allClientIds: controller.getAllClientIds(),
        clientId: controller.clientId,
        connectedClientIds: controller.getConnectedClientIds(),
        currentConnection: controller.currentConnection,
        getClientId: controller.getClientId(),
        isConnected: controller.isConnected(),
        isHost: controller.isHost(),
    };
}

describe(P2pMultiplayerController.name, () => {
    it('reports connection info when disconnected, singleplayer, and in a room', () => {
        const controller = new MinimalP2pController({
            gameId: 'test-game',
        });
        const localClientId = controller.localClientIdForTest;

        assert.deepEquals(
            {
                ...readConnectionInfo(controller),
                apiConnectionState: controller.apiConnectionState,
                debugMultiplayer: controller.debugMultiplayer,
                multiplayerApiClient: controller.multiplayerApiClient,
                roomConnectionState: controller.roomConnectionState,
                roomId: controller.roomId,
            },
            {
                allClientIds: [],
                clientId: localClientId,
                connectedClientIds: [],
                currentConnection: undefined,
                getClientId: undefined,
                isConnected: false,
                isHost: false,
                apiConnectionState: MultiplayerConnectionState.Disconnected,
                debugMultiplayer: false,
                multiplayerApiClient: undefined,
                roomConnectionState: MultiplayerConnectionState.Disconnected,
                roomId: undefined,
            },
        );

        controller.setSingleplayerForTest(true);
        assert.deepEquals(readConnectionInfo(controller), {
            allClientIds: [
                localClientId,
            ],
            clientId: localClientId,
            connectedClientIds: [],
            currentConnection: controller,
            getClientId: localClientId,
            isConnected: true,
            isHost: true,
        });

        controller.leaveRoom();
        assert.isFalse(controller.isConnected());

        const memberConnection = createFakeConnection({
            connected: true,
            host: false,
        });
        controller.setRoomConnectionForTest(memberConnection);
        assert.deepEquals(readConnectionInfo(controller), {
            allClientIds: [
                memberConnection.clientId,
            ],
            clientId: memberConnection.clientId,
            connectedClientIds: [
                memberConnection.clientId,
            ],
            currentConnection: controller,
            getClientId: memberConnection.clientId,
            isConnected: true,
            isHost: false,
        });

        controller.setRoomConnectionForTest(
            createFakeConnection({
                connected: false,
                host: false,
            }),
        );
        assert.isFalse(controller.isConnected());
        controller.leaveRoom();

        controller.destroy();
        assert.isUndefined(controller.getClientId());
    });

    it('wires room controller callbacks and forwards room controller events', async () => {
        const controller = new HookedP2pController({
            gameId: 'test-game',
            debugMultiplayer: true,
        });
        const minimalController = new MinimalP2pController({
            gameId: 'test-game',
        });
        const forwardedEvents: string[] = [];
        const clientId = createMultiplayerId.client();
        const rejectedClientId = createMultiplayerId.client();
        const connection = createFakeConnection({
            connected: true,
            host: true,
        });

        controller.acceptedClientId = clientId;

        controller.listen(MultiplayerControllerRoomListEvent, (event) => {
            forwardedEvents.push(event.type);
        });
        controller.listen(MultiplayerControllerConnectionEvent, (event) => {
            forwardedEvents.push(event.type);
        });
        controller.listen(MultiplayerControllerClientStatusEvent, (event) => {
            forwardedEvents.push(event.type);
        });

        await controller.roomController['params'].prepareConnection?.(connection);
        await minimalController.roomController['params'].prepareConnection?.(connection);

        controller.roomController.dispatch(
            new MultiplayerControllerRoomListEvent({
                detail: {},
            }),
        );
        controller.roomController.dispatch(
            new MultiplayerControllerConnectionEvent({
                detail: {
                    api: MultiplayerConnectionState.Connected,
                    room: MultiplayerConnectionState.Disconnected,
                },
            }),
        );
        controller.roomController.dispatch(
            new MultiplayerControllerClientStatusEvent({
                detail: {
                    newMember: clientId,
                },
            }),
        );
        minimalController.roomController.dispatch(
            new MultiplayerControllerClientStatusEvent({
                detail: {
                    lostMember: clientId,
                },
            }),
        );
        controller.roomController.dispatch(
            new MultiplayerControllerMessageEvent<TestMessage>(clientId, {
                value: 'hello',
            }),
        );

        assert.deepEquals(
            {
                accepted: [
                    await controller.roomController['params'].acceptConnection?.(
                        clientId,
                        controller.roomController,
                    ),
                    await controller.roomController['params'].acceptConnection?.(
                        rejectedClientId,
                        controller.roomController,
                    ),
                ],
                clientStatuses: controller.clientStatuses,
                forwardedEvents,
                preparedConnections: controller.preparedConnections,
                receivedMessages: controller.receivedMessages,
            },
            {
                accepted: [
                    true,
                    false,
                ],
                clientStatuses: [
                    {
                        newMember: clientId,
                    },
                ],
                forwardedEvents: [
                    MultiplayerControllerRoomListEvent.type,
                    MultiplayerControllerConnectionEvent.type,
                    MultiplayerControllerClientStatusEvent.type,
                ],
                preparedConnections: [
                    connection,
                ],
                receivedMessages: [
                    {
                        sourceClientId: clientId,
                        message: {
                            value: 'hello',
                        },
                    },
                ],
            },
        );

        controller.destroy();
        minimalController.destroy();
    });

    it('initializes multiplayer and toggles room updates', async () => {
        const controller = new MinimalP2pController({
            gameId: 'test-game',
        });

        await controller.initMultiplayer({
            backendOrigin: 'http://mock.example',
            multiplayerApiClient: createMockRoomHandlerServerApiClient(),
        });

        assert.isUndefined(controller.startRoomUpdates());
        const removeListener = controller.startRoomUpdates(() => {});
        assert.isFunction(removeListener);
        removeListener();
        controller.stopRoomUpdates();

        assert.strictEquals(controller.apiConnectionState, MultiplayerConnectionState.Connected);
        controller.destroy();
    });
});
