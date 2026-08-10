import {
    type ApiAndRoomConnectionState,
    type ClientId,
    ControllerClientEvent,
    ControllerConnectionEvent,
    ControllerMessageEvent,
    ControllerRoomListEvent,
    type ControllerRoomListListener,
    createMultiplayerId,
    emptyApiAndRoomConnectionState,
    MultiplayerConnectionState,
    type MultiplayerInitParams,
    type MultiplayerRoomConnection,
    MultiplayerRoomController,
    type RoomInput,
    RoomRejectionError,
    type SocketMessageId,
} from '@antha/multiplayer-core';
import {assertWrap, waitUntil} from '@augment-vir/assert';
import {
    type JsonCompatibleValue,
    type MaybePromise,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {
    defineTypedCustomEvent,
    ListenTarget,
    type RemoveListenerCallback,
    type TypedCustomEventInit,
} from 'typed-event-target';

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
export type P2pAuthoritativeHostStateSnapshot<State extends JsonCompatibleValue> = {
    sequence: number;
    state: State;
} & PartialWithUndefined<{
    /** Identifies the state request that this snapshot fulfills. */
    stateSyncId: SocketMessageId;
}>;

/**
 * Data received from {@link ControllerStateEvent}.
 *
 * @category Internal
 */
export type StateEventDetail<
    Input extends JsonCompatibleValue,
    State extends JsonCompatibleValue,
> = P2pAuthoritativeHostStateSnapshot<State> &
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
    State extends JsonCompatibleValue,
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
      } & StateEventDetail<Input, State>);

/**
 * Game-specific logic for an authoritative-host connection.
 *
 * @category Internal
 */
export type P2pAuthoritativeHostGameDefinition<
    Input extends JsonCompatibleValue,
    State extends JsonCompatibleValue,
> = {
    /** Create the initial game state before singleplayer or multiplayer starts. */
    createInitialState: () => State;
    /** Apply an accepted input to the current authoritative state. */
    applyInput: (
        params: Readonly<{
            clientId: ClientId;
            input: Readonly<Input>;
            state: Readonly<State>;
        }>,
    ) => State;
    /** Return `false` to reject an input before it changes authoritative state. */
    shouldAcceptInput?: (
        params: Readonly<{
            clientId: ClientId;
            input: Readonly<Input>;
            state: Readonly<State>;
        }>,
    ) => boolean | undefined;
    /** Advance authoritative state from elapsed time without a player input. */
    tick?: (
        params: Readonly<{
            elapsedMs: number;
            state: Readonly<State>;
        }>,
    ) => State;
};

/**
 * Constructor parameters for {@link P2pAuthoritativeHostMultiplayerController}.
 *
 * @category Internal
 */
export type P2pAuthoritativeHostMultiplayerControllerParams<
    Input extends JsonCompatibleValue,
    State extends JsonCompatibleValue,
> = {
    /**
     * A unique string id that represents your game so that your lobby server can serve multiple
     * games at once. Your lobby server will need to know this game id ahead of time and match it to
     * your frontend's origin.
     */
    gameId: string;
} & P2pAuthoritativeHostGameDefinition<Input, State> &
    PartialWithUndefined<{
        /**
         * This is fired when a WebRTC peer attempts to connect to the host client. Return `true` to
         * accept the connection. Return `false` to reject it.
         *
         * @default accept all connections
         */
        acceptConnection?:
            | ((
                  connectingClientId: ClientId,
                  controller: P2pAuthoritativeHostMultiplayerController<Input, State>,
              ) => MaybePromise<boolean>)
            | undefined;
    }>;

/**
 * This is fired whenever the local authoritative-host state view updates.
 *
 * @category Events
 */
export class ControllerStateEvent<
    State extends JsonCompatibleValue,
    Input extends JsonCompatibleValue = any,
