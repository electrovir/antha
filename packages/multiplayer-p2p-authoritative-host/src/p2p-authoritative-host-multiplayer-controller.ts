import {
    type ClientId,
    createMultiplayerId,
    emptyApiAndRoomConnectionState,
    MultiplayerConnectionState,
    type MultiplayerConnectionTimeoutOptions,
    MultiplayerControllerConnectionEvent,
    type MultiplayerRoomConnection,
    P2pMultiplayerController,
    type P2pMultiplayerControllerParams,
    type P2pMultiplayerControllerRoomEvents,
    type RoomInput,
    type SocketMessageId,
} from '@antha/multiplayer-core';
import {assertWrap, waitUntil} from '@augment-vir/assert';
import {type JsonCompatibleValue, type PartialWithUndefined} from '@augment-vir/common';
import {defineTypedCustomEvent, type TypedCustomEventInit} from 'typed-event-target';

/**
 * Message type for {@link P2pAuthoritativeHostMessage}.
 *
 * @category Internal
 */
export enum P2pAuthoritativeHostMessageType {
    Input = 'input',
    StateRequest = 'state-request',
    StateSnapshot = 'state-snapshot',
}

/**
 * A state snapshot emitted when the authoritative state changes.
 *
 * @category Internal
 */
export type P2pAuthoritativeHostStateSnapshot<MultiplayerGameState extends JsonCompatibleValue> = {
    sequence: number;
    state: MultiplayerGameState;
} & PartialWithUndefined<{
    /** Identifies the state request that this snapshot fulfills. */
    stateSyncId: SocketMessageId;
}>;

/**
 * Data received from {@link MultiplayerControllerStateEvent}.
 *
 * @category Internal
 */
export type StateEventDetail<
    Input extends JsonCompatibleValue,
    MultiplayerGameState extends JsonCompatibleValue,
> = P2pAuthoritativeHostStateSnapshot<MultiplayerGameState> &
    PartialWithUndefined<{
        clientId: ClientId;
        input: Input;
    }>;

/**
 * Messages exchanged by the authoritative-host state strategy.
 *
 * @category Internal
 */
export type P2pAuthoritativeHostMessage<
    Input extends JsonCompatibleValue,
    MultiplayerGameState extends JsonCompatibleValue,
> =
    | {
          type: P2pAuthoritativeHostMessageType.Input;
          input: Input;
      }
    | {
          type: P2pAuthoritativeHostMessageType.StateRequest;
          stateSyncId: SocketMessageId;
      }
    | ({
          type: P2pAuthoritativeHostMessageType.StateSnapshot;
      } & StateEventDetail<Input, MultiplayerGameState>);

/**
 * Game-specific logic for an authoritative-host connection.
 *
 * @category Internal
 */
export type P2pAuthoritativeHostGameDefinition<
    Input extends JsonCompatibleValue,
    MultiplayerGameState extends JsonCompatibleValue,
> = {
    /** Create the initial game state before singleplayer or multiplayer starts. */
    createInitialState: () => MultiplayerGameState;
    /** Apply an accepted input to the current authoritative state. */
    applyInput: (
        params: Readonly<{
            clientId: ClientId;
            input: Readonly<Input>;
            state: Readonly<MultiplayerGameState>;
        }>,
    ) => MultiplayerGameState;
    /** Return `false` to reject an input before it changes authoritative state. */
    shouldAcceptInput?: (
        params: Readonly<{
            clientId: ClientId;
            input: Readonly<Input>;
            state: Readonly<MultiplayerGameState>;
        }>,
    ) => boolean | undefined;
    /** Advance authoritative state from elapsed time without a player input. */
    tick?: (
        params: Readonly<{
            elapsedMs: number;
            state: Readonly<MultiplayerGameState>;
        }>,
    ) => MultiplayerGameState;
};

/**
 * Constructor parameters for {@link P2pAuthoritativeHostMultiplayerController}.
 *
 * @category Internal
 */
export type P2pAuthoritativeHostMultiplayerControllerParams<
    Input extends JsonCompatibleValue,
    MultiplayerGameState extends JsonCompatibleValue,
> = P2pMultiplayerControllerParams<
    P2pAuthoritativeHostMultiplayerController<Input, MultiplayerGameState>
> &
    P2pAuthoritativeHostGameDefinition<Input, MultiplayerGameState>;

/**
 * This is fired whenever the local authoritative-host state view updates.
 *
 * @category Events
 */
export class MultiplayerControllerStateEvent<
    MultiplayerGameState extends JsonCompatibleValue,
    Input extends JsonCompatibleValue = any,
> extends defineTypedCustomEvent<any>()('multiplayer-controller-state') {
    public declare detail: Readonly<StateEventDetail<Input, MultiplayerGameState>>;

    constructor(
        eventInitDict: TypedCustomEventInit<
            Readonly<StateEventDetail<Input, MultiplayerGameState>>
        >,
    ) {
        super(eventInitDict);
    }
}

