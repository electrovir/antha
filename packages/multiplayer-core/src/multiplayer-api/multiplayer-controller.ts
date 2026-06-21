import {waitUntil} from '@augment-vir/assert';
import {
    ensureError,
    type JsonCompatibleValue,
    makeWritable,
    type MaybePromise,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {type FindPortOptions} from '@rest-vir/api';
import {type AnyDuration, convertDuration} from 'date-vir';
import {
    defineTypedCustomEvent,
    ListenTarget,
    type RemoveListenerCallback,
} from 'typed-event-target';
import {type ClientId, type RoomId} from '../multiplayer-id.js';
import {
    type MultiplayerConnectionUpdate,
    type RoomInput,
    WebrtcMultiplayerConnectionUpdateEvent,
    WebrtcMultiplayerController,
    WebrtcMultiplayerMessageEvent,
} from '../webrtc/webrtc-multiplayer-controller.js';
import {RoomRejectionError} from './errors.js';
import {
    type MultiplayerClientRooms,
    multiplayerHealthEndpoint,
    multiplayerRoomsEndpoint,
} from './multiplayer-api.js';
import {createMultiplayerApiClient, type MultiplayerApiClient} from './multiplayer-client.js';

/**
 * Connection state for {@link MultiplayerRoomController}.
 *
 * @category Internal
 */
export enum MultiplayerConnectionState {
    Connecting = 'connecting',
    Connected = 'connected',
    /** The connection has not been started or has been gracefully terminated. */
    Disconnected = 'disconnected',
}

/**
 * API and room connection state for {@link MultiplayerRoomController}.
 *
 * @category Internal
 */
export type ApiAndRoomConnectionState = {
    api: MultiplayerConnectionState | Error;
    room: MultiplayerConnectionState | Error;
};

/**
 * Empty or totally disconnected state for {@link ApiAndRoomConnectionState}.
 *
 * @category Internal
 */
export const emptyApiAndRoomConnectionState: Readonly<ApiAndRoomConnectionState> = {
    room: MultiplayerConnectionState.Disconnected,
    api: MultiplayerConnectionState.Disconnected,
};

/**
 * The generic room transport surface exposed by {@link MultiplayerRoomController}. This will be
 * implemented differently by each multiplayer state sync paradigm. Meaning, a different
 * implementation for p2p-lock-step syncing, a different implementation for authoritative server
 * state syncing, etc.
 *
 * @category Internal
 */
export type MultiplayerRoomConnection<Message extends JsonCompatibleValue> = {
    /** The id assigned to the local room client. */
    clientId: ClientId;
    /** Whether the local client is currently the room host. */
    isHost(): boolean;
    /** Whether the local client has an active room connection. */
    isConnected(): boolean;
    /** Get the ids of clients with active peer connections. */
    getConnectedClientIds(): ClientId[];
    /** Get every known client id in the room, including the host when known. */
    getAllClientIds(): ClientId[];
    /** Send a message through the room connection. */
    sendMessage(message: Readonly<Message>): void;
    /** Send a message to one specific room client. */
    sendToOnlyOneClient(clientId: ClientId, message: Readonly<Message>): void;
    /** Terminate the room connection and release transport resources. */
    destroy(): void;
};

/**
 * Constructor parameters for {@link MultiplayerRoomController}.
 *
 * @category Internal
 */
export type MultiplayerRoomControllerParams<Message extends JsonCompatibleValue> = {
    /**
     * A unique string id that represents your game so that your lobby server can serve multiple
     * games at once. Your lobby server will need to know this game id ahead of time and match it to
     * your frontend's origin.
     *
     * If this is left empty, make sure your lobby server (if you have any) handles that, and only
     * handles one game at a time.
     */
    gameId: string;
} & PartialWithUndefined<{
    /**
     * This is fired when a WebRTC peer attempts to connect to the host client (this will only be
     * fired if your client is the host). Return `true` to accept the connection. Return `false` to
     * reject it.
     *
     * @default accept all connections
     */
    acceptConnection?:
        | ((
              connectingClientId: ClientId,
              controller: MultiplayerRoomController<Message>,
          ) => MaybePromise<boolean>)
        | undefined;
}>;

/**
 * Multiplayer mode parameters for {@link MultiplayerRoomController}.
 *
 * @category Internal
 */
export type MultiplayerInitParams = {
    /**
     * The origin of the server running the multiplayer API.
     *
     * @example 'http://localhost:3000'
     */
    backendOrigin: string;
} & PartialWithUndefined<{
    /**
     * Set to `undefined` or `false` to disable port scanning. Set to `true` to enable port
     * scanning. Set to an options object to configure port scanning.
     *
     * It is useful to enable this so that clients can find the port that your multiplayer server is
     * running on in case it must change. Note that port scanning will not be active if your
     * `backendOrigin` does not contain a port.
     *
     * @default undefined
     */
    portScanOptions: Omit<FindPortOptions, 'startOrigin'> | boolean;
    /**
     * How long to wait before fetching the list of rooms again.
     *
     * @default {seconds: 10}
     */
    roomUpdateInterval: AnyDuration;
    /**
     * Optional stun server URLs to help with routing WebRTC connections. This is entirely optional,
     * but might help with clients attempting to establish connections to each other.
     */
    stunServerUrls: ReadonlyArray<string>;
    /** If set, this will override the internal multiplayer API. */
    multiplayerApiClient: Readonly<MultiplayerApiClient>;
}>;

/**
 * This is fired when a room message is received.
 *
 * @category Events
 */
export class ControllerMessageEvent<
    Message extends JsonCompatibleValue,
> extends defineTypedCustomEvent<any>()('controller-message') {
    public declare detail: Message;

    constructor(
        public readonly sourceClientId: ClientId,
        detail: Message,
    ) {
        super({
            detail,
        });
    }
}

/**
 * This is called whenever the room list updates, even if there were no changes to the room list. By
 * default, room list updates are off. Use `MultiplayerRoomController.startRoomUpdates` to start
 * room list updates.
 *
 * @category Events
 */
export class ControllerRoomListEvent extends defineTypedCustomEvent<
    Readonly<MultiplayerClientRooms>
>()('controller-room-list') {}

/**
 * Callback fired whenever the room list is fetched from the multiplayer API.
 *
 * @category Internal
 */
export type ControllerRoomListListener = (
    rooms: Readonly<MultiplayerClientRooms>,
) => MaybePromise<void>;

/**
 * This is fired in the following situations:
 *
 * - A new host for the room was selected
 * - The room host was lost
 * - A new room client was added (only fired on the host client)
 * - A room client was lost (only fired on the host client)
 *
 * @category Events
 */
export class ControllerClientEvent extends defineTypedCustomEvent<
    Readonly<MultiplayerConnectionUpdate>
>()('controller-client') {}

/**
 * Fires when the controller's connection state is updated.
 *
 * @category Events
 */
export class ControllerConnectionEvent extends defineTypedCustomEvent<ApiAndRoomConnectionState>()(
    'controller-connection',
) {}

/**
 * All events emitted by this controller.
 *
 * @category Internal
 */
export type AllMultiplayerRoomControllerEvents<Message extends JsonCompatibleValue> =
    | ControllerMessageEvent<Message>
    | ControllerRoomListEvent
    | ControllerClientEvent
    | ControllerConnectionEvent;

/**
 * A generic multiplayer room controller. It manages API connectivity, room discovery, WebRTC
 * signaling, and generic room messages. It does not impose a game-state synchronization strategy.
 *
 * @category Main
 */
export class MultiplayerRoomController<
    Message extends JsonCompatibleValue = any,
> extends ListenTarget<AllMultiplayerRoomControllerEvents<Message>> {
    /** All events emitted by this controller. */
    public static readonly events = {
        ControllerMessageEvent,
        ControllerRoomListEvent,
        ControllerClientEvent,
        ControllerConnectionEvent,
    };
    /** All events emitted by this controller. */
    public readonly events = MultiplayerRoomController.events;

    public static readonly knownErrors = {
        RoomRejectionError,
    };
    public readonly knownErrors = MultiplayerRoomController.knownErrors;
    protected isListeningToRoomUpdates = false;

    /** Currently joined room id. If a room has not been joined yet, this will be empty. */
    public readonly roomId: RoomId | undefined;
    /** The current connection state of the controller's connection to a backend API. */
    public readonly apiConnectionState: ApiAndRoomConnectionState['api'] =
        MultiplayerConnectionState.Disconnected;
    /** The current connection state of the controller's connection to a multiplayer room. */
    public readonly roomConnectionState: ApiAndRoomConnectionState['room'] =
        MultiplayerConnectionState.Disconnected;

    /** Current room connection. */
    public currentConnection: MultiplayerRoomConnection<Message> | undefined;
    /**
     * Rooms that have rejected the current player, so the player doesn't keep trying to connect to
     * them.
     */
    protected rejectedRoomIds = new Set<RoomId>();
    /**
     * The current multiplayer API client. This will be `undefined` before multiplayer starts or if
     * playing in single player.
     */
    public multiplayerApiClient: Readonly<MultiplayerApiClient> | undefined;
    /** Used to keep track of the room update interval. */
    protected roomUpdateIntervalId: ReturnType<typeof globalThis.setInterval> | undefined;
    /** This is populated when `.initMultiplayer` is called. */
    protected multiplayerParams: Readonly<MultiplayerInitParams> | undefined;

    /**
     * Get the current client's WebRTC client id. This will return `undefined` if there is no
     * current connection.
     */
    public getClientId(): ClientId | undefined {
        return this.currentConnection?.clientId;
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

    constructor(protected readonly params: MultiplayerRoomControllerParams<Message>) {
        super();
    }

    /**
     * Start multiplayer mode. This initializes
     * {@link MultiplayerRoomController.multiplayerApiClient}.
     */
    public async initMultiplayer(params: Readonly<MultiplayerInitParams>) {
        if (this.currentConnection) {
            throw new Error(
                'Cannot start multiplayer mode again when a multiplayer connection already present.',
            );
        }
        this.multiplayerParams = params;
        this.updateConnectionState({
            api: MultiplayerConnectionState.Connecting,
        });

        try {
            const api =
                params.multiplayerApiClient ||
                (await createMultiplayerApiClient({
                    portScanOptions: params.portScanOptions,
                    backendOrigin: params.backendOrigin,
                }));

            const output = await api.fetch(multiplayerHealthEndpoint).GET();
            if (!output.Ok) {
                throw new Error(`Failed to find multiplayer API at ${api.baseUrl}.`);
            }

            this.multiplayerApiClient = api;
            this.updateConnectionState({
                api: MultiplayerConnectionState.Connected,
            });
        } catch (error: unknown) {
            this.updateConnectionState({
                api: ensureError(error),
            });
            throw error;
        }
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
        this.isListeningToRoomUpdates = true;
        this.startRoomInterval();

        if (callback) {
            return this.listen(ControllerRoomListEvent, async (event) => {
                await callback(event.detail);
            });
        } else {
            return undefined;
        }
    }

    /** Turn off room list updates and remove callbacks added via `startRoomUpdates`. */
    public stopRoomUpdates() {
        this.isListeningToRoomUpdates = false;
        this.stopRoomInterval();
    }

    /** Send a generic message to the current room. */
    public sendMessage(message: Readonly<Message>) {
        if (!this.currentConnection || !this.currentConnection.isConnected()) {
            throw new Error('Cannot send message: not connected to a room.');
        }

        this.currentConnection.sendMessage(message);
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
        super.destroy();
        this.updateConnectionState({
            room: MultiplayerConnectionState.Disconnected,
            api: MultiplayerConnectionState.Disconnected,
        });
        this.currentConnection?.destroy();
        this.stopRoomUpdates();
    }

    /** Join or create a room. */
    public async joinOrCreateRoom(room: Readonly<RoomInput>) {
        if (!this.multiplayerApiClient || !this.multiplayerParams) {
            throw new Error(
                'Cannot join room. Please start this controller in multiplayer mode to join rooms.',
            );
        } else if (this.rejectedRoomIds.has(room.roomId)) {
            throw new RoomRejectionError(room);
        }

        const previousConnection = this.currentConnection;
        const previousRoomId = this.roomId;

        this.updateConnectionState({
            room: MultiplayerConnectionState.Connecting,
        });

        const currentConnection = new WebrtcMultiplayerController<Message>(
            this.params.gameId,
            this.multiplayerApiClient,
            this.multiplayerParams.stunServerUrls || [],
            room,
            undefined,
            this.params.acceptConnection
                ? (data) => {
                      return this.params.acceptConnection?.(data.connectingClientId, this) ?? true;
                  }
                : undefined,
        );

        currentConnection.listen(WebrtcMultiplayerMessageEvent<Message>, (event) => {
            this.dispatch(new ControllerMessageEvent(event.sourceClientId, event.detail));
        });
        currentConnection.listen(WebrtcMultiplayerConnectionUpdateEvent, (event) => {
            this.dispatch(
                new ControllerClientEvent({
                    detail: event.detail,
                }),
            );
        });

        try {
            await currentConnection.initConnection();
            const connectionResult = await waitUntil.isDefined(() => {
                const connected = currentConnection.isConnected();
                const destroyed = currentConnection.isDestroyed;

                return !connected && !destroyed
                    ? undefined
                    : {
                          connected,
                          destroyed,
                      };
            });

            if (connectionResult.connected) {
                this.currentConnection = currentConnection;
                previousConnection?.destroy();
                makeWritable(this).roomId = room.roomId;
                this.stopRoomUpdates();
                this.updateConnectionState({
                    room: MultiplayerConnectionState.Connected,
                });
            } else {
                this.rejectedRoomIds.add(room.roomId);
                throw new RoomRejectionError(room);
            }
        } catch (error) {
            currentConnection.destroy();

            if (previousConnection) {
                this.currentConnection = previousConnection;
                makeWritable(this).roomId = previousRoomId;
                this.updateConnectionState({
                    room: MultiplayerConnectionState.Connected,
                });
            } else {
                this.currentConnection = undefined;
                this.updateConnectionState({
                    room: ensureError(error),
                });
            }
            throw error;
        }
    }

    /** Leave the current room or single player connection. */
    public leaveRoom() {
        if (!this.currentConnection) {
            return;
        }

        makeWritable(this).roomId = undefined;
        this.currentConnection.destroy();
        this.currentConnection = undefined;
        this.updateConnectionState({
            room: MultiplayerConnectionState.Disconnected,
        });
    }

    /** Set the current connection state and fire listeners. */
    protected updateConnectionState(state: Partial<ApiAndRoomConnectionState>) {
        if (state.api) {
            makeWritable(this).apiConnectionState = state.api;
        }
        if (state.room) {
            makeWritable(this).roomConnectionState = state.room;
        }
        this.dispatch(
            new ControllerConnectionEvent({
                detail: {
                    room: this.roomConnectionState,
                    api: this.apiConnectionState,
                },
            }),
        );
    }

    /** Stop polling the multiplayer server for room updates. */
    protected stopRoomInterval() {
        globalThis.clearInterval(this.roomUpdateIntervalId);
        this.roomUpdateIntervalId = undefined;
    }

    /** Starts polling the multiplayer server for room updates and fires listeners. */
    protected startRoomInterval() {
        this.stopRoomInterval();

        if (this.isListeningToRoomUpdates && this.multiplayerApiClient) {
            const roomUpdateMs: number = this.multiplayerParams?.roomUpdateInterval
                ? convertDuration(this.multiplayerParams.roomUpdateInterval, {
                      milliseconds: true,
                  }).milliseconds
                : 10_000;

            this.roomUpdateIntervalId = globalThis.setInterval(async () => {
                if (!this.isListeningToRoomUpdates || !this.multiplayerApiClient) {
                    return;
                }
                const output = await this.multiplayerApiClient.fetch(multiplayerRoomsEndpoint).GET({
                    searchParams: {
                        gameId: [this.params.gameId],
                    },
                });
                if (output.Ok) {
                    this.dispatch(
                        new ControllerRoomListEvent({
                            detail: output.Ok.responseData,
                        }),
                    );
                }
            }, roomUpdateMs);
        }
    }
}
