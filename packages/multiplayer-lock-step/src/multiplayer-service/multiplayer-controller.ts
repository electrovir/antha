import {
    ensureError,
    type JsonCompatibleValue,
    makeWritable,
    type MaybePromise,
    type PartialWithUndefined,
    type Uuid,
} from '@augment-vir/common';
import {type mapServiceDevPort} from '@rest-vir/define-service';
import {type AnyDuration, convertDuration} from 'date-vir';
import {defineTypedCustomEvent, ListenTarget} from 'typed-event-target';
import {
    type MultiplayerConnectionUpdate,
    type RoomInput,
    WebrtcMultiplayerConnectionUpdateEvent,
} from '../webrtc/webrtc-multiplayer-controller.js';
import {RoomRejectionError} from './errors.js';
import {LockStepFrameEvent, LockStepGameStateController} from './lock-step-controller.js';
import {createMultiplayerApi, type MultiplayerApi} from './multiplayer-api.js';
import {type MultiplayerClientRooms} from './multiplayer-service.js';

/**
 * Connection state for {@link MultiplayerController}.
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
 * Service and room connection state for {@link MultiplayerController}.
 *
 * @category Internal
 */
export type ServiceAndRoomConnectionState = {
    service: MultiplayerConnectionState | Error;
    room: MultiplayerConnectionState | Error;
};

/**
 * Empty or totally disconnected state for {@link ServiceAndRoomConnectionState}.
 *
 * @category Internal
 */
export const emptyServiceAndRoomConnectionState: Readonly<ServiceAndRoomConnectionState> = {
    room: MultiplayerConnectionState.Disconnected,
    service: MultiplayerConnectionState.Disconnected,
};

/**
 * Constructor parameters for {@link MultiplayerController}.
 *
 * @category Internal
 */
export type MultiplayerControllerParams<Action extends JsonCompatibleValue> = {
    /**
     * A unique string id that represents your game sot that your lobby server can serve multiple
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
              connectingClientId: Uuid,
              controller: MultiplayerController<Action>,
          ) => MaybePromise<boolean>)
        | undefined;

    /**
     * The duration between each frame. This should probably always be smaller than your supported
     * render frame duration (1/FPS). If this is set to `undefined`, you'll need to manually trigger
     * frames with `MultiplayerController.runFrame`.
     */
    frameDuration?: AnyDuration | undefined;
}>;

/**
 * Multiplayer mode parameters for {@link MultiplayerController}.
 *
 * @category Internal
 */
export type MultiplayerParams = {
    /**
     * Set to `undefined` or `false` to disable port scanning. Set to `true` to enable port
     * scanning. Set to an options object to configure port scanning.
     *
     * It is useful to enable this so that clients can find the port that your multiplayer server is
     * running on in case it must change. Note that port scanning will not be active if your
     * `serviceOrigin` does not contain a port.
     *
     * @default undefined
     */
    portScanOptions?: undefined | Parameters<typeof mapServiceDevPort>[1] | boolean;
    /**
     * The origin of the server running the multiplayer connection service.
     *
     * @example 'http://localhost:3000'
     */
    backendOrigin: string;
    /**
     * How long to wait before fetching the list of rooms again.
     *
     * @default {seconds: 10}
     */
    roomUpdateInterval?: AnyDuration | undefined;
    /**
     * Optional stun server URLs to help with routing WebRTC connections. This is entirely optional,
     * but might help with clients attempting to establish connections to each other.
     */
    stunServerUrls?: ReadonlyArray<string> | undefined;
};

/**
 * This is fired whenever a new frame is received from the host client.
 *
 * @category Events
 */
export class ControllerFrameEvent<
    MultiplayerPacket extends JsonCompatibleValue,
> extends defineTypedCustomEvent<any>()('controller-frame') {
    public declare detail: ReadonlyArray<MultiplayerPacket>;
}
/**
 * This is called whenever the room list updates, even if there were no changes to the room list.
 * Note that room list updates are paused while the controller is connected to an actual room.
 *
 * @category Events
 */
export class ControllerRoomListEvent extends defineTypedCustomEvent<
    Readonly<MultiplayerClientRooms>
>()('controller-room-list') {}
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
export class ControllerConnectionEvent extends defineTypedCustomEvent<ServiceAndRoomConnectionState>()(
    'controller-connection',
) {}

/**
 * All events emitted by this controller.
 *
 * @category Internal
 */
export type AllMultiplayerControllerEvents<MultiplayerPacket extends JsonCompatibleValue> =
    | ControllerFrameEvent<MultiplayerPacket>
    | ControllerRoomListEvent
    | ControllerClientEvent
    | ControllerConnectionEvent;

/**
 * An all-in-one controller for singleplayer or lock-step multiplayer game state. Singleplayer mode
 * requires no servers. Multiplayer mode requires a backend service running the
 * {@link MultiplayerApi}.
 *
 * @category Main
 */
export class MultiplayerController<
    MultiplayerPacket extends JsonCompatibleValue = any,