/**
 * All events emitted by this controller.
 *
 * @category Internal
 */
export type AllP2pAuthoritativeHostMultiplayerControllerEvents<
    Input extends JsonCompatibleValue,
    MultiplayerGameState extends JsonCompatibleValue,
> =
    | MultiplayerControllerStateEvent<MultiplayerGameState, Input>
    | P2pMultiplayerControllerRoomEvents;

/**
 * An all-in-one controller for singleplayer or p2p-authoritative-host multiplayer game state.
 *
 * @category Main
 */
export class P2pAuthoritativeHostMultiplayerController<
    Input extends JsonCompatibleValue = any,
    MultiplayerGameState extends JsonCompatibleValue = any,
> extends P2pMultiplayerController<
    P2pAuthoritativeHostMessage<Input, MultiplayerGameState>,
    AllP2pAuthoritativeHostMultiplayerControllerEvents<Input, MultiplayerGameState>
> {
    /** All events emitted by this controller. */
    public static readonly events = {
        MultiplayerControllerStateEvent,
    };
    /** All events emitted by this controller. */
    public readonly events = P2pAuthoritativeHostMultiplayerController.events;

    protected currentState: MultiplayerGameState;
    protected currentSequence = 0;
    protected pendingStateSyncId: SocketMessageId | undefined;

    constructor(
        protected readonly params: P2pAuthoritativeHostMultiplayerControllerParams<
            Input,
            MultiplayerGameState
        >,
    ) {
        super(params);
        this.currentState = params.createInitialState();
    }

    protected override shouldAcceptConnection(connectingClientId: ClientId) {
        return this.params.acceptConnection?.(connectingClientId, this) ?? true;
    }

    /** Get the latest local state view. */
    public getState(): MultiplayerGameState {
        return this.currentState;
    }

    /** Start local play without contacting the multiplayer API. This can later open into a room. */
    public startSingleplayer() {
        if (this.currentConnection) {
            throw new Error('Cannot start singleplayer with a connection already present.');
        }

        this.singleplayer = true;
        this.dispatchState(this.createStateEventDetail());
        this.dispatch(
            new MultiplayerControllerConnectionEvent({
                detail: {
                    ...emptyApiAndRoomConnectionState,
                    api: MultiplayerConnectionState.Connected,
                },
            }),
        );
    }

    /** Send or apply a local input. */
    public act(input: Readonly<Input>) {
        if (!this.currentConnection || !this.currentConnection.isConnected()) {
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

    /** Advance authoritative time-based state. Only the host advances canonical state. */
    public tick(elapsedMs = 0) {
        if (!this.isHost() || !this.params.tick) {
            return;
        }

        this.updateState(
            this.params.tick({
                elapsedMs,
                state: this.currentState,
            }),
        );
    }

    /** Join or create a room. */
    public async joinOrCreateRoom(
        room: Readonly<RoomInput>,
        timeoutOptions: Readonly<MultiplayerConnectionTimeoutOptions> = {},
    ) {
        const roomConnection = await this.joinRoom(room, timeoutOptions);
        this.attachMultiplayerRoomConnection(roomConnection);
    }

    /** Join through the core room controller after its candidate connection is state-synchronized. */
    protected async joinRoom(
        room: Readonly<RoomInput>,
        timeoutOptions: Readonly<MultiplayerConnectionTimeoutOptions>,
    ) {
        await this.roomController.joinOrCreateRoom(room, timeoutOptions);
        if (!this.roomController.currentConnection) {
            throw new Error(
                'Cannot start p2p-authoritative-host multiplayer: room connection is missing.',
            );
        }

        return this.roomController.currentConnection;
    }

    /** Attach an established room transport and publish the current state view. */
    protected attachMultiplayerRoomConnection(
        roomConnection: Readonly<
            MultiplayerRoomConnection<P2pAuthoritativeHostMessage<Input, MultiplayerGameState>>
        >,
    ) {
        this.roomConnection = roomConnection;
        this.dispatchState(this.createStateEventDetail());

        if (this.isHost()) {
            this.sendStateSnapshot(this.createStateEventDetail());
        }
    }

    /** Apply received inputs on the host or received state snapshots on member clients. */
    protected override handleReceivedMessage(
        sourceClientId: ClientId,
        message: Readonly<P2pAuthoritativeHostMessage<Input, MultiplayerGameState>>,
    ) {
        if (!this.roomConnection) {
            return;
        }

        const messageHandlers: Record<P2pAuthoritativeHostMessageType, () => void> = {
            [P2pAuthoritativeHostMessageType.Input]: () => {
                if (this.isHost() && 'input' in message) {
                    this.applyInput({
                        clientId: sourceClientId,
                        input: assertWrap.isDefined(message.input),
                    });
                }
            },
            [P2pAuthoritativeHostMessageType.StateRequest]: () => {
                if (this.isHost() && 'stateSyncId' in message) {
                    this.roomConnection?.sendToOnlyOneClient(
                        sourceClientId,
                        this.createStateSnapshotMessage(
                            this.createStateEventDetail(),
                            assertWrap.isDefined(message.stateSyncId),
                        ),
                    );
                }
            },
            [P2pAuthoritativeHostMessageType.StateSnapshot]: () => {
                if (!this.isHost() && 'state' in message) {
                    const fulfillsPendingSync =
                        this.pendingStateSyncId != undefined &&
                        message.stateSyncId === this.pendingStateSyncId;

                    if (fulfillsPendingSync || message.sequence >= this.currentSequence) {
                        this.currentSequence = message.sequence;
                        this.currentState = message.state;
                        this.dispatchState(message);

                        if (fulfillsPendingSync) {
                            this.pendingStateSyncId = undefined;
                        }
                    }
                }
            },
        };

        messageHandlers[message.type]();
    }

    /** Attach and synchronize a candidate room before the core controller commits to it. */
    protected override async prepareRoomConnection(
        roomConnection: Readonly<
            MultiplayerRoomConnection<P2pAuthoritativeHostMessage<Input, MultiplayerGameState>>
        >,
    ) {
        const previousRoomConnection = this.roomConnection;
        const previousState = this.currentState;
        const previousSequence = this.currentSequence;
        const wasSingleplayer = this.singleplayer;

        this.roomConnection = roomConnection;
        this.singleplayer = false;

        try {
            if (!roomConnection.isHost()) {
                const stateSyncId = createMultiplayerId.socketMessage();
                this.pendingStateSyncId = stateSyncId;
                roomConnection.sendMessage({
                    type: P2pAuthoritativeHostMessageType.StateRequest,
                    stateSyncId,
                });
                await waitUntil.isTrue(() => this.pendingStateSyncId !== stateSyncId);
            }
        } catch (error) {
            this.pendingStateSyncId = undefined;
            this.roomConnection = previousRoomConnection;
            this.currentState = previousState;
            this.currentSequence = previousSequence;
            this.singleplayer = wasSingleplayer;
            throw error;
        }
    }

    /** Validate and apply an input against the current authoritative state. */
    protected applyInput({
        clientId,
        input,
    }: Readonly<{
        clientId: ClientId;
        input: Readonly<Input>;
    }>) {
        const shouldAcceptInput =
            this.params.shouldAcceptInput?.({
                clientId,
                input,
                state: this.currentState,
            }) ?? true;

        if (shouldAcceptInput) {
            this.updateStateFromInput({
                clientId,
                input,
                state: this.params.applyInput({
                    clientId,
                    input,
                    state: this.currentState,
                }),
            });
        }
    }

    /** Publish a new authoritative state that was not caused by a player input. */
    protected updateState(state: MultiplayerGameState) {
        this.currentState = state;
        this.currentSequence++;
        const detail = this.createStateEventDetail();
        this.dispatchState(detail);
        this.sendStateSnapshot(detail);
    }

    /** Publish a new authoritative state caused by a player input. */
    protected updateStateFromInput({
        clientId,
        input,
        state,
    }: Readonly<{
        clientId: ClientId;
        input: Readonly<Input>;
        state: MultiplayerGameState;
    }>) {
        this.currentState = state;
        this.currentSequence++;
        const detail = this.createStateEventDetail({
            clientId,
            input,
        });
        this.dispatchState(detail);
        this.sendStateSnapshot(detail);
    }

    /** Dispatch the typed state event to local listeners. */
    protected dispatchState(detail: Readonly<StateEventDetail<Input, MultiplayerGameState>>) {
        this.dispatch(
            new MultiplayerControllerStateEvent<MultiplayerGameState, Input>({
                detail,
            }),
        );
    }

    /** Broadcast a state snapshot when the local client is the host. */
    protected sendStateSnapshot(detail: Readonly<StateEventDetail<Input, MultiplayerGameState>>) {
        if (this.roomConnection && this.isHost()) {
            this.roomConnection.sendMessage(this.createStateSnapshotMessage(detail));
        }
    }

    /** Create a network message from state event detail. */
    protected createStateSnapshotMessage(
        detail: Readonly<StateEventDetail<Input, MultiplayerGameState>>,
        stateSyncId?: SocketMessageId | undefined,
    ): P2pAuthoritativeHostMessage<Input, MultiplayerGameState> {
        return {
            ...detail,
            type: P2pAuthoritativeHostMessageType.StateSnapshot,
            ...(stateSyncId && {
                stateSyncId,
            }),
        };
    }

    /** Create the local state event detail for the current sequence and state. */
    protected createStateEventDetail(
        source: Readonly<
            PartialWithUndefined<{
                clientId: ClientId;
                input: Readonly<Input>;
            }>
        > = {},
    ): StateEventDetail<Input, MultiplayerGameState> {
        return {
            ...source,
            sequence: this.currentSequence,
            state: this.currentState,
        };
    }
}
