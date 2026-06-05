import {
    type ClientId,
    createMultiplayerId,
    type MultiplayerRoomConnection,
} from '@antha/multiplayer-core';
import {type JsonCompatibleValue, makeWritable} from '@augment-vir/common';
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
export type P2pLockStepMessage<Action> =
    /** Sent from child clients to the host as actions happen. */
    | {
          type: P2pLockStepMessageType.Actions;
          sourceClientId: ClientId;
          actions: Action[];
      }
    | {
          type: P2pLockStepMessageType.Frame;
          actions: Action[];
      };

/**
 * An event that is emitted from {@link P2pLockStepGameStateController} when a frame is finalized.
 *
 * @category Internal
 */
export class P2pLockStepFrameEvent<
    Action extends JsonCompatibleValue,
> extends defineTypedCustomEvent<any>()('p2p-lock-step-frame') {
    public declare detail: ReadonlyArray<Action>;
}

/**
 * P2P lock-step frame/action synchronization. This class intentionally does not create rooms, poll
 * room lists, or perform WebRTC signaling; those transport concerns are provided by multiplayer
 * core.
 *
 * @category Internal
 */
export class P2pLockStepGameStateController<
    Action extends JsonCompatibleValue = any,
> extends ListenTarget<P2pLockStepFrameEvent<Action>> {
    /** The current data flow FPS. */
    public readonly currentFps: number = 0;

    private readonly localClientId = createMultiplayerId.client();
    private roomConnection: MultiplayerRoomConnection<P2pLockStepMessage<Action>> | undefined;
    /** This is only used if the current controller is the host. */
    private clientsResponded: Record<ClientId, boolean> = {};
    private frameActions: Action[] = [];
    private timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
    private frameTickReady = true;
    private frameMs: number | undefined;
    private lastFpsCalculation = {
        timestamp: 0,
        frameCount: 0,
    };
    private singleplayer = false;

    constructor(frameDuration: AnyDuration | undefined) {
        super();
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
    public act(actions: ReadonlyArray<Action>) {
        this.frameActions.push(...actions);
    }

    /**
     * Manually run the next frame.
     *
     * @throws Error if `frameDuration` has been set.
     */
    public runFrame(actions?: ReadonlyArray<Action> | undefined) {
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

    /** Cleanup everything. */
    public override destroy() {
        globalThis.clearInterval(this.timeoutId);
        this.roomConnection = undefined;
        super.destroy();
    }

    /** Startup the controller in singleplayer mode. */
    public startSingleplayer() {
        this.singleplayer = true;
        this.finishFrame();
    }

    /** Attach an already-connected multiplayer room transport from multiplayer core. */
    public attachMultiplayerRoomConnection(
        roomConnection: Readonly<MultiplayerRoomConnection<P2pLockStepMessage<Action>>>,
    ) {
        this.roomConnection = roomConnection;
        this.finishFrame();
    }

    /** Notify a new room member of the latest p2p-lock-step frame. */
    public syncNewMember(clientId: ClientId) {
        if (this.roomConnection && this.isHost()) {
            this.roomConnection.sendToOnlyOneClient(clientId, {
                type: P2pLockStepMessageType.Frame,
                actions: [],
            });
        }
    }

    /** Process a room message received from multiplayer core. */
    public handleReceivedMessage(
        sourceClientId: ClientId,
        message: Readonly<P2pLockStepMessage<Action>>,
    ) {
        if (!this.roomConnection) {
            return;
        }

        if (this.isHost() && message.type === P2pLockStepMessageType.Actions) {
            this.clientsResponded[sourceClientId] = true;
            this.frameActions.push(...message.actions);
            this.maybeFinishFrame();
        } else if (!this.isHost() && message.type === P2pLockStepMessageType.Frame) {
            const currentFrameActions = this.frameActions;
            this.frameActions = [];
            this.calculateFps();
            this.roomConnection.sendMessage({
                actions: currentFrameActions,
                sourceClientId: this.clientId,
                type: P2pLockStepMessageType.Actions,
            });
            this.dispatch(
                new P2pLockStepFrameEvent<Action>({
                    detail: message.actions,
                }),
            );
        }
    }

    private calculateFps() {
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

    private finishFrame() {
        const currentFrameActions = this.frameActions;
        this.frameActions = [];
        this.roomConnection?.sendMessage({
            type: P2pLockStepMessageType.Frame,
            actions: currentFrameActions,
        });
        this.dispatch(
            new P2pLockStepFrameEvent<Action>({
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

    private maybeFinishFrame() {
        if (!this.isHost()) {
            return;
        }

        const clientsReady =
            this.singleplayer ||
            this.roomConnection?.getConnectedClientIds().every((clientId) => {
                return this.clientsResponded[clientId];
            });

        if (!this.frameTickReady || !clientsReady) {
            return;
        }
        this.finishFrame();
    }
}
