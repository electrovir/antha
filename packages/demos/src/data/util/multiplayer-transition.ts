import {type MultiplayerApiClient, type RoomInput} from '@antha/multiplayer-core';
import {
    MultiplayerControllerFrameEvent,
    MultiplayerControllerStateSyncEvent,
    type MultiplayerFramePacket,
    P2pLockStepMultiplayerController,
} from '@antha/multiplayer-p2p-lock-step';
import {assertWrap} from '@augment-vir/assert';

export type DemoCounterInput = {
    increment: number;
};

export type DemoCounterController = P2pLockStepMultiplayerController<DemoCounterInput>;

export function applyDemoCounterFrame({
    actions,
    state,
}: Readonly<{
    actions: ReadonlyArray<MultiplayerFramePacket<DemoCounterInput>>;
    state: number;
}>) {
    return actions.reduce((currentCount, {packet}) => {
        return currentCount + packet.increment;
    }, state);
}

/**
 * Applies each frame to the count, sends the count to joining clients when hosting, and loads the
 * host's count after joining a room. Returns a callback that removes the listeners.
 */
export function listenToDemoCounter({
    controller,
    getCount,
    setCount,
}: Readonly<{
    controller: DemoCounterController;
    getCount: () => number;
    setCount: (count: number) => void;
}>) {
    const removeFrameListener = controller.listen(
        MultiplayerControllerFrameEvent<DemoCounterInput>,
        ({detail}) => {
            if (controller.awaitingStateSync) {
                return;
            }

            const count = applyDemoCounterFrame({
                actions: detail.packets,
                state: getCount(),
            });
            setCount(count);

            if (detail.shouldSendStateSync) {
                controller.sendStateSync(count);
            }
        },
    );
    const removeStateSyncListener = controller.listen(
        MultiplayerControllerStateSyncEvent,
        ({detail}) => {
            setCount(assertWrap.isNumber(detail.stateSync));
            controller.finishStateSync();
        },
    );

    return () => {
        removeFrameListener();
        removeStateSyncListener();
    };
}

export function createDemoCounterController({
    gameId,
}: Readonly<{
    gameId: string;
}>) {
    return new P2pLockStepMultiplayerController<DemoCounterInput>({
        enableStateSync: true,
        gameId,
    });
}

export async function initializeDemoMultiplayer({
    apiClient,
    controller,
}: Readonly<{
    apiClient: Readonly<MultiplayerApiClient>;
    controller: DemoCounterController;
}>) {
    await controller.initMultiplayer({
        backendOrigin: apiClient.baseUrl,
        multiplayerApiClient: apiClient,
    });
}

export async function connectDemoCounterController({
    apiClient,
    controller,
    room,
}: Readonly<{
    apiClient: Readonly<MultiplayerApiClient>;
    controller: DemoCounterController;
    room: Readonly<RoomInput>;
}>) {
    await initializeDemoMultiplayer({
        apiClient,
        controller,
    });
    await controller.joinOrCreateRoom(room);
}
