import {defineAnthaMod} from '@antha/engine';
import {
    type ApiAndRoomConnectionState,
    MultiplayerControllerConnectionEvent,
    emptyApiAndRoomConnectionState,
} from '@antha/multiplayer-core';
import {
    type JsonCompatibleValue,
    type PartialWithUndefined,
    type SelectFrom,
} from '@augment-vir/common';
import {
    MultiplayerControllerStateEvent,
    P2pAuthoritativeHostMultiplayerController,
    type P2pAuthoritativeHostMultiplayerControllerParams,
} from './p2p-authoritative-host-multiplayer-controller.js';

/**
 * Engine state added by the p2p-authoritative-host multiplayer mod.
 *
 * @category Internal
 */
export type AnthaMultiplayerP2pAuthoritativeHostState<
    Input extends JsonCompatibleValue = any,
    MultiplayerGameState extends JsonCompatibleValue = any,
> = {
    /** P2p-authoritative-host controller state. */
    multiplayerP2pAuthoritativeHost: {
        /** Multiplayer controller used to drive singleplayer or multiplayer state sync. */
        multiplayerController: P2pAuthoritativeHostMultiplayerController<
            Input,
            MultiplayerGameState
        >;
        /** Current backend API and room connection state. */
        connectionState: ApiAndRoomConnectionState;
        /** Latest state emitted by the multiplayer controller. */
        currentState: MultiplayerGameState;
    };
};

/**
 * Options for {@link createAnthaMultiplayerP2pAuthoritativeHostMod}.
 *
 * @category Internal
 */
export type AnthaMultiplayerP2pAuthoritativeHostOptions<
    Input extends JsonCompatibleValue = any,
    MultiplayerGameState extends JsonCompatibleValue = any,
> = SelectFrom<
    P2pAuthoritativeHostMultiplayerControllerParams<Input, MultiplayerGameState>,
    {
        applyInput: true;
        createInitialState: true;
    }
> &
    PartialWithUndefined<
        SelectFrom<
            P2pAuthoritativeHostMultiplayerControllerParams<Input, MultiplayerGameState>,
            {
                acceptConnection: true;
                gameId: true;
                shouldAcceptInput: true;
                tick: true;
            }
        >
    >;

/**
 * Create the engine mod that owns p2p-authoritative-host multiplayer state.
 *
 * @category Main
 */
export function createAnthaMultiplayerP2pAuthoritativeHostMod<
    const Input extends JsonCompatibleValue = any,
    const MultiplayerGameState extends JsonCompatibleValue = any,
>(options: Readonly<AnthaMultiplayerP2pAuthoritativeHostOptions<Input, MultiplayerGameState>>) {
    return defineAnthaMod<
        AnthaMultiplayerP2pAuthoritativeHostState<NoInfer<Input>, NoInfer<MultiplayerGameState>>
    >({
        modName: 'antha-multiplayer-p2p-authoritative-host',
        execute({state}) {
            if (!state.multiplayerP2pAuthoritativeHost) {
                state.multiplayerP2pAuthoritativeHost = createP2pAuthoritativeHostState(options);

                state.multiplayerP2pAuthoritativeHost.multiplayerController.listen(
                    MultiplayerControllerConnectionEvent,
                    ({detail: newConnectionState}) => {
                        if (!state.multiplayerP2pAuthoritativeHost) {
                            return;
                        }

                        state.multiplayerP2pAuthoritativeHost.connectionState = newConnectionState;
                    },
                );

                state.multiplayerP2pAuthoritativeHost.multiplayerController.listen(
                    MultiplayerControllerStateEvent<MultiplayerGameState, Input>,
                    ({detail}) => {
                        if (!state.multiplayerP2pAuthoritativeHost) {
                            return;
                        }

                        state.multiplayerP2pAuthoritativeHost.currentState = detail.state;
                    },
                );
            }
        },
        cleanup({state}) {
            state.multiplayerP2pAuthoritativeHost?.multiplayerController.destroy();
        },
    });
}

function createP2pAuthoritativeHostState<
    Input extends JsonCompatibleValue,
    MultiplayerGameState extends JsonCompatibleValue,
>(
    options: Readonly<AnthaMultiplayerP2pAuthoritativeHostOptions<Input, MultiplayerGameState>>,
): AnthaMultiplayerP2pAuthoritativeHostState<
    Input,
    MultiplayerGameState
>['multiplayerP2pAuthoritativeHost'] {
    const multiplayerController = new P2pAuthoritativeHostMultiplayerController<
        Input,
        MultiplayerGameState
    >({
        gameId: options.gameId || 'antha',
        applyInput: options.applyInput,
        createInitialState: options.createInitialState,
        ...(options.acceptConnection && {
            acceptConnection: options.acceptConnection,
        }),
        ...(options.shouldAcceptInput && {
            shouldAcceptInput: options.shouldAcceptInput,
        }),
        ...(options.tick && {
            tick: options.tick,
        }),
    });

    return {
        multiplayerController,
        connectionState: emptyApiAndRoomConnectionState,
        currentState: multiplayerController.getState(),
    };
}