> extends ListenTarget<AllMultiplayerControllerEvents<MultiplayerPacket>> {
    /** All events emitted by this controller. */
    public static readonly events = {
        ControllerFrameEvent,
        ControllerRoomListEvent,
        ControllerClientEvent,
        ControllerConnectionEvent,
    };
    /** All events emitted by this controller. */
    public readonly events = MultiplayerController.events;

    public static readonly knownErrors = {
        RoomRejectionError,
    };
    public readonly knownErrors = MultiplayerController.knownErrors;
    /**
     * Set to `false` to disable room updates, even when still not connected to a room in
     * multiplayer mode.
     */
    public enableRoomUpdates = true;

    /** Currently joined room id. If a room has not been joined yet, this will be empty. */
    public readonly roomId: Uuid | undefined;
    /** The current connection state of the controller's connection to a backend service. */
    public readonly serviceConnectionState: ServiceAndRoomConnectionState['service'] =
        MultiplayerConnectionState.Disconnected;
    /** The current connection state of the controller's connection to a multiplayer room. */
    public readonly roomConnectionState: ServiceAndRoomConnectionState['room'] =
        MultiplayerConnectionState.Disconnected;

    /**
     * Current WebRTC lock step connection with the room host (when not the host) or all room
     * participants (when the host). This will only be initialized after calling
     * {@link MultiplayerController.joinOrCreateRoom}.
     */
    public currentConnection: LockStepGameStateController | undefined;
    /**
     * Rooms that have rejected the current player, so the player doesn't keep trying to connect to
     * them.
     */
    protected rejectedRoomIds = new Set<Uuid>();
    /** The current MultiplayerApi. This will be `undefined` if playing in single player. */
    public multiplayerApi: Promise<MultiplayerApi> | undefined;
    /**
     * Used to keep track of the room update interval. This will be set when the controller is
     * constructed in multiplayer mode or when a room is left. This will be cleared when a room is
     * joined or if the controller is destroyed.
     */
    protected roomUpdateIntervalId: ReturnType<typeof globalThis.setInterval> | undefined;
    /** This is populated if `.startMultiplayer` is called. */
    protected multiplayerParams: Readonly<MultiplayerParams> | undefined;

    /**
     * Get the current client's WebRTC client id. This will return `undefined` if there is no
     * current connection.
     */
    public getClientId(): Uuid | undefined {
        return this.currentConnection?.clientId;
    }

    /**
     * Get all connected client ids.
     *
     * - For host clients, this will indicate how many member clients are connected to the host
     *   client, _not_ including the host itself.
     * - For non-host clients, this will only list the host's client.
     *
     * For host clients, this does ont include the host client id whereas
     * {@link MultiplayerController.getAllClientIds} does.
     */
    public getConnectedClientIds(): Uuid[] {
        return this.currentConnection?.getConnectedClientIds() || [];
    }

    /**
     * Get all room client ids.
     *
     * - For host clients, this will indicate how many clients are connected to the room, including
     *   the host client itself.
     * - For non-host clients, this will only list the host's client.
     *
     * For host clients, this includes the host client id whereas
     * {@link MultiplayerController.getConnectedClientIds} does not.
     */
    public getAllClientIds(): Uuid[] {
        return this.currentConnection?.getAllClientIds() || [];
    }

    constructor(protected readonly params: MultiplayerControllerParams<MultiplayerPacket>) {
        super();
    }

    /**
     * Start multiplayer mode. This initializes {@link MultiplayerController.multiplayerApi} and
     * {@link MultiplayerController.roomUpdateIntervalId}.
     */
    public startMultiplayer(params: Readonly<MultiplayerParams>) {
        if (this.currentConnection) {
            throw new Error(
                `Cannot start multiplayer mode again when a multiplayer connection already present.`,
            );
        }
        this.multiplayerParams = params;
        this.updateConnectionState({
            service: MultiplayerConnectionState.Connecting,
        });

        this.multiplayerApi = createMultiplayerApi({
            portScanOptions: params.portScanOptions,
            backendOrigin: params.backendOrigin,
        })
            .then(async (api) => {
                const output = await api.endpoints['/health'].fetch();
                if (!output.ok) {
                    throw new Error(`Failed to find multiplayer service at ${api.serviceOrigin}`);
                }

                this.updateConnectionState({
                    service: MultiplayerConnectionState.Connected,
                });
                return api;
            })
            .catch((error: unknown) => {
                this.updateConnectionState({
                    service: ensureError(error),
                });
                throw error;
            });

        this.startRoomInterval();
    }

    /** Start singleplayer mode. */
    public startSingleplayer() {
        if (this.currentConnection) {
            throw new Error(`Cannot start singleplayer with a connection already present.`);
        }
        this.multiplayerParams = undefined;
        this.multiplayerApi = undefined;
        this.updateConnectionState({
            service: MultiplayerConnectionState.Connecting,
        });

        this.currentConnection = new LockStepGameStateController(
            this.params.frameDuration,
            () => false,
        );
        this.currentConnection.listen(LockStepFrameEvent, (event) => {
            this.dispatch(
                new ControllerFrameEvent({
                    detail: event.detail,
                }),
            );
        });
        this.currentConnection.startSingleplayer();

        globalThis.clearInterval(this.roomUpdateIntervalId);
        this.updateConnectionState({
            service: MultiplayerConnectionState.Connected,
        });
    }

    /**
     * Manually run the next frame.
     *
     * @throws Error if `frameDuration` has been set.
     */
    public runFrame(actions?: ReadonlyArray<MultiplayerPacket> | undefined) {
        this.currentConnection?.runFrame(actions);
    }

    /** The current FPS of the data flow. */
    public getFps(): number {
        return this.currentConnection?.currentFps || 0;
    }

    /** Fire an action. This will be sent to all clients in the room so they can process it. */
    public act(actions: MultiplayerPacket | ReadonlyArray<MultiplayerPacket>) {
        if (!this.currentConnection || !this.currentConnection.isConnected()) {
            throw new Error(`Cannot perform action: not connected to a room.`);
        }

        this.currentConnection.act(Array.isArray(actions) ? actions : [actions]);
    }

    /** Detects if this controller is the room host or not. */
    public isHost(): boolean {
        return this.currentConnection?.isHost() || false;
    }

    /** Cleanup everything. */
    public override destroy() {
        super.destroy();
        this.updateConnectionState({
            room: MultiplayerConnectionState.Disconnected,
            service: MultiplayerConnectionState.Disconnected,
        });
        this.currentConnection?.destroy();
        globalThis.clearInterval(this.roomUpdateIntervalId);
    }

    /**
     * Join or create a room.
     *
     * @throws `Error` if this controller is already connected to a room.
     */
    public async joinOrCreateRoom(room: Readonly<RoomInput>) {
        if (this.currentConnection) {
            throw new Error(`Cannot join room: connection already established.`);
        } else if (!this.multiplayerApi || !this.multiplayerParams) {
            throw new Error(
                'Cannot join room. Please construct this controller in multiplayer mode to join rooms.',
            );
        } else if (this.rejectedRoomIds.has(room.roomId)) {
            throw new RoomRejectionError(room);
        }

        this.updateConnectionState({
            room: MultiplayerConnectionState.Connecting,
        });

        const acceptConnectionListener = this.params.acceptConnection;

        this.currentConnection = new LockStepGameStateController(
            this.params.frameDuration || {
                milliseconds: 10,
            },
            acceptConnectionListener
                ? (data) => {
                      return acceptConnectionListener(data.connectingClientId, this);
                  }
                : undefined,
        );
        this.currentConnection.listen(LockStepFrameEvent, (event) => {
            this.dispatch(
                new ControllerFrameEvent({
                    detail: event.detail,
                }),
            );
        });
        this.currentConnection.listen(WebrtcMultiplayerConnectionUpdateEvent, (event) => {
            this.dispatch(
                new ControllerClientEvent({
                    detail: event.detail,
                }),
            );
        });

        if (
            await this.currentConnection.multiplayerConnect(
                this.params.gameId,
                await this.multiplayerApi,
                this.multiplayerParams.stunServerUrls || [],
                room,
            )
        ) {
            makeWritable(this).roomId = room.roomId;
            globalThis.clearInterval(this.roomUpdateIntervalId);
            this.updateConnectionState({
                room: MultiplayerConnectionState.Connected,
            });
        } else {
            this.rejectedRoomIds.add(room.roomId);
            this.currentConnection = undefined;
            const error = new RoomRejectionError(room);

            this.updateConnectionState({
                room: error,
            });
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
        this.startRoomInterval();
        this.updateConnectionState({
            room: MultiplayerConnectionState.Disconnected,
        });
    }

    /** Set the current connection state and fire listeners. */
    protected updateConnectionState(state: Partial<ServiceAndRoomConnectionState>) {
        if (state.service) {
            makeWritable(this).serviceConnectionState = state.service;
        }
        if (state.room) {
            makeWritable(this).roomConnectionState = state.room;
        }
        this.dispatch(
            new ControllerConnectionEvent({
                detail: {
                    room: this.roomConnectionState,
                    service: this.serviceConnectionState,
                },
            }),
        );
    }

    /** Starts polling the multiplayer server for room updates and fires listeners. */
    protected startRoomInterval() {
        if (this.multiplayerApi) {
            const roomUpdateMs: number = this.multiplayerParams?.roomUpdateInterval
                ? convertDuration(this.multiplayerParams.roomUpdateInterval, {
                      milliseconds: true,
                  }).milliseconds
                : 10_000;

            this.roomUpdateIntervalId = globalThis.setInterval(async () => {
                if (this.currentConnection || !this.multiplayerApi || !this.enableRoomUpdates) {
                    return;
                }
                const output = await (
                    await this.multiplayerApi
                ).endpoints['/rooms'].fetch({
                    searchParams: {
                        gameId: [this.params.gameId],
                    },
                });
                if (output.ok) {
                    this.dispatch(
                        new ControllerRoomListEvent({
                            detail: output.data,
                        }),
                    );
                }
            }, roomUpdateMs);
        }
    }
}
