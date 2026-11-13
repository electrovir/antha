import {defineAnthaMod} from '@antha/engine';
import {
    type ApiAndRoomConnectionState,
    emptyApiAndRoomConnectionState,
    MultiplayerControllerConnectionEvent,
} from '@antha/multiplayer-core';
import {type JsonCompatibleValue, type PartialWithUndefined} from '@augment-vir/common';
import {
    P2pAuthoritativeClientMultiplayerController,
    type P2pAuthoritativeClientMultiplayerControllerParams,
} from './p2p-authoritative-client-multiplayer-controller.js';

/**
 * Engine state added by the p2p-authoritative-client multiplayer mod.
 *
 * @category Internal
 */
export type AnthaMultiplayerP2pAuthoritativeClientState<
    ClientState extends JsonCompatibleValue = any,
> = {
    /** P2p-authoritative-client controller state. */
    multiplayerP2pAuthoritativeClient: {
        /** Multiplayer controller that sends and receives each client's state. */
        multiplayerController: P2pAuthoritativeClientMultiplayerController<ClientState>;
        /** Current backend API and room connection state. */
        connectionState: ApiAndRoomConnectionState;
    };
};

/**
 * Options for {@link createAnthaMultiplayerP2pAuthoritativeClientMod}.
 *
 * @category Internal
 */
export type AnthaMultiplayerP2pAuthoritativeClientOptions<
    ClientState extends JsonCompatibleValue = any,
    State extends
        AnthaMultiplayerP2pAuthoritativeClientState<ClientState> = AnthaMultiplayerP2pAuthoritativeClientState<ClientState>,
> = PartialWithUndefined<
    Omit<P2pAuthoritativeClientMultiplayerControllerParams<ClientState>, 'createLocalState'>
> &
    PartialWithUndefined<{
        /**
         * Called on every send to get this client's own state from the engine state. Return
         * `undefined` to send nothing.
         *
         * @default nothing is sent
         */
        createLocalState: (
            params: Readonly<{
                state: Partial<State>;
            }>,
        ) => ClientState | undefined;
    }>;

/**
 * Create the engine mod that owns p2p-authoritative-client multiplayer state. The controller's
 * events, such as each received client state, are forwarded to the engine so other mods can trigger
 * on them.
 *
 * @category Main
 */
export function createAnthaMultiplayerP2pAuthoritativeClientMod<
    const ClientState extends JsonCompatibleValue = any,
    State extends
        AnthaMultiplayerP2pAuthoritativeClientState<ClientState> = AnthaMultiplayerP2pAuthoritativeClientState<ClientState>,
>(
    options: Readonly<
        AnthaMultiplayerP2pAuthoritativeClientOptions<ClientState, NoInfer<State>>
    > = {},
) {
    return defineAnthaMod<NoInfer<State>>({
        modName: 'antha-multiplayer-p2p-authoritative-client',
        cleanup({state}) {
            state.multiplayerP2pAuthoritativeClient?.multiplayerController.destroy();
        },
        execute({engine, state}) {
            if (state.multiplayerP2pAuthoritativeClient) {
                return;
            }

            const createLocalState = options.createLocalState;
            const multiplayerState: AnthaMultiplayerP2pAuthoritativeClientState<ClientState>['multiplayerP2pAuthoritativeClient'] =
                {
                    multiplayerController:
                        new P2pAuthoritativeClientMultiplayerController<ClientState>({
                            ...options,
                            gameId: options.gameId || 'antha',
                            createLocalState: createLocalState
                                ? () => {
                                      return createLocalState({
                                          state,
                                      });
                                  }
                                : undefined,
                        }),
                    connectionState: emptyApiAndRoomConnectionState,
                };

            state.multiplayerP2pAuthoritativeClient = multiplayerState;
            multiplayerState.multiplayerController.listen(
                MultiplayerControllerConnectionEvent,
                ({detail}) => {
                    multiplayerState.connectionState = detail;
                },
            );
            multiplayerState.multiplayerController.listenToAll((event) => {
                engine.dispatch(event);
            });
        },
    });
}