> extends defineTypedCustomEvent<any>()('controller-state') {
    public declare detail: Readonly<StateEventDetail<Input, State>>;

    constructor(eventInitDict: TypedCustomEventInit<Readonly<StateEventDetail<Input, State>>>) {
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
    State extends JsonCompatibleValue,
> =
    | ControllerStateEvent<State, Input>
    | ControllerRoomListEvent
    | ControllerClientEvent
    | ControllerConnectionEvent;

/**
 * An all-in-one controller for singleplayer or p2p-authoritative-host multiplayer game state.
 *
 * @category Main
 */
export class P2pAuthoritativeHostMultiplayerController<
    Input extends JsonCompatibleValue = any,
    State extends JsonCompatibleValue = any,
> extends ListenTarget<AllP2pAuthoritativeHostMultiplayerControllerEvents<Input, State>> {
    /** All events emitted by this controller. */
    public static readonly events = {
        ControllerStateEvent,
    };
    /** All events emitted by this controller. */
    public readonly events = P2pAuthoritativeHostMultiplayerController.events;

    public static readonly knownErrors = {
        RoomRejectionError,
    };
    public readonly knownErrors = P2pAuthoritativeHostMultiplayerController.knownErrors;

    /** Core multiplayer room controller that owns API, room polling, signaling, and transport. */
    public readonly roomController: MultiplayerRoomController<
        P2pAuthoritativeHostMessage<Input, State>
    >;
    protected readonly localClientId = createMultiplayerId.client();
    protected roomConnection:
        | MultiplayerRoomConnection<P2pAuthoritativeHostMessage<Input, State>>
        | undefined;
    protected currentState: State;
    protected currentSequence = 0;
    protected pendingStateSyncId: SocketMessageId | undefined;
    protected singleplayer = false;

    constructor(
        protected readonly params: P2pAuthoritativeHostMultiplayerControllerParams<Input, State>,
    ) {
        super();
        this.currentState = params.createInitialState();
        this.roomController = new MultiplayerRoomController<
            P2pAuthoritativeHostMessage<Input, State>
        >({
            gameId: params.gameId,
            clientId: this.localClientId,
            prepareConnection: async (connection) => {
                await this.prepareRoomConnection(connection);
            },
            acceptConnection: params.acceptConnection
                ? (connectingClientId) => {
                      return params.acceptConnection?.(connectingClientId, this) ?? true;
                  }
                : undefined,
        });
        this.listenToRoomController();
    }

    /** Current p2p-authoritative-host connection, exposed for compatibility checks. */
    public get currentConnection(): this | undefined {
        return this.isConnected() ? this : undefined;
    }

    /** The current client id. */
    public get clientId(): ClientId {
        return this.roomConnection?.clientId || this.localClientId;
    }

    /**
     * Listen for room list updates, including while connected to a room.
     *
     * If a callback is provided, it is called each time the room list is updated.
     */
    public startRoomUpdates(callback: ControllerRoomListListener): RemoveListenerCallback;
    public startRoomUpdates(callback?: undefined): undefined;
    public startRoomUpdates(
        callback?: ControllerRoomListListener | undefined,
    ): RemoveListenerCallback | undefined;
    public startRoomUpdates(
        callback?: ControllerRoomListListener | undefined,
    ): RemoveListenerCallback | undefined {
        return this.roomController.startRoomUpdates(callback);
    }

    /** Turn off room list updates and remove callbacks added via `startRoomUpdates`. */
    public stopRoomUpdates() {
        this.roomController.stopRoomUpdates();
    }

    /** Currently joined room id. If a room has not been joined yet, this will be empty. */
    public get roomId() {
        return this.roomController.roomId;
    }

    /** The current connection state of the controller's connection to a backend API. */
    public get apiConnectionState(): ApiAndRoomConnectionState['api'] {
        return this.roomController.apiConnectionState;
    }

    /** The current connection state of the controller's connection to a multiplayer room. */
    public get roomConnectionState(): ApiAndRoomConnectionState['room'] {
        return this.roomController.roomConnectionState;
    }

    /** The current multiplayer API client. This will be `undefined` if playing in single player. */
    public get multiplayerApiClient() {
        return this.roomController.multiplayerApiClient;
    }

    /**
     * Get the current client's WebRTC client id. This will return `undefined` if there is no
     * current connection.
     */
    public getClientId(): ClientId | undefined {
        if (this.singleplayer) {
            return this.localClientId;
        }

        return this.roomConnection?.clientId || this.roomController.getClientId();
    }

    /**
     * Get all connected client ids.
     *
     * - For host clients, this indicates how many member clients are connected to the host client,
     *   _not_ including the host itself.
     * - For non-host clients, this only lists the local connection used to reach the host.
     */
    public getConnectedClientIds(): ClientId[] {
        return this.roomConnection?.getConnectedClientIds() || [];
    }

    /**
     * Get all room client ids.
     *
     * - For host clients, this indicates how many clients are connected to the room, including the
     *   host client itself.
     * - For non-host clients, this includes the member client and the host client once connected.
     */
    public getAllClientIds(): ClientId[] {
        if (this.singleplayer) {
            return [
                this.localClientId,
            ];
        }

        return this.roomConnection?.getAllClientIds() || [];
    }

    /** Get the latest local state view. */
    public getState(): State {
        return this.currentState;
    }

    /** Initialize multiplayer API access without opening a room or starting host pings. */
    public async initMultiplayer(params: Readonly<MultiplayerInitParams>) {
        await this.roomController.initMultiplayer(params);
    }

    /** Start local play without contacting the multiplayer API. This can later open into a room. */
    public startSingleplayer() {
        if (this.currentConnection) {
            throw new Error('Cannot start singleplayer with a connection already present.');
        }

        this.singleplayer = true;
        this.dispatchState(this.createStateEventDetail());
        this.dispatch(
            new ControllerConnectionEvent({
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

    /** Detects if this controller is the room host or not. */
    public isHost(): boolean {
        return this.singleplayer || this.roomConnection?.isHost() || false;
    }

    /** Detects if this controller is connected to a room or not. */
    public isConnected(): boolean {
        return this.singleplayer || this.roomConnection?.isConnected() || false;
    }

    /** Cleanup everything. */
    public override destroy() {
        this.roomConnection = undefined;
        this.singleplayer = false;
        this.roomController.destroy();
        super.destroy();
    }

    /** Join or create a room. */
    public async joinOrCreateRoom(room: Readonly<RoomInput>) {
        const roomConnection = await this.joinRoom(room);
        this.attachMultiplayerRoomConnection(roomConnection);
    }

    /** Join through the core room controller after its candidate connection is state-synchronized. */
    protected async joinRoom(room: Readonly<RoomInput>) {
        await this.roomController.joinOrCreateRoom(room);
        if (!this.roomController.currentConnection) {
            throw new Error(
                'Cannot start p2p-authoritative-host multiplayer: room connection is missing.',
            );
        }

        return this.roomController.currentConnection;
    }

    /** Leave the current room or single player connection. */
    public leaveRoom() {
        if (!this.currentConnection) {
            return;
        }

        this.roomConnection = undefined;
        this.singleplayer = false;
        this.roomController.leaveRoom();
    }

    /** Forward core room-controller events into this state-sync controller. */
    protected listenToRoomController() {
        this.roomController.listen(ControllerRoomListEvent, (event) => {
            this.dispatch(event);
        });
        this.roomController.listen(ControllerConnectionEvent, (event) => {
            this.dispatch(event);
        });
        this.roomController.listen(ControllerClientEvent, (event) => {
            this.dispatch(event);
        });
        this.roomController.listen(
            ControllerMessageEvent<P2pAuthoritativeHostMessage<Input, State>>,
            (event) => {
                this.handleReceivedMessage(event.sourceClientId, event.detail);
            },
        );
    }

    /** Attach an established room transport and publish the current state view. */
    protected attachMultiplayerRoomConnection(
        roomConnection: Readonly<
            MultiplayerRoomConnection<P2pAuthoritativeHostMessage<Input, State>>
        >,
    ) {
        this.roomConnection = roomConnection;
        this.dispatchState(this.createStateEventDetail());

        if (this.isHost()) {
            this.sendStateSnapshot(this.createStateEventDetail());
        }
    }

    /** Apply received inputs on the host or received state snapshots on member clients. */
    protected handleReceivedMessage(
        sourceClientId: ClientId,
        message: Readonly<P2pAuthoritativeHostMessage<Input, State>>,
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
    protected async prepareRoomConnection(
        roomConnection: Readonly<
            MultiplayerRoomConnection<P2pAuthoritativeHostMessage<Input, State>>
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
    protected updateState(state: State) {
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
        state: State;
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
    protected dispatchState(detail: Readonly<StateEventDetail<Input, State>>) {
        this.dispatch(
            new ControllerStateEvent<State, Input>({
                detail,
            }),
        );
    }

    /** Broadcast a state snapshot when the local client is the host. */
    protected sendStateSnapshot(detail: Readonly<StateEventDetail<Input, State>>) {
        if (this.roomConnection && this.isHost()) {
            this.roomConnection.sendMessage(this.createStateSnapshotMessage(detail));
        }
    }

    /** Create a network message from state event detail. */
    protected createStateSnapshotMessage(
        detail: Readonly<StateEventDetail<Input, State>>,
        stateSyncId?: SocketMessageId | undefined,
    ): P2pAuthoritativeHostMessage<Input, State> {
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
    ): StateEventDetail<Input, State> {
        return {
            ...source,
            sequence: this.currentSequence,
            state: this.currentState,
        };
    }
}
