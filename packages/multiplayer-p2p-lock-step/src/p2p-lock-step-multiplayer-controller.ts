import {
    type ApiAndRoomConnectionState,
    type ClientId,
    ControllerClientEvent,
    ControllerConnectionEvent,
    ControllerMessageEvent,
    ControllerRoomListEvent,
    createMultiplayerId,
    emptyApiAndRoomConnectionState,
    MultiplayerConnectionState,
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
import {defineTypedCustomEvent, ListenTarget, type TypedCustomEventInit} from 'typed-event-target';

/**
 * Message type for {@link P2pLockStepMessage}.
 *
 * @category Internal
 */
export enum P2pLockStepMessageType {
    Actions = 'actions',
    Frame = 'frame',
}

/**
 * Data received from {@link ControllerFrameEvent}.
 *
 * @category Internal
 */
export type FrameEventDetail<MultiplayerPacket extends JsonCompatibleValue> = {
    packet: MultiplayerPacket;
    clientId: ClientId;
};

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
    | {
          type: P2pLockStepMessageType.Frame;
          actions: FrameEventDetail<MultiplayerPacket>[];
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
              controller: P2pLockStepMultiplayerController<Action>,
          ) => MaybePromise<boolean>)
        | undefined;

    /** Enables verbose multiplayer debug logs. */
    debugMultiplayer?: boolean | undefined;

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
export class ControllerFrameEvent<
    MultiplayerPacket extends JsonCompatibleValue,
> extends defineTypedCustomEvent<any>()('controller-frame') {
    public declare detail: ReadonlyArray<FrameEventDetail<MultiplayerPacket>>;

    constructor(
        eventInitDict: TypedCustomEventInit<ReadonlyArray<FrameEventDetail<MultiplayerPacket>>>,
    ) {
        super(eventInitDict);
    }
}
/**
 * All events emitted by this controller.
 *
 * @category Internal
 */
export type AllP2pLockStepMultiplayerControllerEvents<
    MultiplayerPacket extends JsonCompatibleValue,
> =
    | ControllerFrameEvent<MultiplayerPacket>
    | ControllerRoomListEvent
    | ControllerClientEvent
    | ControllerConnectionEvent;

