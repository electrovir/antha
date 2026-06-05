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
    ensureArray,
    type JsonCompatibleValue,
    type MaybePromise,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {type AnyDuration} from 'date-vir';
import {defineTypedCustomEvent, ListenTarget} from 'typed-event-target';
import {
    P2pLockStepFrameEvent,
    P2pLockStepGameStateController,
    type P2pLockStepMessage,
} from './p2p-lock-step-controller.js';

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

    /**
     * The duration between each frame. This should probably always be smaller than your supported
     * render frame duration. If this is set to `undefined`, you'll need to manually trigger frames
     * with {@link P2pLockStepMultiplayerController.runFrame}.
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
    public declare detail: ReadonlyArray<MultiplayerPacket>;
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

/**
 * An all-in-one controller for singleplayer or p2p-lock-step multiplayer game state.
 *
 * @category Main
 */
export class P2pLockStepMultiplayerController<
    MultiplayerPacket extends JsonCompatibleValue = any,
> extends ListenTarget<AllP2pLockStepMultiplayerControllerEvents<MultiplayerPacket>> {
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
    /** Current p2p-lock-step connection. */
    public currentConnection: P2pLockStepGameStateController<MultiplayerPacket> | undefined;

    constructor(
        protected readonly params: P2pLockStepMultiplayerControllerParams<MultiplayerPacket>,
    ) {
        super();
        this.roomController = new MultiplayerRoomController<P2pLockStepMessage<MultiplayerPacket>>({
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

    /** Start multiplayer mode. This delegates API connectivity and room polling to multiplayer core. */
    public async initMultiplayer(params: Readonly<MultiplayerInitParams>) {
        await this.roomController.initMultiplayer(params);
    }

    /** Start singleplayer mode. */
    public startSingleplayer() {
        if (this.currentConnection) {
            throw new Error('Cannot start singleplayer with a connection already present.');
        }

        this.currentConnection = this.createP2pLockStepConnection(this.params.frameDuration);
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
            throw new Error('Cannot perform action: not connected to a room.');
        }

        this.currentConnection.act(ensureArray<MultiplayerPacket>(actions));
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

        const p2pLockStepConnection = this.createP2pLockStepConnection(
            this.params.frameDuration || {
                milliseconds: 10,
            },
        );
        this.currentConnection = p2pLockStepConnection;

        try {
            await this.roomController.joinOrCreateRoom(room);
            if (!this.roomController.currentConnection) {
                throw new Error(
                    'Cannot start p2p-lock-step multiplayer: room connection is missing.',
                );
            }

            p2pLockStepConnection.attachMultiplayerRoomConnection(
                this.roomController.currentConnection,
            );
        } catch (error: unknown) {
            p2pLockStepConnection.destroy();
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
            ControllerMessageEvent<P2pLockStepMessage<MultiplayerPacket>>,
            (event) => {
                this.currentConnection?.handleReceivedMessage(event.sourceClientId, event.detail);
            },
        );
    }

    private createP2pLockStepConnection(frameDuration: AnyDuration | undefined) {
        const connection = new P2pLockStepGameStateController<MultiplayerPacket>(frameDuration);
        connection.listen(P2pLockStepFrameEvent, (event) => {
            this.dispatch(
                new ControllerFrameEvent({
                    detail: event.detail,
                }),
            );
        });
        return connection;
    }
}
