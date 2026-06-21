import {defineAnthaMod} from '@antha/engine';
import {
    type ApiAndRoomConnectionState,
    ControllerConnectionEvent,
    emptyApiAndRoomConnectionState,
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

/**
 * Engine state added by the p2p-lock-step multiplayer mod.
 *
 * @category Internal
 */
export type AnthaMultiplayerP2pLockStepState<MultiplayerPacket extends JsonCompatibleValue = any> =
    {
        /** Enables verbose multiplayer debug logs. */
        debugMultiplayer?: boolean | undefined;
        /** P2p-lock-step controller state. */
        multiplayerP2pLockStep: {
            /** Controller used to drive singleplayer or multiplayer frame sync. */
            multiplayerController: P2pLockStepMultiplayerController<MultiplayerPacket>;
            /** Current backend API and room connection state. */
            connectionState: ApiAndRoomConnectionState;
        };
    };

/**
 * Options for {@link createAnthaMultiplayerP2pLockStepMod}.
 *
 * @category Internal
 */
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

/**
 * Create the engine mod that owns p2p-lock-step multiplayer state.
 *
 * @category Main
 */
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
            }
        },
        cleanup({state}) {
            log.if(!!state.debugMultiplayer).faint('[multiplayer] cleaning up p2p-lock-step mod');
            state.multiplayerP2pLockStep?.multiplayerController.destroy();
        },
    });
}