export type ControllerFrameListener<MultiplayerPacket extends JsonCompatibleValue> = (
    event: Readonly<ControllerFrameEvent<MultiplayerPacket>>,
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
        ControllerFrameEvent,
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
    protected frameActions: FrameEventDetail<MultiplayerPacket>[] = [];
    protected timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
    protected frameTickReady = true;
    protected frameMs: number | undefined;
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
        this.roomController = new MultiplayerRoomController<P2pLockStepMessage<MultiplayerPacket>>({
            gameId: params.gameId,
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

    /** Start multiplayer mode. This delegates API connectivity and room polling to multiplayer core. */
    public async initMultiplayer(params: Readonly<MultiplayerInitParams>) {
        this.debugLog(`initializing multiplayer with backend ${params.backendOrigin}`);
        await this.roomController.initMultiplayer(params);
        this.debugLog('multiplayer API initialized');
    }

    /** Start singleplayer mode. */
    public startSingleplayer() {
        if (this.currentConnection) {
            throw new Error('Cannot start singleplayer with a connection already present.');
        }

        this.debugLog('starting singleplayer connection');
        this.singleplayer = true;
        this.finishFrame();
        this.dispatch(
            new ControllerConnectionEvent({
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
        if (this.frameMs != undefined) {
            throw new Error('Cannot manually run frame when frameDuration has been set.');
        }

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
            ...actionArray.map((packet) => {
                return {
                    clientId: this.clientId,
                    packet,
                };
            }),
        ];
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

    /**
     * Join or create a room.
     *
     * @throws `Error` if this controller is already connected to a room.
     */
    public async joinOrCreateRoom(room: Readonly<RoomInput>) {
        if (this.currentConnection) {
            throw new Error('Cannot join room: connection already established.');
        }

        this.debugLog(`joining or creating room '${room.roomName}' (${room.roomId})`);

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

            this.attachMultiplayerRoomConnection(this.roomController.currentConnection);
            this.debugLog(
                `attached p2p-lock-step connection; client=${this.getClientId() || 'unknown'} host=${this.isHost()} connected=${this.isConnected()}`,
            );
        } catch (error: unknown) {
            this.debugLog(`join room failed: ${String(error)}`);
            this.roomConnection = undefined;
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
        this.roomConnection = undefined;
        this.singleplayer = false;
        this.roomController.leaveRoom();
    }

    protected listenToRoomController() {
        this.roomController.listen(ControllerRoomListEvent, (event) => {
            this.dispatch(event);
        });
        this.roomController.listen(ControllerConnectionEvent, (event) => {
            this.debugLog(
                `connection event received: api=${String(event.detail.api)} room=${String(event.detail.room)}`,
            );
            this.dispatch(event);
        });
        this.roomController.listen(ControllerClientEvent, (event) => {
            this.debugLog(`client event received: ${JSON.stringify(event.detail)}`);
            if ('newMember' in event.detail) {
                this.syncNewMember(event.detail.newMember);
            }
            this.dispatch(event);
        });
        this.roomController.listen(
            ControllerMessageEvent<P2pLockStepMessage<MultiplayerPacket>>,
            (event) => {
                this.debugLog(
                    `message event received from ${event.sourceClientId}: type=${event.detail.type}`,
                );
                this.handleReceivedMessage(event.sourceClientId, event.detail);
            },
        );
    }

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

    protected syncNewMember(clientId: ClientId) {
        this.debugLog(`syncNewMember called for ${clientId}; host=${this.isHost()}`);
        if (this.roomConnection && this.isHost()) {
            this.roomConnection.sendToOnlyOneClient(clientId, {
                type: P2pLockStepMessageType.Frame,
                actions: [],
            });
        }
    }

    protected handleReceivedMessage(
        sourceClientId: ClientId,
        message: Readonly<P2pLockStepMessage<MultiplayerPacket>>,
    ) {
        this.debugLog(
            `received lock-step message from ${sourceClientId}: type=${message.type} host=${this.isHost()}`,
        );
        if (!this.roomConnection) {
            this.debugLog('ignored message because no room connection is attached');
            return;
        }

        if (this.isHost() && message.type === P2pLockStepMessageType.Actions) {
            this.debugLog(`host received ${message.actions.length} actions from ${sourceClientId}`);
            this.clientsResponded = {
                ...this.clientsResponded,
                [sourceClientId]: true,
            };
            this.frameActions = [
                ...this.frameActions,
                ...message.actions.map((packet) => {
                    return {
                        clientId: sourceClientId,
                        packet,
                    };
                }),
            ];
            this.maybeFinishFrame();
        } else if (!this.isHost() && message.type === P2pLockStepMessageType.Frame) {
            this.debugLog(
                `member received frame with ${message.actions.length} actions; sending ${this.frameActions.length} local actions back to host`,
            );
            const currentFrameActions = this.frameActions;
            this.frameActions = [];
            this.calculateFps();
            this.roomConnection.sendMessage({
                actions: currentFrameActions.map(({packet}) => {
                    return packet;
                }),
                sourceClientId: this.clientId,
                type: P2pLockStepMessageType.Actions,
            });
            this.dispatch(
                new ControllerFrameEvent({
                    detail: message.actions,
                }),
            );
        }
    }

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

    protected finishFrame() {
        const currentFrameActions = this.frameActions;
        this.frameActions = [];
        this.roomConnection?.sendMessage({
            type: P2pLockStepMessageType.Frame,
            actions: currentFrameActions,
        });
        this.dispatch(
            new ControllerFrameEvent({
                detail: currentFrameActions,
            }),
        );

        this.frameTickReady = false;
        this.calculateFps();

        if (this.frameMs) {
            this.timeoutId = globalThis.setTimeout(() => {
                this.frameTickReady = true;
                this.maybeFinishFrame();
            }, this.frameMs);
        }
    }

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

        if (!this.frameTickReady || !clientsReady) {
            this.debugLog(
                `maybeFinishFrame waiting: frameTickReady=${this.frameTickReady} clientsReady=${!!clientsReady}`,
            );
            return;
        }
        this.finishFrame();
    }

    protected debugLog(message: string) {
        log.if(!!this.params.debugMultiplayer).faint(`[multiplayer] ${message}`);
    }
}
