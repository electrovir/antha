import {
    type ClientId,
    createMultiplayerId,
    type MultiplayerRoomConnection,
} from '@antha/multiplayer-core';
import {type JsonCompatibleValue, log, makeWritable} from '@augment-vir/common';
import {type AnyDuration, convertDuration} from 'date-vir';
import {defineTypedCustomEvent, ListenTarget} from 'typed-event-target';

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
 * Message for {@link P2pLockStepGameStateController}.
 *
 * @category Internal
 */
export type P2pLockStepMessage<MultiplayerPacket> =
    /** Sent from child clients to the host as actions happen. */
    | {
          type: P2pLockStepMessageType.Actions;
          sourceClientId: ClientId;
          actions: MultiplayerPacket[];
      }
    | {
          type: P2pLockStepMessageType.Frame;
          actions: MultiplayerPacket[];
      };

/**
 * An event that is emitted from {@link P2pLockStepGameStateController} when a frame is finalized.
 *
 * @category Internal
 */
export class P2pLockStepFrameEvent<
    MultiplayerPacket extends JsonCompatibleValue,
> extends defineTypedCustomEvent<any>()('p2p-lock-step-frame') {
    public declare detail: ReadonlyArray<MultiplayerPacket>;
}

/**
 * P2P lock-step frame/action synchronization. This class intentionally does not create rooms, poll
 * room lists, or perform WebRTC signaling; those transport concerns are provided by multiplayer
 * core.
 *
 * @category Internal
 */
export class P2pLockStepGameStateController<
    MultiplayerPacket extends JsonCompatibleValue = any,
> extends ListenTarget<P2pLockStepFrameEvent<MultiplayerPacket>> {
    /** The current data flow FPS. */
    public readonly currentFps: number = 0;

    protected readonly localClientId = createMultiplayerId.client();
    protected roomConnection:
        | MultiplayerRoomConnection<P2pLockStepMessage<MultiplayerPacket>>
        | undefined;
    /** This is only used if the current controller is the host. */
    protected clientsResponded: Record<ClientId, boolean> = {};
    protected frameActions: MultiplayerPacket[] = [];
    protected timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
    protected frameTickReady = true;
    protected frameMs: number | undefined;
    protected lastFpsCalculation = {
        timestamp: 0,
        frameCount: 0,
    };
    protected singleplayer = false;

    constructor(
        frameDuration: AnyDuration | undefined,
        public debugMultiplayer: boolean = false,
    ) {
        super();
        this.debugLog(
            `constructing lock-step state controller; frameDuration=${frameDuration ? JSON.stringify(frameDuration) : 'manual'}`,
        );
        if (frameDuration) {
            this.frameMs = convertDuration(frameDuration, {
                milliseconds: true,
            }).milliseconds;
        }
    }

    /** The current client id. */
    public get clientId(): ClientId {
        return this.roomConnection?.clientId || this.localClientId;
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

    /** Perform an action for the current client. */
    public act(actions: ReadonlyArray<MultiplayerPacket>) {
        this.debugLog(
            `queueing ${actions.length} actions; client=${this.clientId} host=${this.isHost()} connected=${this.isConnected()}`,
        );
        this.frameActions.push(...actions);
    }

    /**
     * Manually run the next frame.
     *
     * @throws Error if `frameDuration` has been set.
     */
    public runFrame(actions?: ReadonlyArray<MultiplayerPacket> | undefined) {
        if (this.frameMs != undefined) {
            throw new Error('Cannot manually run frame when frameDuration has been set.');
        }

        this.debugLog(
            `manual runFrame requested with ${actions?.length || 0} actions; host=${this.isHost()}`,
        );
        if (actions) {
            this.act(actions);
        }

        if (this.isHost()) {
            this.frameTickReady = true;
            this.maybeFinishFrame();
        }
    }

    /** Cleanup everything. */
    public override destroy() {
        this.debugLog('destroying lock-step state controller');
        globalThis.clearInterval(this.timeoutId);
        this.roomConnection = undefined;
        super.destroy();
    }

    /** Startup the controller in singleplayer mode. */
    public startSingleplayer() {
        this.debugLog(`starting singleplayer lock-step with local client ${this.localClientId}`);
        this.singleplayer = true;
        this.finishFrame();
    }

    /** Attach an already-connected multiplayer room transport from multiplayer core. */
    public attachMultiplayerRoomConnection(
        roomConnection: Readonly<MultiplayerRoomConnection<P2pLockStepMessage<MultiplayerPacket>>>,
    ) {
        this.roomConnection = roomConnection;
        this.debugLog(
            `attached room connection; client=${roomConnection.clientId} host=${roomConnection.isHost()} connected=${roomConnection.isConnected()} connectedClients=${roomConnection.getConnectedClientIds().length} allClients=${roomConnection.getAllClientIds().length}`,
        );
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

    /** Process a room message received from multiplayer core. */
    public handleReceivedMessage(
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
            this.clientsResponded[sourceClientId] = true;
            this.frameActions.push(...message.actions);
            this.maybeFinishFrame();
        } else if (!this.isHost() && message.type === P2pLockStepMessageType.Frame) {
            this.debugLog(
                `member received frame with ${message.actions.length} actions; sending ${this.frameActions.length} local actions back to host`,
            );
            const currentFrameActions = this.frameActions;
            this.frameActions = [];
            this.calculateFps();
            this.roomConnection.sendMessage({
                actions: currentFrameActions,
                sourceClientId: this.clientId,
                type: P2pLockStepMessageType.Actions,
            });
            this.dispatch(
                new P2pLockStepFrameEvent<MultiplayerPacket>({
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
            this.lastFpsCalculation.frameCount++;
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
            new P2pLockStepFrameEvent<MultiplayerPacket>({
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
        log.if(this.debugMultiplayer).faint(`[multiplayer] ${message}`);
    }
}
