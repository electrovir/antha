import {type MultiplayerApiClient, type RoomInput} from '@antha/multiplayer-core';
import {
    type FrameEventDetail,
    P2pLockStepMultiplayerController,
} from '@antha/multiplayer-p2p-lock-step';

export type DemoCounterInput = {
    increment: number;
    state?: number | undefined;
};

export type DemoCounterController = P2pLockStepMultiplayerController<DemoCounterInput>;

export function applyDemoCounterFrame({
    actions,
    state,
}: Readonly<{
    actions: ReadonlyArray<FrameEventDetail<DemoCounterInput>>;
    state: number;
}>) {
    return actions.reduce((currentCount, {packet}) => {
        return packet.state ?? currentCount + packet.increment;
    }, state);
}

export function syncDemoCounterState({
    controller,
    count,
}: Readonly<{
    controller: DemoCounterController;
    count: number;
}>) {
    controller.act({
        increment: 0,
        state: count,
    });
}

export function createDemoCounterController({
    gameId,
}: Readonly<{
    gameId: string;
}>) {
    return new P2pLockStepMultiplayerController<DemoCounterInput>({
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
