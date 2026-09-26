import {
    type JsonCompatibleValue,
    log,
    type MaybePromise,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {ListenTarget, type RemoveListenerCallback} from 'typed-event-target';
import {type ClientId, createMultiplayerId} from '../multiplayer-id.js';
import {type MultiplayerConnectionUpdate} from '../webrtc/webrtc-multiplayer-controller.js';
import {RoomRejectionError} from './errors.js';
import {
    type ApiAndRoomConnectionState,
    MultiplayerControllerClientStatusEvent,
    MultiplayerControllerConnectionEvent,
    MultiplayerControllerMessageEvent,
    MultiplayerControllerRoomListEvent,
    type MultiplayerControllerRoomListListener,
    type MultiplayerInitParams,
    type MultiplayerRoomConnection,
    MultiplayerRoomController,
} from './multiplayer-controller.js';

/**
 * Constructor parameters shared by every {@link P2pMultiplayerController} subclass.
 *
 * @category Internal
 */
export type P2pMultiplayerControllerParams<Controller> = {
    /**
     * A unique string id that represents your game so that your lobby server can serve multiple
     * games at once. Your lobby server will need to know this game id ahead of time and match it to
     * your frontend's origin.
     */
    gameId: string;
} & PartialWithUndefined<{
    /**
     * This is fired when a WebRTC peer attempts to connect to the host client. Return `true` to
     * accept the connection. Return `false` to reject it.
     *
     * @default accept all connections
     */
    acceptConnection: (
        connectingClientId: ClientId,
        multiplayerController: Controller,
    ) => MaybePromise<boolean>;
    /**
     * Enables verbose multiplayer debug logs. Change the controller's `debugMultiplayer` property
     * to toggle them later.
     */
    debugMultiplayer: boolean;
}>;

/**
 * Events that every {@link P2pMultiplayerController} forwards from its room controller.
 *
 * @category Internal
 */
export type P2pMultiplayerControllerRoomEvents =
    | MultiplayerControllerRoomListEvent
    | MultiplayerControllerClientStatusEvent
    | MultiplayerControllerConnectionEvent;

/**
 * Room, API, and singleplayer bookkeeping shared by the p2p multiplayer controllers. Subclasses
 * implement their own state synchronization on top of the attached room connection.
 *
 * @category Internal
 */
export abstract class P2pMultiplayerController<
    Message extends JsonCompatibleValue,
    Events extends Readonly<Event> = never,
> extends ListenTarget<Events | P2pMultiplayerControllerRoomEvents> {
    public static readonly knownErrors = {
        RoomRejectionError,
    };
    public readonly knownErrors = P2pMultiplayerController.knownErrors;

    /** Enables verbose multiplayer debug logs. */
    public debugMultiplayer: boolean;
    /** Core multiplayer room controller that owns API, room polling, signaling, and transport. */
    public readonly roomController: MultiplayerRoomController<Message>;
    protected readonly localClientId = createMultiplayerId.client();
    protected roomConnection: MultiplayerRoomConnection<Message> | undefined;
    protected singleplayer = false;

    constructor(
        params: Readonly<
            Pick<P2pMultiplayerControllerParams<unknown>, 'debugMultiplayer' | 'gameId'>
        >,
    ) {
        super();
        this.debugMultiplayer = !!params.debugMultiplayer;
        this.debugLog(`constructing controller for game '${params.gameId}'`);
        this.roomController = new MultiplayerRoomController<Message>({
            gameId: params.gameId,
            clientId: this.localClientId,
            prepareConnection: async (connection) => {
                await this.prepareRoomConnection?.(connection);
            },
            acceptConnection: (connectingClientId) => {
                this.debugLog(`checking incoming connection from ${connectingClientId}`);
                return this.shouldAcceptConnection(connectingClientId);
            },
        });
        this.listenToRoomController();
    }

    /** Decides whether the host accepts a connecting peer. */
    protected abstract shouldAcceptConnection(connectingClientId: ClientId): MaybePromise<boolean>;

    /** Handles a message received from another room client. */
    protected abstract handleReceivedMessage(
        sourceClientId: ClientId,
        message: Readonly<Message>,
    ): void;

    /**
     * Prepares a candidate room connection before the room controller commits to it. Throwing keeps
     * the current room connected.
     */
    protected prepareRoomConnection?(
        roomConnection: Readonly<MultiplayerRoomConnection<Message>>,
    ): MaybePromise<void>;

    /** Reacts to a room client status change before the event is forwarded to listeners. */
    protected handleClientStatus?(status: Readonly<MultiplayerConnectionUpdate>): void;

    /** Current connection, exposed for compatibility checks. */
    public get currentConnection(): this | undefined {
        return this.isConnected() ? this : undefined;
    }

    /** The current client id. */
    public get clientId(): ClientId {
        return this.roomConnection?.clientId || this.localClientId;
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
     * Listen for room list updates, including while connected to a room.
     *
     * If a callback is provided, it is called each time the room list is updated.
     */
    public startRoomUpdates(
        callback: MultiplayerControllerRoomListListener,
    ): RemoveListenerCallback;
    public startRoomUpdates(callback?: undefined): undefined;
    public startRoomUpdates(
        callback?: MultiplayerControllerRoomListListener | undefined,
    ): RemoveListenerCallback | undefined;
    public startRoomUpdates(
        callback?: MultiplayerControllerRoomListListener | undefined,
    ): RemoveListenerCallback | undefined {
        return this.roomController.startRoomUpdates(callback);
    }

    /** Turn off room list updates and remove callbacks added via `startRoomUpdates`. */
    public stopRoomUpdates() {
        this.roomController.stopRoomUpdates();
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

    /** Initialize multiplayer API access without opening a room or starting host pings. */
    public async initMultiplayer(params: Readonly<MultiplayerInitParams>) {
        this.debugLog(`initializing multiplayer with backend ${params.backendOrigin}`);
        await this.roomController.initMultiplayer(params);
        this.debugLog('multiplayer API initialized');
    }

    /** Detects if this controller is the room host or not. */
    public isHost(): boolean {
        return this.singleplayer || this.roomConnection?.isHost() || false;
    }

    /** Detects if this controller is connected to a room or not. */
    public isConnected(): boolean {
        return this.singleplayer || this.roomConnection?.isConnected() || false;
    }

    /** Leave the current room or single player connection. */
    public leaveRoom() {
        if (!this.currentConnection) {
            this.debugLog('leaveRoom called without a current connection');
            return;
        }

        this.debugLog(`leaving room '${this.roomId || 'unknown'}'`);
        this.roomConnection = undefined;
        this.singleplayer = false;
        this.roomController.leaveRoom();
    }

    /** Cleanup everything. */
    public override destroy() {
        this.debugLog('destroying controller');
        this.roomConnection = undefined;
        this.singleplayer = false;
        this.roomController.destroy();
        super.destroy();
    }

    /** Forward core room-controller events into this controller. */
    protected listenToRoomController() {
        this.roomController.listen(MultiplayerControllerRoomListEvent, (event) => {
            this.dispatch(event);
        });
        this.roomController.listen(MultiplayerControllerConnectionEvent, (event) => {
            this.debugLog(
                `connection event received: api=${String(event.detail.api)} room=${String(event.detail.room)}`,
            );
            this.dispatch(event);
        });
        this.roomController.listen(MultiplayerControllerClientStatusEvent, (event) => {
            this.debugLog(`client event received: ${JSON.stringify(event.detail)}`);
            this.handleClientStatus?.(event.detail);
            this.dispatch(event);
        });
        this.roomController.listen(MultiplayerControllerMessageEvent<Message>, (event) => {
            this.debugLog(`message event received from ${event.sourceClientId}`);
            this.handleReceivedMessage(event.sourceClientId, event.detail);
        });
    }

    /** Write a multiplayer debug log when debug logging is enabled. */
    protected debugLog(message: string) {
        log.if(this.debugMultiplayer).faint(`[multiplayer] ${message}`);
    }
}
