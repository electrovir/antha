import {defineAnthaMod} from '@antha/engine';
import {
    ControllerConnectionEvent,
    ControllerRoomListEvent,
    type MultiplayerClientRooms,
    MultiplayerController,
    type MultiplayerControllerParams,
    type ServiceAndRoomConnectionState,
    emptyServiceAndRoomConnectionState,
} from '@antha/multiplayer-core';
import {
    type JsonCompatibleValue,
    type PartialWithUndefined,
    type SelectFrom,
} from '@augment-vir/common';

export type AnthaMultiplayerLockStepState<MultiplayerPacket extends JsonCompatibleValue = any> = {
    multiplayerLockStep: {
        multiplayerController: MultiplayerController<MultiplayerPacket>;
        connectionState: ServiceAndRoomConnectionState;
        availableRooms: MultiplayerClientRooms;
    };
};

export type AnthaMultiplayerLockStepOptions<MultiplayerPacket extends JsonCompatibleValue = any> =
    PartialWithUndefined<
        SelectFrom<
            MultiplayerControllerParams<MultiplayerPacket>,
            {
                acceptConnection: true;
                gameId: true;
            }
        >
    >;

export function createAnthaMultiplayerLockStepMod<
    const MultiplayerPacket extends JsonCompatibleValue = any,
>(options: Readonly<AnthaMultiplayerLockStepOptions<MultiplayerPacket>> = {}) {
    return defineAnthaMod<AnthaMultiplayerLockStepState<NoInfer<MultiplayerPacket>>>({
        modName: 'antha-multiplayer-lock-step',
        execute({state}) {
            if (!state.multiplayerLockStep) {
                state.multiplayerLockStep = {
                    multiplayerController: new MultiplayerController<MultiplayerPacket>({
                        gameId: options.gameId || 'antha',
                        acceptConnection: options.acceptConnection,
                        frameDuration: undefined,
                    }),
                    connectionState: emptyServiceAndRoomConnectionState,
                    availableRooms: {},
                };

                state.multiplayerLockStep.multiplayerController.listen(
                    ControllerConnectionEvent,
                    ({detail: newConnectionState}) => {
                        if (!state.multiplayerLockStep) {
                            return;
                        }

                        state.multiplayerLockStep.connectionState = newConnectionState;
                    },
                );

                state.multiplayerLockStep.multiplayerController.listen(
                    ControllerRoomListEvent,
                    ({detail: rooms}) => {
                        if (!state.multiplayerLockStep) {
                            return;
                        }

                        state.multiplayerLockStep.availableRooms = rooms;
                    },
                );
            }
        },
    });
}
