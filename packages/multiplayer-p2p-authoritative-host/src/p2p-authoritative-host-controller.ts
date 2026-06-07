import {
    type ClientId,
    createMultiplayerId,
    type MultiplayerRoomConnection,
} from '@antha/multiplayer-core';
import {type JsonCompatibleValue} from '@augment-vir/common';
import {defineTypedCustomEvent, ListenTarget} from 'typed-event-target';

/**
 * Message type for {@link P2pAuthoritativeHostMessage}.
 *
 * @category Internal
 */
export enum P2pAuthoritativeHostMessageType {
    Input = 'input',
    StateSnapshot = 'state-snapshot',
}

/**
 * Messages exchanged by the authoritative-host state strategy.
 *
 * @category Internal
 */
export type P2pAuthoritativeHostMessage<
    Input extends JsonCompatibleValue,
    State extends JsonCompatibleValue,
> =
    | {
          type: P2pAuthoritativeHostMessageType.Input;
          input: Input;
      }
    | {
          type: P2pAuthoritativeHostMessageType.StateSnapshot;
          sequence: number;
          state: State;
      };

/**
 * A state snapshot emitted when the authoritative state changes.
 *
 * @category Internal
 */
export type P2pAuthoritativeHostStateSnapshot<State extends JsonCompatibleValue> = {
    sequence: number;
    state: State;
};

/**
 * Game-specific logic for an authoritative-host connection.
 *
 * @category Internal
 */
export type P2pAuthoritativeHostGameDefinition<
    Input extends JsonCompatibleValue,
    State extends JsonCompatibleValue,
> = {
    createInitialState: () => State;
    applyInput: (
        params: Readonly<{
            clientId: ClientId;
            input: Readonly<Input>;
            state: Readonly<State>;
        }>,
    ) => State;
    shouldAcceptInput?: (
        params: Readonly<{
            clientId: ClientId;
            input: Readonly<Input>;
            state: Readonly<State>;
        }>,
    ) => boolean | undefined;
    tick?: (
        params: Readonly<{
            elapsedMs: number;
            state: Readonly<State>;
        }>,
    ) => State;
};

/**
 * Emitted whenever the local canonical state view changes.
 *
 * @category Events
 */
export class P2pAuthoritativeHostStateEvent<
    State extends JsonCompatibleValue,
> extends defineTypedCustomEvent<any>()('p2p-authoritative-host-state') {
    public declare detail: Readonly<P2pAuthoritativeHostStateSnapshot<State>>;
}

/**
 * P2P authoritative-host state synchronization. The host owns canonical state, while members send
 * inputs and receive full state snapshots.
 *
 * @category Internal
 */
export class P2pAuthoritativeHostController<
    Input extends JsonCompatibleValue = any,
    State extends JsonCompatibleValue = any,
