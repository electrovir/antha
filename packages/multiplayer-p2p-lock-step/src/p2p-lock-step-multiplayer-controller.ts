import {
    type ApiAndRoomConnectionState,
    type ClientId,
    createMultiplayerId,
    emptyApiAndRoomConnectionState,
    MultiplayerConnectionState,
    MultiplayerControllerClientStatusEvent,
    MultiplayerControllerConnectionEvent,
    MultiplayerControllerMessageEvent,
    MultiplayerControllerRoomListEvent,
    type MultiplayerControllerRoomListListener,
    type MultiplayerInitParams,
    type MultiplayerRoomConnection,
    MultiplayerRoomController,
    type RoomInput,
    RoomRejectionError,
} from '@antha/multiplayer-core';
import {
    ensureArray,
    type JsonCompatibleValue,
    log,
    makeWritable,
    type MaybePromise,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {type AnyDuration, convertDuration} from 'date-vir';
import {
    defineTypedCustomEvent,
    ListenTarget,
    type RemoveListenerCallback,
    type TypedCustomEventInit,
} from 'typed-event-target';

/**
 * Message type for {@link P2pLockStepMessage}.
 *
 * @category Internal
 */
export enum P2pLockStepMessageType {
    Actions = 'actions',
    Frame = 'frame',
    StateSyncRequest = 'state-sync-request',
}

/**
 * A single action within a {@link MultiplayerFrame}.
 *
 * @category Internal
 */
export type MultiplayerFramePacket<MultiplayerPacket extends JsonCompatibleValue> = {
    packet: MultiplayerPacket;
    sourceClientId: ClientId;
};

/**
 * Data received from {@link MultiplayerControllerFrameEvent}.
 *
 * @category Internal
 */
export type MultiplayerFrame<MultiplayerPacket extends JsonCompatibleValue> = {
    packets: ReadonlyArray<MultiplayerFramePacket<MultiplayerPacket>>;
} & PartialWithUndefined<{
    /**
     * On clients, the host's state hash from right after the most recent check frame. Pass this
     * frame's event to {@link P2pLockStepMultiplayerController.checkStateHash} before applying it.
     */
    hostStateHash: number;
    /**
     * Whether to pass this frame's event and a state hash to
     * {@link P2pLockStepMultiplayerController.reportStateHash} right after applying it.
     */
    shouldReportNextFrameHash: boolean;
    /**
     * On the host, whether to pass the state from right after applying this frame to
     * {@link P2pLockStepMultiplayerController.sendStateSync}. The host produces no more frames until
     * it does.
     */
    shouldSendStateSync: boolean;
}>;

/**
 * Message exchanged by p2p-lock-step clients.
 *
 * @category Internal
 */
export type P2pLockStepMessage<MultiplayerPacket extends JsonCompatibleValue> =
    /** Sent from child clients to the host as actions happen. */
    | {
          type: P2pLockStepMessageType.Actions;
          sourceClientId: ClientId;
          actions: MultiplayerPacket[];
      }

    /** Sent from the host to clients when a frame is ready. */
    | ({
          type: P2pLockStepMessageType.Frame;
          packets: MultiplayerFramePacket<MultiplayerPacket>[];
      } & PartialWithUndefined<{
          /** Whether this frame is meant for syncing a new client. */
          isSynchronizationFrame: boolean;
          /**
           * Whether every peer should hash its state right after applying this frame, for a later
           * desync check.
           */
          shouldReportNextFrameHash: boolean;
          /** The host's state hash from right after the most recent desync check frame. */
          stateHash: number;
          /** On synchronization frames, the host's state for the receiving client to load. */
          stateSync: JsonCompatibleValue;
      }>)

    /** Sent from a child client to the host to ask for the host's current state. */
    | {
          type: P2pLockStepMessageType.StateSyncRequest;
      };

/**
 * Each {@link P2pLockStepMessage} variant, keyed by its message type.
 *
 * @category Internal
 */
export type P2pLockStepMessageByType<MultiplayerPacket extends JsonCompatibleValue> = {
    [Type in P2pLockStepMessageType]: Readonly<
        Extract<
            P2pLockStepMessage<MultiplayerPacket>,
            {
                type: Type;
            }
        >
    >;
};

/**
 * Data received from {@link MultiplayerControllerDesyncEvent}.
 *
 * @category Internal
 */
export type MultiplayerDesync = {
    hostStateHash: number;
    localStateHash: number;
};

/**
 * Constructor parameters for {@link P2pLockStepMultiplayerController}.
 *
 * @category Internal
 */
export type P2pLockStepMultiplayerControllerParams<Action extends JsonCompatibleValue> = {
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
    acceptConnection?:
        | ((
              connectingClientId: ClientId,
              multiplayerController: P2pLockStepMultiplayerController<Action>,
          ) => MaybePromise<boolean>)
        | undefined;

    /** Enables verbose multiplayer debug logs. */
    debugMultiplayer?: boolean | undefined;

    /**
     * Sends the host's state to each client that joins. When a client joins, the host's next frame
     * event has `shouldSendStateSync` set, and the host produces no more frames until that state is
     * passed to {@link P2pLockStepMultiplayerController.sendStateSync}. The joining client emits
     * {@link MultiplayerControllerStateSyncEvent} with that state, and ignores every frame before it
     * (see {@link P2pLockStepMultiplayerController.awaitingStateSync}).
     *
     * @default joining clients receive no state
     */
    enableStateSync?: boolean | undefined;

    /**
     * When `enableStateSync` is also set, a client that detects a desync asks the host for its
     * state with {@link P2pLockStepMultiplayerController.requestStateSync}.
     *
     * @default desyncs are only reported
     */
    resyncOnDesync?: boolean | undefined;

    /**
     * The duration between desync check frames, rounded to a whole number of frames. Ignored when
     * `frameDuration` is zero, because then frames only run manually. Every peer's frame event for
     * a check frame has `shouldReportNextFrameHash` set: pass the state hash from right after
     * applying that frame to {@link P2pLockStepMultiplayerController.reportStateHash}. The host
     * sends its hash with the next frame it produces, and clients compare it against their own hash
     * with {@link P2pLockStepMultiplayerController.checkStateHash} before applying that frame.
     * Frames are never held for a hash: if the host doesn't report one before its next check frame,
     * that check is skipped.
     *
     * @default no desync checks
     */
    desyncCheckInterval?: AnyDuration | undefined;

    /**
     * The duration between each frame. This should probably always be smaller than your supported
     * render frame duration.
     *
     * @default {milliseconds: 10}
     */
    frameDuration?: AnyDuration | undefined;
}>;

/**
 * This is fired whenever a new p2p-lock-step frame is received from the host client.
 *
 * @category Events
 */
export class MultiplayerControllerFrameEvent<
    MultiplayerPacket extends JsonCompatibleValue,
> extends defineTypedCustomEvent<any>()('multiplayer-controller-frame') {
    public declare detail: Readonly<MultiplayerFrame<MultiplayerPacket>>;

    constructor(
        eventInitDict: TypedCustomEventInit<Readonly<MultiplayerFrame<MultiplayerPacket>>>,
    ) {
        super(eventInitDict);
    }
}

/**
 * This is fired on a client when its state hash from a check frame does not match the host's. The
 * host's state is no more correct than the client's, so this only says that the two disagree.
 * Nothing else is done about the desync: handle it however your game needs to.
 *
 * @category Events
 */
export class MultiplayerControllerDesyncEvent extends defineTypedCustomEvent<
    Readonly<MultiplayerDesync>
>()('multiplayer-controller-desync') {}

/**
 * This is fired on a client when it receives the host's state, when it joins or after it calls
 * {@link P2pLockStepMultiplayerController.requestStateSync}. Load the state, then call
 * {@link P2pLockStepMultiplayerController.finishStateSync} before applying any later frame.
 *
 * @category Events
 */
export class MultiplayerControllerStateSyncEvent extends defineTypedCustomEvent<
    Readonly<{
        stateSync: JsonCompatibleValue;
    }>
>()('multiplayer-controller-state-sync') {}
/**
 * All events emitted by this controller.
 *
 * @category Internal
 */
export type AllP2pLockStepMultiplayerControllerEvents<
    MultiplayerPacket extends JsonCompatibleValue,
> =
    | MultiplayerControllerFrameEvent<MultiplayerPacket>
    | MultiplayerControllerDesyncEvent
    | MultiplayerControllerStateSyncEvent
    | MultiplayerControllerRoomListEvent
    | MultiplayerControllerClientStatusEvent
    | MultiplayerControllerConnectionEvent;

/**
 * Listener callback for p2p-lock-step frame events.
 *
 * @category Internal
 */
export type MultiplayerControllerFrameListener<MultiplayerPacket extends JsonCompatibleValue> = (
    event: Readonly<MultiplayerControllerFrameEvent<MultiplayerPacket>>,
) => MaybePromise<void>;

const defaultFrameDuration: AnyDuration = {
    milliseconds: 10,
};

/**
 * An all-in-one controller for singleplayer or p2p-lock-step multiplayer game state.
 *
 * @category Main
 */
export class P2pLockStepMultiplayerController<
    MultiplayerPacket extends JsonCompatibleValue = any,
> extends ListenTarget<AllP2pLockStepMultiplayerControllerEvents<MultiplayerPacket>> {
    /** The current data flow FPS. */
    public readonly currentFps: number = 0;
    /** All events emitted by this controller. */
    public static readonly events = {
        MultiplayerControllerDesyncEvent,
        MultiplayerControllerFrameEvent,
        MultiplayerControllerStateSyncEvent,
    };
    /** All events emitted by this controller. */
    public readonly events = P2pLockStepMultiplayerController.events;

    public static readonly knownErrors = {
        RoomRejectionError,
    };
    public readonly knownErrors = P2pLockStepMultiplayerController.knownErrors;

    /** Core multiplayer room controller that owns API, room polling, signaling, and transport. */
    public readonly roomController: MultiplayerRoomController<
        P2pLockStepMessage<MultiplayerPacket>
    >;
    protected readonly localClientId = createMultiplayerId.client();
    protected roomConnection:
        | MultiplayerRoomConnection<P2pLockStepMessage<MultiplayerPacket>>
        | undefined;
    protected clientsResponded: Record<ClientId, boolean> = {};
    protected frameActions: MultiplayerFramePacket<MultiplayerPacket>[] = [];
    protected timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
    protected frameTickReady = true;
    public frameMs: number;
    /** On the host, the number of frames produced. */
    protected producedFrameCount = 0;
    /** Number of frames between desync checks, or `undefined` when checks are disabled. */
    protected readonly desyncCheckFrameInterval: number | undefined;
    /** On the host, the most recent check frame event, the only one whose report is still sent. */
    protected latestCheckFrameEvent: MultiplayerControllerFrameEvent<MultiplayerPacket> | undefined;
    /** On the host, the state hash to send with the next frame. */
    protected nextFrameStateHash: number | undefined;
    /** On clients, this client's state hash from the most recent check frame. */
    protected localStateHash: number | undefined;
    /** On the host, clients whose state sync will be requested by the next frame. */
    protected stateSyncRequestClientIds: ClientId[] = [];
    /** On the host, clients waiting for {@link P2pLockStepMultiplayerController.sendStateSync}. */
    protected stateSyncFrameClientIds: ClientId[] = [];
    /**
     * Whether this client is waiting for the host's state, after joining a room with
     * `enableStateSync` set or after {@link P2pLockStepMultiplayerController.requestStateSync}.
     * Frame events received while waiting should not be applied: the host's state already includes
     * them. Desync checks are skipped while waiting.
     */
    public awaitingStateSync = false;
    protected joiningRoom = false;
    protected lastFpsCalculation = {
        timestamp: 0,
        frameCount: 0,
    };
    protected singleplayer = false;

    constructor(
        protected readonly params: P2pLockStepMultiplayerControllerParams<MultiplayerPacket>,
    ) {
        super();
        this.debugLog(`constructing controller for game '${params.gameId}'`);
        const frameDuration = params.frameDuration || defaultFrameDuration;
        this.frameMs = convertDuration(frameDuration, {
            milliseconds: true,
        }).milliseconds;
        this.desyncCheckFrameInterval =
            params.desyncCheckInterval && this.frameMs
                ? Math.max(
                      1,
                      Math.round(
                          convertDuration(params.desyncCheckInterval, {
                              milliseconds: true,
                          }).milliseconds / this.frameMs,
                      ),
                  )
                : undefined;
        this.roomController = new MultiplayerRoomController<P2pLockStepMessage<MultiplayerPacket>>({
            gameId: params.gameId,
            clientId: this.localClientId,
            acceptConnection: params.acceptConnection
                ? (connectingClientId) => {
                      this.debugLog(`checking incoming connection from ${connectingClientId}`);
                      return params.acceptConnection?.(connectingClientId, this) ?? true;
                  }
                : undefined,
        });
        this.listenToRoomController();
    }

    /** Current p2p-lock-step connection, exposed for compatibility checks. */
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

    /** Initialize multiplayer API access without opening a room or starting host pings. */
    public async initMultiplayer(params: Readonly<MultiplayerInitParams>) {
        this.debugLog(`initializing multiplayer with backend ${params.backendOrigin}`);
        await this.roomController.initMultiplayer(params);
        this.debugLog('multiplayer API initialized');
    }

    /** Start local play without contacting the multiplayer API. This can later open into a room. */
    public startSingleplayer() {
        if (this.currentConnection) {
            throw new Error('Cannot start singleplayer with a connection already present.');
        }

        this.debugLog('starting singleplayer connection');
        this.resetStateSync();
        this.singleplayer = true;
        this.finishFrame();
        this.dispatch(
            new MultiplayerControllerConnectionEvent({
                detail: {
                    ...emptyApiAndRoomConnectionState,
                    api: MultiplayerConnectionState.Connected,
                },
            }),
        );
        this.debugLog(
            `singleplayer connection ready with client ${this.getClientId() || 'unknown'}`,
        );
    }

    /**
     * Manually run the next frame.
     *
     * @throws Error if `frameDuration` has been set.
     */
    public runFrame(actions?: ReadonlyArray<MultiplayerPacket> | undefined) {
        this.debugLog(`runFrame called with ${actions?.length || 0} actions`);

        if (actions) {
            this.act(actions);
        }

        if (this.isHost()) {
            this.frameTickReady = true;
            this.maybeFinishFrame();
        }
    }

    /** The current FPS of the data flow. */
    public getFps(): number {
        return this.currentFps;
    }

    /** Fire an action. This will be sent to all clients in the room so they can process it. */
    public act(actions: MultiplayerPacket | ReadonlyArray<MultiplayerPacket>) {
        if (!this.currentConnection || !this.currentConnection.isConnected()) {
            throw new Error('Cannot perform action: not connected to a room.');
        }

        const actionArray = ensureArray<MultiplayerPacket>(actions);
        this.debugLog(`act called with ${actionArray.length} actions`);
        this.frameActions = [
            ...this.frameActions,
            ...actionArray.map((packet): MultiplayerFramePacket<MultiplayerPacket> => {
                return {
                    sourceClientId: this.clientId,
                    packet,
                };
            }),
        ];
    }

    /**
     * Call on every peer right after applying a frame event whose `shouldReportNextFrameHash` is
     * set. The host sends the hash with its next frame, unless a newer check frame has already been
     * sent. Clients keep the hash for {@link P2pLockStepMultiplayerController.checkStateHash}. Pass
     * `undefined` when there's no state to hash yet, which skips this check.
     */
    public reportStateHash({
        frameEvent,
        stateHash,
    }: Readonly<{
        frameEvent: Readonly<MultiplayerControllerFrameEvent<MultiplayerPacket>>;
        stateHash: number | undefined;
    }>) {
        if (this.awaitingStateSync) {
            return;
        } else if (!this.isHost()) {
            this.localStateHash = stateHash;
        } else if (frameEvent === this.latestCheckFrameEvent) {
            this.latestCheckFrameEvent = undefined;
            this.nextFrameStateHash = stateHash;
        }
    }

    /**
     * Call on clients right before applying a frame event. When the event carries the host's state
     * hash, this compares it against this client's latest reported hash, then logs a warning and
     * emits {@link MultiplayerControllerDesyncEvent} if they differ.
     */
    public checkStateHash(
        frameEvent: Readonly<MultiplayerControllerFrameEvent<MultiplayerPacket>>,
    ) {
        if (
            this.awaitingStateSync ||
            frameEvent.detail.hostStateHash == undefined ||
            this.localStateHash == undefined ||
            frameEvent.detail.hostStateHash === this.localStateHash
        ) {
            return;
        }

        const desync: MultiplayerDesync = {
            hostStateHash: frameEvent.detail.hostStateHash,
            localStateHash: this.localStateHash,
        };

        log.warning(
            `[multiplayer] Desync detected: local state hash ${desync.localStateHash} does not match host state hash ${desync.hostStateHash}.`,
        );
        this.dispatch(
            new MultiplayerControllerDesyncEvent({
                detail: desync,
            }),
        );

        if (this.params.resyncOnDesync) {
            this.requestStateSync();
        }
    }

    /**
     * On clients, asks the host for its current state, which arrives as a
     * {@link MultiplayerControllerStateSyncEvent}. Requires `enableStateSync`. Does nothing on the
     * host or while already waiting.
     */
    public requestStateSync() {
        if (!this.params.enableStateSync || this.isHost() || this.awaitingStateSync) {
            return;
        }

        this.debugLog('requesting state sync from host');
        this.awaitingStateSync = true;
        this.localStateHash = undefined;
        this.roomConnection?.sendMessage({
            type: P2pLockStepMessageType.StateSyncRequest,
        });
    }

    /**
     * Call on clients right after loading the state from a
     * {@link MultiplayerControllerStateSyncEvent}, so that later frames are applied again.
     */
    public finishStateSync() {
        this.awaitingStateSync = false;
        this.localStateHash = undefined;
    }

    /**
     * Call on the host right after applying a frame event whose `shouldSendStateSync` is set. Sends
     * the state to every client waiting for it, then resumes frame production.
     */
    public sendStateSync(stateSync: JsonCompatibleValue) {
        const connectedClientIds = this.getConnectedClientIds();

        this.stateSyncFrameClientIds
            .filter((clientId) => {
                return connectedClientIds.includes(clientId);
            })
            .forEach((clientId) => {
                this.debugLog(`sending state sync to ${clientId}`);
                this.roomConnection?.sendToOnlyOneClient(clientId, {
                    type: P2pLockStepMessageType.Frame,
                    packets: [],
                    isSynchronizationFrame: true,
                    stateSync,
                });
            });
        this.stateSyncFrameClientIds = [];
        this.maybeFinishFrame();
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
        this.debugLog('destroying controller');
        globalThis.clearTimeout(this.timeoutId);
        this.roomConnection = undefined;
        this.singleplayer = false;
        this.roomController.destroy();
        super.destroy();
    }

    /** Join or create a room. */
    public async joinOrCreateRoom(room: Readonly<RoomInput>) {
        const previousRoomConnection = this.roomConnection;
        const wasSingleplayer = this.singleplayer;

        this.debugLog(`joining or creating room '${room.roomName}' (${room.roomId})`);

        this.joiningRoom = true;
        try {
            const roomConnection = await this.joinRoom({
                previousRoomConnection,
                room,
            });

            this.resetDesyncCheck();
            this.resetStateSync();
            if (previousRoomConnection) {
                globalThis.clearTimeout(this.timeoutId);
                this.clientsResponded = {};
                this.frameActions = [];
                this.frameTickReady = true;
            } else if (wasSingleplayer) {
                globalThis.clearTimeout(this.timeoutId);
                this.frameTickReady = true;
            }
            this.singleplayer = false;
            this.awaitingStateSync = !!this.params.enableStateSync && !roomConnection.isHost();
            this.attachMultiplayerRoomConnection(roomConnection);
            this.debugLog(
                `attached p2p-lock-step connection; client=${this.getClientId() || 'unknown'} host=${this.isHost()} connected=${this.isConnected()}`,
            );
        } finally {
            this.joiningRoom = false;
        }
    }

    /** Join through the core room controller while preserving the wrapper connection on failure. */
    protected async joinRoom({
        previousRoomConnection,
        room,
    }: Readonly<{
        previousRoomConnection:
            | MultiplayerRoomConnection<P2pLockStepMessage<MultiplayerPacket>>
            | undefined;
        room: Readonly<RoomInput>;
    }>) {
        try {
            await this.roomController.joinOrCreateRoom(room);
            this.debugLog(
                `room controller joined room '${room.roomName}' (${room.roomId}); client=${this.roomController.getClientId() || 'unknown'} host=${this.roomController.isHost()}`,
            );
            if (!this.roomController.currentConnection) {
                throw new Error(
                    'Cannot start p2p-lock-step multiplayer: room connection is missing.',
                );
            }

            return this.roomController.currentConnection;
        } catch (error: unknown) {
            this.debugLog(`join room failed: ${String(error)}`);
            this.roomConnection = previousRoomConnection;
            throw error;
        }
    }

    /** Leave the current room or single player connection. */
    public leaveRoom() {
        if (!this.currentConnection) {
            this.debugLog('leaveRoom called without a current connection');
            return;
        }

        this.debugLog(`leaving room '${this.roomId || 'unknown'}'`);
        globalThis.clearTimeout(this.timeoutId);
        this.resetStateSync();
        this.roomConnection = undefined;
        this.singleplayer = false;
        this.roomController.leaveRoom();
    }

    /** Forward core room-controller events into this frame-sync controller. */
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
            if ('newMember' in event.detail) {
                this.syncNewMember(event.detail.newMember);
            } else if ('newHost' in event.detail) {
                this.handleNewHost(event.detail.newHost);
            }
            this.dispatch(event);
        });
        this.roomController.listen(
            MultiplayerControllerMessageEvent<P2pLockStepMessage<MultiplayerPacket>>,
            (event) => {
                this.debugLog(
                    `message event received from ${event.sourceClientId}: type=${event.detail.type}`,
                );
                this.handleReceivedMessage(event.sourceClientId, event.detail);
            },
        );
    }

    /** Attach an established room transport and publish initial frame readiness. */
    protected attachMultiplayerRoomConnection(
        roomConnection: Readonly<MultiplayerRoomConnection<P2pLockStepMessage<MultiplayerPacket>>>,
    ) {
        this.debugLog(
            `attached room connection; client=${roomConnection.clientId} host=${roomConnection.isHost()} connected=${roomConnection.isConnected()} connectedClients=${roomConnection.getConnectedClientIds().length} allClients=${roomConnection.getAllClientIds().length}`,
        );
        this.roomConnection = roomConnection;
        if (roomConnection.isHost()) {
            this.finishFrame();
        } else {
            this.debugLog('attached as member; sending initial readiness actions to host');
            roomConnection.sendMessage({
                actions: [],
                sourceClientId: this.clientId,
                type: P2pLockStepMessageType.Actions,
            });
        }
    }

    /** Restart frame production if this client is promoted after losing its previous host. */
    protected handleNewHost(clientId: ClientId) {
        if (
            this.joiningRoom ||
            clientId !== this.localClientId ||
            !this.roomConnection ||
            !this.roomConnection.isHost()
        ) {
            return;
        }

        globalThis.clearTimeout(this.timeoutId);
        this.clientsResponded = {};
        this.resetDesyncCheck();
        this.resetStateSync();
        this.frameTickReady = true;
        this.finishFrame();
    }

    /**
     * Send an empty frame to a newly connected member so it can join the frame flow, or queue a
     * state sync for it when `enableStateSync` is set.
     */
    protected syncNewMember(clientId: ClientId) {
        this.debugLog(`syncNewMember called for ${clientId}; host=${this.isHost()}`);
        if (this.params.enableStateSync) {
            this.queueStateSync(clientId);
        } else if (this.roomConnection && this.isHost()) {
            this.roomConnection.sendToOnlyOneClient(clientId, {
                type: P2pLockStepMessageType.Frame,
                packets: [],
                isSynchronizationFrame: true,
            });
        }
    }

    /**
     * Per message type, whether only the host or only member clients handle it and how. Messages
     * received by the wrong side are ignored.
     */
    protected readonly messageHandlers: {
        [Type in P2pLockStepMessageType]: {
            /** Whether only the host should handle this message. */
            isForHost: boolean;
            /** Handles the message. */
            handle: (
                params: Readonly<{
                    message: P2pLockStepMessageByType<MultiplayerPacket>[Type];
                    sourceClientId: ClientId;
                }>,
            ) => void;
        };
    } = {
        [P2pLockStepMessageType.Actions]: {
            isForHost: true,
            handle: ({message, sourceClientId}) => {
                this.debugLog(
                    `host received ${message.actions.length} actions from ${sourceClientId}`,
                );
                this.clientsResponded = {
                    ...this.clientsResponded,
                    [sourceClientId]: true,
                };
                this.frameActions = [
                    ...this.frameActions,
                    ...message.actions.map((packet): MultiplayerFramePacket<MultiplayerPacket> => {
                        return {
                            sourceClientId,
                            packet,
                        };
                    }),
                ];
                this.maybeFinishFrame();
            },
        },
        [P2pLockStepMessageType.Frame]: {
            isForHost: false,
            handle: ({message}) => {
                this.debugLog(
                    `member received frame with ${message.packets.length} actions; sending ${this.frameActions.length} local actions back to host`,
                );
                const currentFrameActions = this.frameActions;
                this.frameActions = [];
                this.roomConnection?.sendMessage({
                    actions: currentFrameActions.map(({packet}) => {
                        return packet;
                    }),
                    sourceClientId: this.clientId,
                    type: P2pLockStepMessageType.Actions,
                });
                if (message.stateSync !== undefined) {
                    this.dispatch(
                        new MultiplayerControllerStateSyncEvent({
                            detail: {
                                stateSync: message.stateSync,
                            },
                        }),
                    );
                } else if (!message.isSynchronizationFrame) {
                    this.calculateFps();
                    this.dispatch(
                        new MultiplayerControllerFrameEvent({
                            detail: {
                                packets: message.packets,
                                hostStateHash: message.stateHash,
                                shouldReportNextFrameHash: message.shouldReportNextFrameHash,
                            },
                        }),
                    );
                }
            },
        },
        [P2pLockStepMessageType.StateSyncRequest]: {
            isForHost: true,
            handle: ({sourceClientId}) => {
                this.queueStateSync(sourceClientId);
            },
        },
    };

    /**
     * Route a received message to its handler in
     * {@link P2pLockStepMultiplayerController.messageHandlers}.
     */
    protected handleReceivedMessage<Type extends P2pLockStepMessageType>(
        sourceClientId: ClientId,
        message: P2pLockStepMessageByType<MultiplayerPacket>[Type],
    ) {
        this.debugLog(
            `received lock-step message from ${sourceClientId}: type=${message.type} host=${this.isHost()}`,
        );
        if (!this.roomConnection) {
            this.debugLog('ignored message because no room connection is attached');
            return;
        }

        /** Indexing by `message.type` directly loses the link between the handler and `message`. */
        const type: Type = message.type;

        if (this.messageHandlers[type].isForHost === this.isHost()) {
            this.messageHandlers[type].handle({
                message,
                sourceClientId,
            });
        }
    }

    /** On the host, queue a state sync for a client if it isn't already queued. */
    protected queueStateSync(clientId: ClientId) {
        if (
            !this.isHost() ||
            this.stateSyncRequestClientIds.includes(clientId) ||
            this.stateSyncFrameClientIds.includes(clientId)
        ) {
            return;
        }

        this.debugLog(`queueing state sync for ${clientId}`);
        this.stateSyncRequestClientIds = [
            ...this.stateSyncRequestClientIds,
            clientId,
        ];
    }

    /** Forget pending state syncs, such as when frames restart under a new host or room. */
    protected resetStateSync() {
        this.stateSyncRequestClientIds = [];
        this.stateSyncFrameClientIds = [];
        this.awaitingStateSync = false;
    }

    /** Forget pending state hashes, such as when frames restart under a new host or room. */
    protected resetDesyncCheck() {
        this.latestCheckFrameEvent = undefined;
        this.nextFrameStateHash = undefined;
        this.localStateHash = undefined;
    }

    /** Recalculate the current data-flow FPS from completed frames. */
    protected calculateFps() {
        const now = Date.now();
        const diff = Date.now() - this.lastFpsCalculation.timestamp;
        if (diff > 1000) {
            makeWritable(this).currentFps = this.lastFpsCalculation.frameCount / (diff / 1000);
            this.lastFpsCalculation = {
                frameCount: 0,
                timestamp: now,
            };
        } else {
            this.lastFpsCalculation = {
                ...this.lastFpsCalculation,
                frameCount: this.lastFpsCalculation.frameCount + 1,
            };
        }
    }

    /** Complete the current frame and schedule the next automatic frame when configured. */
    protected finishFrame() {
        const currentFrameActions = this.frameActions;
        const stateHash = this.nextFrameStateHash;
        this.frameActions = [];
        this.nextFrameStateHash = undefined;
        this.producedFrameCount++;
        const shouldReportNextFrameHash =
            !!this.desyncCheckFrameInterval &&
            !(this.producedFrameCount % this.desyncCheckFrameInterval) &&
            this.getAllClientIds().length > 1;
        const shouldSendStateSync = !!this.stateSyncRequestClientIds.length;
        this.stateSyncFrameClientIds = [
            ...this.stateSyncFrameClientIds,
            ...this.stateSyncRequestClientIds,
        ];
        this.stateSyncRequestClientIds = [];
        this.roomConnection?.sendMessage({
            type: P2pLockStepMessageType.Frame,
            packets: currentFrameActions,
            ...(shouldReportNextFrameHash && {
                shouldReportNextFrameHash,
            }),
            ...(stateHash != undefined && {
                stateHash,
            }),
        });
        const frameEvent = new MultiplayerControllerFrameEvent<MultiplayerPacket>({
            detail: {
                packets: currentFrameActions,
                shouldReportNextFrameHash,
                ...(shouldSendStateSync && {
                    shouldSendStateSync,
                }),
            },
        });
        if (shouldReportNextFrameHash) {
            this.latestCheckFrameEvent = frameEvent;
        }
        this.dispatch(frameEvent);

        this.frameTickReady = false;
        this.calculateFps();

        if (this.frameMs) {
            this.timeoutId = globalThis.setTimeout(() => {
                this.frameTickReady = true;
                this.maybeFinishFrame();
            }, this.frameMs);
        }
    }

    /** Complete a frame when this host has reached its configured readiness conditions. */
    protected maybeFinishFrame() {
        if (!this.isHost()) {
            this.debugLog('maybeFinishFrame skipped because this client is not host');
            return;
        }

        const clientsReady =
            this.singleplayer ||
            this.roomConnection?.getConnectedClientIds().every((clientId) => {
                return this.clientsResponded[clientId];
            });

        if (!this.frameTickReady || !clientsReady || this.stateSyncFrameClientIds.length) {
            this.debugLog(
                `maybeFinishFrame waiting: frameTickReady=${this.frameTickReady} clientsReady=${!!clientsReady} stateSyncs=${this.stateSyncFrameClientIds.length}`,
            );
            return;
        }
        this.finishFrame();
    }

    /** Write a multiplayer debug log when debug logging is enabled. */
    protected debugLog(message: string) {
        log.if(!!this.params.debugMultiplayer).faint(`[multiplayer] ${message}`);
    }
}
