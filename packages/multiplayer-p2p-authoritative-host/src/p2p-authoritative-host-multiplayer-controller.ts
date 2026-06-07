import {
    type ApiAndRoomConnectionState,
    type ClientId,
    ControllerClientEvent,
    ControllerConnectionEvent,
    ControllerMessageEvent,
    ControllerRoomListEvent,
    emptyApiAndRoomConnectionState,
    MultiplayerConnectionState,
    type MultiplayerInitParams,
    MultiplayerRoomController,
    type RoomInput,
    RoomRejectionError,
} from '@antha/multiplayer-core';
import {
    type JsonCompatibleValue,
    type MaybePromise,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {defineTypedCustomEvent, ListenTarget} from 'typed-event-target';
import {
    P2pAuthoritativeHostController,
    type P2pAuthoritativeHostGameDefinition,
    type P2pAuthoritativeHostMessage,
    P2pAuthoritativeHostStateEvent,
    type P2pAuthoritativeHostStateSnapshot,
} from './p2p-authoritative-host-controller.js';

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
> extends defineTypedCustomEvent<any>()('controller-state') {
    public declare detail: Readonly<P2pAuthoritativeHostStateSnapshot<State>>;
}

/**
 * All events emitted by this controller.
 *
 * @category Internal
 */
export type AllP2pAuthoritativeHostMultiplayerControllerEvents<State extends JsonCompatibleValue> =
    | ControllerStateEvent<State>
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
> extends ListenTarget<AllP2pAuthoritativeHostMultiplayerControllerEvents<State>> {
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
    /** Current p2p-authoritative-host connection. */
    public currentConnection: P2pAuthoritativeHostController<Input, State> | undefined;
    private readonly initialState: State;

    constructor(
        protected readonly params: P2pAuthoritativeHostMultiplayerControllerParams<Input, State>,
    ) {
        super();
        this.initialState = params.createInitialState();
        this.roomController = new MultiplayerRoomController<
            P2pAuthoritativeHostMessage<Input, State>
        >({
            gameId: params.gameId,
            acceptConnection: params.acceptConnection
                ? (connectingClientId) => {
                      return params.acceptConnection?.(connectingClientId, this) ?? true;
                  }
                : undefined,
        });
        this.listenToRoomController();
    }

    /**
     * Set to `false` to disable room updates, even when still not connected to a room in
     * multiplayer mode.
     */
    public get enableRoomUpdates(): boolean {
        return this.roomController.enableRoomUpdates;
    }

    public set enableRoomUpdates(value: boolean) {
        this.roomController.enableRoomUpdates = value;
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
        return this.currentConnection?.clientId || this.roomController.getClientId();
    }

    /**
     * Get all connected client ids.
     *
     * - For host clients, this indicates how many member clients are connected to the host client,
     *   _not_ including the host itself.
     * - For non-host clients, this only lists the local connection used to reach the host.
     */
    public getConnectedClientIds(): ClientId[] {
        return this.currentConnection?.getConnectedClientIds() || [];
    }

    /**
     * Get all room client ids.
     *
     * - For host clients, this indicates how many clients are connected to the room, including the
     *   host client itself.
     * - For non-host clients, this includes the member client and the host client once connected.
     */
    public getAllClientIds(): ClientId[] {
        return this.currentConnection?.getAllClientIds() || [];
    }

    /** Get the latest local state view. */
    public getState(): State {
        return this.currentConnection ? this.currentConnection.getState() : this.initialState;
    }

    /** Start multiplayer mode. This delegates API connectivity and room polling to multiplayer core. */
    public async initMultiplayer(params: Readonly<MultiplayerInitParams>) {
        await this.roomController.initMultiplayer(params);
    }

    /** Start singleplayer mode. */
    public startSingleplayer() {
        if (this.currentConnection) {
            throw new Error('Cannot start singleplayer with a connection already present.');
        }

        this.currentConnection = this.createP2pAuthoritativeHostConnection();
        this.currentConnection.startSingleplayer();
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
        this.getCurrentConnection().act(input);
    }

    /** Run one authoritative tick. Only the host advances canonical state. */
    public tick(elapsedMs = 0) {
        this.getCurrentConnection().tick(elapsedMs);
    }

    /** Detects if this controller is the room host or not. */
    public isHost(): boolean {
        return this.currentConnection?.isHost() || false;
    }

    /** Detects if this controller is connected to a room or not. */
    public isConnected(): boolean {
        return this.currentConnection?.isConnected() || false;
    }

    /** Cleanup everything. */
    public override destroy() {
        this.currentConnection?.destroy();
        this.currentConnection = undefined;
        this.roomController.destroy();
        super.destroy();
    }

    /**
     * Join or create a room.
     *
     * @throws `Error` if this controller is already connected to a room.
     */
    public async joinOrCreateRoom(room: Readonly<RoomInput>) {
        if (this.currentConnection) {
            throw new Error('Cannot join room: connection already established.');
        }

        const authoritativeHostConnection = this.createP2pAuthoritativeHostConnection();
        this.currentConnection = authoritativeHostConnection;

        try {
            await this.roomController.joinOrCreateRoom(room);
            if (!this.roomController.currentConnection) {
                throw new Error(
                    'Cannot start p2p-authoritative-host multiplayer: room connection is missing.',
                );
            }

            authoritativeHostConnection.attachMultiplayerRoomConnection(
                this.roomController.currentConnection,
            );
        } catch (error: unknown) {
            authoritativeHostConnection.destroy();
            this.currentConnection = undefined;
            throw error;
        }
    }

    /** Leave the current room or single player connection. */
    public leaveRoom() {
        if (!this.currentConnection) {
            return;
        }

        this.currentConnection.destroy();
        this.currentConnection = undefined;
        this.roomController.leaveRoom();
    }

    private listenToRoomController() {
        this.roomController.listen(ControllerRoomListEvent, (event) => {
            this.dispatch(event);
        });
        this.roomController.listen(ControllerConnectionEvent, (event) => {
            this.dispatch(event);
        });
        this.roomController.listen(ControllerClientEvent, (event) => {
            if ('newMember' in event.detail) {
                this.currentConnection?.syncNewMember(event.detail.newMember);
            }
            this.dispatch(event);
        });
        this.roomController.listen(
            ControllerMessageEvent<P2pAuthoritativeHostMessage<Input, State>>,
            (event) => {
                this.currentConnection?.handleReceivedMessage(event.sourceClientId, event.detail);
            },
        );
    }

    private getCurrentConnection() {
        if (!this.currentConnection) {
            throw new Error('Cannot use authoritative host state: not connected to a room.');
        }

        return this.currentConnection;
    }

    private createP2pAuthoritativeHostConnection() {
        const connection = new P2pAuthoritativeHostController<Input, State>(
            this.params,
            this.initialState,
        );
        connection.listen(P2pAuthoritativeHostStateEvent<State>, (event) => {
            this.dispatch(
                new ControllerStateEvent<State>({
                    detail: event.detail,
                }),
            );
        });
        return connection;
    }
}
