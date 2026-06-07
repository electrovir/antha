import {defineAnthaMod} from '@antha/engine';
import {
    type ApiAndRoomConnectionState,
    ControllerConnectionEvent,
    ControllerRoomListEvent,
    emptyApiAndRoomConnectionState,
    type MultiplayerClientRooms,
} from '@antha/multiplayer-core';
import {
    type JsonCompatibleValue,
    log,
    type PartialWithUndefined,
    type SelectFrom,
} from '@augment-vir/common';
import {
    P2pLockStepMultiplayerController,
    type P2pLockStepMultiplayerControllerParams,
} from './p2p-lock-step-multiplayer-controller.js';

export type AnthaMultiplayerP2pLockStepState<MultiplayerPacket extends JsonCompatibleValue = any> =
    {
        debugMultiplayer?: boolean | undefined;
        multiplayerP2pLockStep: {
            multiplayerController: P2pLockStepMultiplayerController<MultiplayerPacket>;
            connectionState: ApiAndRoomConnectionState;
            availableRooms: MultiplayerClientRooms;
        };
    };

export type AnthaMultiplayerP2pLockStepOptions<
    MultiplayerPacket extends JsonCompatibleValue = any,
> = PartialWithUndefined<
    SelectFrom<
        P2pLockStepMultiplayerControllerParams<MultiplayerPacket>,
        {
            acceptConnection: true;
            debugMultiplayer: true;
            gameId: true;
        }
    >
>;

export function createAnthaMultiplayerP2pLockStepMod<
    const MultiplayerPacket extends JsonCompatibleValue = any,
>(options: Readonly<AnthaMultiplayerP2pLockStepOptions<MultiplayerPacket>> = {}) {
    return defineAnthaMod<AnthaMultiplayerP2pLockStepState<NoInfer<MultiplayerPacket>>>({
        modName: 'antha-multiplayer-p2p-lock-step',
        execute({state}) {
            if (options.debugMultiplayer == undefined) {
                state.debugMultiplayer = options.debugMultiplayer;
            }

            if (!state.multiplayerP2pLockStep) {
                log.if(!!state.debugMultiplayer).faint(
                    '[multiplayer] creating p2p-lock-step mod state',
                );

                state.multiplayerP2pLockStep = {
                    multiplayerController: new P2pLockStepMultiplayerController<MultiplayerPacket>({
                        gameId: options.gameId || 'antha',
                        acceptConnection: options.acceptConnection,
                        debugMultiplayer: state.debugMultiplayer,
                        frameDuration: undefined,
                    }),
                    connectionState: emptyApiAndRoomConnectionState,
                    availableRooms: {},
                };

                state.multiplayerP2pLockStep.multiplayerController.listen(
                    ControllerConnectionEvent,
                    ({detail: newConnectionState}) => {
                        if (!state.multiplayerP2pLockStep) {
                            return;
                        }

                        log.if(!!state.debugMultiplayer).faint(
                            `[multiplayer] mod connection state updated: api=${String(newConnectionState.api)} room=${String(newConnectionState.room)}`,
                        );

                        state.multiplayerP2pLockStep.connectionState = newConnectionState;
                    },
                );

                state.multiplayerP2pLockStep.multiplayerController.listen(
                    ControllerRoomListEvent,
                    ({detail: rooms}) => {
                        if (!state.multiplayerP2pLockStep) {
                            return;
                        }

                        state.multiplayerP2pLockStep.availableRooms = rooms;
                    },
                );
            }
        },
        cleanup({state}) {
            log.if(!!state.debugMultiplayer).faint('[multiplayer] cleaning up p2p-lock-step mod');
            state.multiplayerP2pLockStep?.multiplayerController.destroy();
        },
    });
}
