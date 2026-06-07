import {
    type ClientId,
    createMultiplayerId,
    type MultiplayerRoomConnection,
} from '@antha/multiplayer-core';
import {assert} from '@augment-vir/assert';
import {type JsonCompatibleValue} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {
    P2pLockStepGameStateController,
    type P2pLockStepMessage,
    P2pLockStepMessageType,
} from './p2p-lock-step-controller.js';

type MockRoomConnection<Message extends JsonCompatibleValue> =
    MultiplayerRoomConnection<Message> & {
        sentMessages: Message[];
    };

function createMockRoomConnection<Message extends JsonCompatibleValue>({
    connectedClientIds,
    isHost,
}: Readonly<{
    connectedClientIds?: ReadonlyArray<ClientId> | undefined;
    isHost: boolean;
}>): MockRoomConnection<Message> {
    const clientId = createMultiplayerId.client();
    const sentMessages: Message[] = [];

    return {
        clientId,
        destroy() {},
        getAllClientIds() {
            return [
                clientId,
                ...(connectedClientIds || []),
            ];
        },
        getConnectedClientIds() {
            return [...(connectedClientIds || [])];
        },
        isConnected() {
            return true;
        },
        isHost() {
            return isHost;
        },
        sendMessage(message) {
            sentMessages.push(message);
        },
        sendToOnlyOneClient(targetClientId, message) {
            void targetClientId;
            sentMessages.push(message);
        },
        sentMessages,
    };
}

describe(P2pLockStepGameStateController.name, () => {
    it('sends an initial frame when attaching as the host', () => {
        const roomConnection = createMockRoomConnection<P2pLockStepMessage<string>>({
            connectedClientIds: [
                createMultiplayerId.client(),
            ],
            isHost: true,
        });
        const controller = new P2pLockStepGameStateController<string>(undefined);

        controller.act([
            'host-action',
        ]);
        controller.attachMultiplayerRoomConnection(roomConnection);

        assert.deepEquals(roomConnection.sentMessages, [
            {
                actions: [
                    'host-action',
                ],
                type: P2pLockStepMessageType.Frame,
            },
        ]);
    });

    it('sends initial readiness actions when attaching as a member', () => {
        const roomConnection = createMockRoomConnection<P2pLockStepMessage<string>>({
            connectedClientIds: [
                createMultiplayerId.client(),
            ],
            isHost: false,
        });
        const controller = new P2pLockStepGameStateController<string>(undefined);

        controller.attachMultiplayerRoomConnection(roomConnection);

        assert.deepEquals(roomConnection.sentMessages, [
            {
                actions: [],
                sourceClientId: roomConnection.clientId,
                type: P2pLockStepMessageType.Actions,
            },
        ]);
    });
});