> extends ListenTarget<P2pAuthoritativeHostStateEvent<State>> {
    private readonly localClientId = createMultiplayerId.client();
    private roomConnection:
        | MultiplayerRoomConnection<P2pAuthoritativeHostMessage<Input, State>>
        | undefined;
    private currentState: State;
    private currentSequence = 0;
    private singleplayer = false;

    constructor(
        private readonly gameDefinition: Readonly<P2pAuthoritativeHostGameDefinition<Input, State>>,
        initialState: State,
    ) {
        super();
        this.currentState = initialState;
    }

    /** The current client id. */
    public get clientId(): ClientId {
        return this.roomConnection?.clientId || this.localClientId;
    }

    /** Get the latest local state view. */
    public getState(): State {
        return this.currentState;
    }

    /** Get all connected client ids. */
    public getConnectedClientIds(): ClientId[] {
        return this.roomConnection?.getConnectedClientIds() || [];
    }

    /** Get all room client ids. */
    public getAllClientIds(): ClientId[] {
        if (this.singleplayer) {
            return [this.localClientId];
        }

        return this.roomConnection?.getAllClientIds() || [];
    }

    /** Checks if the current controller is the room host. */
    public isHost() {
        return this.singleplayer || this.roomConnection?.isHost();
    }

    /** Checks if the current controller is connected to the room. */
    public isConnected() {
        return this.singleplayer || this.roomConnection?.isConnected();
    }

    /** Send or apply a local input. */
    public act(input: Readonly<Input>) {
        if (!this.isConnected()) {
            throw new Error('Cannot perform input: not connected to a room.');
        }

        if (this.isHost()) {
            this.applyInput({
                clientId: this.clientId,
                input,
            });
        } else {
            this.roomConnection?.sendMessage({
                type: P2pAuthoritativeHostMessageType.Input,
                input,
            });
        }
    }

    /** Run one authoritative tick. Only the host advances canonical state. */
    public tick(elapsedMs = 0) {
        if (!this.isHost() || !this.gameDefinition.tick) {
            return;
        }

        this.updateState(
            this.gameDefinition.tick({
                elapsedMs,
                state: this.currentState,
            }),
        );
    }

    /** Cleanup everything. */
    public override destroy() {
        this.roomConnection = undefined;
        super.destroy();
    }

    /** Startup the controller in singleplayer mode. */
    public startSingleplayer() {
        this.singleplayer = true;
        this.dispatchState();
    }

    /** Attach an already-connected multiplayer room transport from multiplayer core. */
    public attachMultiplayerRoomConnection(
        roomConnection: Readonly<
            MultiplayerRoomConnection<P2pAuthoritativeHostMessage<Input, State>>
        >,
    ) {
        this.roomConnection = roomConnection;
        this.dispatchState();

        if (this.isHost()) {
            this.sendStateSnapshot();
        }
    }

    /** Notify a new room member of the latest authoritative state. */
    public syncNewMember(clientId: ClientId) {
        if (this.roomConnection && this.isHost()) {
            this.roomConnection.sendToOnlyOneClient(clientId, this.createStateSnapshotMessage());
        }
    }

    /** Process a room message received from multiplayer core. */
    public handleReceivedMessage(
        sourceClientId: ClientId,
        message: Readonly<P2pAuthoritativeHostMessage<Input, State>>,
    ) {
        if (!this.roomConnection) {
            return;
        }

        if (this.isHost() && message.type === P2pAuthoritativeHostMessageType.Input) {
            this.applyInput({
                clientId: sourceClientId,
                input: message.input,
            });
        } else if (
            !this.isHost() &&
            message.type === P2pAuthoritativeHostMessageType.StateSnapshot &&
            message.sequence >= this.currentSequence
        ) {
            this.currentSequence = message.sequence;
            this.currentState = message.state;
            this.dispatchState();
        }
    }

    private applyInput({
        clientId,
        input,
    }: Readonly<{
        clientId: ClientId;
        input: Readonly<Input>;
    }>) {
        const shouldAcceptInput =
            this.gameDefinition.shouldAcceptInput?.({
                clientId,
                input,
                state: this.currentState,
            }) ?? true;

        if (shouldAcceptInput) {
            this.updateState(
                this.gameDefinition.applyInput({
                    clientId,
                    input,
                    state: this.currentState,
                }),
            );
        }
    }

    private updateState(state: State) {
        this.currentState = state;
        this.currentSequence++;
        this.dispatchState();
        this.sendStateSnapshot();
    }

    private dispatchState() {
        this.dispatch(
            new P2pAuthoritativeHostStateEvent<State>({
                detail: {
                    sequence: this.currentSequence,
                    state: this.currentState,
                },
            }),
        );
    }

    private sendStateSnapshot() {
        if (this.roomConnection && this.isHost()) {
            this.roomConnection.sendMessage(this.createStateSnapshotMessage());
        }
    }

    private createStateSnapshotMessage(): P2pAuthoritativeHostMessage<Input, State> {
        return {
            type: P2pAuthoritativeHostMessageType.StateSnapshot,
            sequence: this.currentSequence,
            state: this.currentState,
        };
    }
}
