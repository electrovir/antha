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
    type PartialWithUndefined,
    type SelectFrom,
} from '@augment-vir/common';
import {
    ControllerStateEvent,
    P2pAuthoritativeHostMultiplayerController,
    type P2pAuthoritativeHostMultiplayerControllerParams,
} from './p2p-authoritative-host-multiplayer-controller.js';

export type AnthaMultiplayerP2pAuthoritativeHostState<
    Input extends JsonCompatibleValue = any,
    State extends JsonCompatibleValue = any,
> = {
    multiplayerP2pAuthoritativeHost: {
        multiplayerController: P2pAuthoritativeHostMultiplayerController<Input, State>;
        connectionState: ApiAndRoomConnectionState;
        availableRooms: MultiplayerClientRooms;
        currentState: State;
    };
};

export type AnthaMultiplayerP2pAuthoritativeHostOptions<
    Input extends JsonCompatibleValue = any,
    State extends JsonCompatibleValue = any,
> = SelectFrom<
    P2pAuthoritativeHostMultiplayerControllerParams<Input, State>,
    {
        applyInput: true;
        createInitialState: true;
    }
> &
    PartialWithUndefined<
        SelectFrom<
            P2pAuthoritativeHostMultiplayerControllerParams<Input, State>,
            {
                acceptConnection: true;
                gameId: true;
                shouldAcceptInput: true;
                tick: true;
            }
        >
    >;

export function createAnthaMultiplayerP2pAuthoritativeHostMod<
    const Input extends JsonCompatibleValue = any,
    const State extends JsonCompatibleValue = any,
>(options: Readonly<AnthaMultiplayerP2pAuthoritativeHostOptions<Input, State>>) {
    return defineAnthaMod<AnthaMultiplayerP2pAuthoritativeHostState<NoInfer<Input>, State>>({
        modName: 'antha-multiplayer-p2p-authoritative-host',
        execute({state}) {
            if (!state.multiplayerP2pAuthoritativeHost) {
                state.multiplayerP2pAuthoritativeHost = createP2pAuthoritativeHostState(options);

                state.multiplayerP2pAuthoritativeHost.multiplayerController.listen(
                    ControllerConnectionEvent,
                    ({detail: newConnectionState}) => {
                        if (!state.multiplayerP2pAuthoritativeHost) {
                            return;
                        }

                        state.multiplayerP2pAuthoritativeHost.connectionState = newConnectionState;
                    },
                );

                state.multiplayerP2pAuthoritativeHost.multiplayerController.listen(
                    ControllerRoomListEvent,
                    ({detail: rooms}) => {
                        if (!state.multiplayerP2pAuthoritativeHost) {
                            return;
                        }

                        state.multiplayerP2pAuthoritativeHost.availableRooms = rooms;
                    },
                );

                state.multiplayerP2pAuthoritativeHost.multiplayerController.listen(
                    ControllerStateEvent<State, Input>,
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
    State extends JsonCompatibleValue,
>(
    options: Readonly<AnthaMultiplayerP2pAuthoritativeHostOptions<Input, State>>,
): AnthaMultiplayerP2pAuthoritativeHostState<Input, State>['multiplayerP2pAuthoritativeHost'] {
    const multiplayerController = new P2pAuthoritativeHostMultiplayerController<Input, State>({
        gameId: options.gameId || 'antha',
        applyInput: options.applyInput,
        createInitialState: options.createInitialState,
        ...(options.acceptConnection
            ? {
                  acceptConnection: options.acceptConnection,
              }
            : {}),
        ...(options.shouldAcceptInput
            ? {
                  shouldAcceptInput: options.shouldAcceptInput,
              }
            : {}),
        ...(options.tick
            ? {
                  tick: options.tick,
              }
            : {}),
    });

    return {
        multiplayerController,
        connectionState: emptyApiAndRoomConnectionState,
        availableRooms: {},
        currentState: multiplayerController.getState(),
    };
}
