import {waitUntil} from '@augment-vir/assert';
import {createUuidV4, type JsonCompatibleValue, makeWritable, type Uuid} from '@augment-vir/common';
import {type AnyDuration, convertDuration} from 'date-vir';
import {defineTypedCustomEvent, ListenTarget} from 'typed-event-target';
import {
    type RoomInput,
    type ShouldAllowConnectionCheck,
    WebrtcMultiplayerConnectionUpdateEvent,
    WebrtcMultiplayerController,
    WebrtcMultiplayerMessageEvent,
} from '../webrtc/webrtc-multiplayer-controller.js';
import {type MultiplayerApi} from './multiplayer-api.js';

/**
 * Message type for {@link LockStepMessage}.
 *
 * @category Internal
 */
export enum LockStepMessageType {
    Actions = 'actions',
    Frame = 'frame',
}

/**
 * Message for {@link LockStepGameStateController}.
 *
 * @category Internal
 */
export type LockStepMessage<Action> =
    /** Sent from child clients to the host as actions happen. */
    | {
          type: LockStepMessageType.Actions;
          sourceClientId: Uuid;
          actions: Action[];
      }
    | {
          type: LockStepMessageType.Frame;
          actions: Action[];
      };

/**
 * An event that is omitted from {@link LockStepGameStateController} when a frame is finalized.
 *
 * @category Internal
 */
export class LockStepFrameEvent<
    Action extends JsonCompatibleValue,
> extends defineTypedCustomEvent<any>()('lock-step-multiplayer-frame') {
    public declare detail: Action;
}

/**
 * A wrapper for {@link WebrtcMultiplayerController} that ensures messages are sent and arrive in a
 * lock-step fashion. Also supports singleplayer mode.
 *
 * @category Internal
 */
export class LockStepGameStateController<
    Action extends JsonCompatibleValue = any,
> extends ListenTarget<LockStepFrameEvent<Action> | WebrtcMultiplayerConnectionUpdateEvent> {
    protected webrtcController: WebrtcMultiplayerController<LockStepMessage<Action>> | undefined;
    /** The current client id. */
    public clientId;
    /** The current data flow FPS. */
    public readonly currentFps: number = 0;

    /** This is only used if the current controller is the host. */
    private clientsResponded: Record<Uuid, boolean> = {};
    private frameActions: Action[] = [];
    private timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
    private frameTickReady = true;
    private frameMs: number | undefined;
    private lastFpsCalculation = {
        timestamp: 0,
        frameCount: 0,
    };
    private singleplayer: boolean = false;

    constructor(
        frameDuration: AnyDuration | undefined,
        private readonly allowMultiplayerConnectionCheck: ShouldAllowConnectionCheck<
            LockStepGameStateController<Action>
        > = () => true,
    ) {
        super();
        this.clientId = createUuidV4();
        if (frameDuration) {
            this.frameMs = convertDuration(frameDuration, {
                milliseconds: true,
            }).milliseconds;
        }
    }

    /**
     * Get all connected client ids.
     *
     * - For host clients, this will indicate how many member clients are connected to the host
     *   client, _not_ including the host itself.
     * - For non-host clients, this will only list the host's client.
     *
     * For host clients, this does ont include the host client id whereas
     * {@link LockStepGameStateController.getAllClientIds} does.
     */
    public getConnectedClientIds(): Uuid[] {
        return this.webrtcController?.getConnectedClientIds() || [];
    }

    /**
     * Get all room client ids.
     *
     * - For host clients, this will indicate how many clients are connected to the room, including
     *   the host client itself.
     * - For non-host clients, this will only list the host's client.
     *
     * For host clients, this includes the host client id whereas
     * {@link LockStepGameStateController.getConnectedClientIds} does not.
     */
    public getAllClientIds(): Uuid[] {
        return this.webrtcController?.getAllClientIds() || [];
    }

    /** Checks if the current controller is the room host. */
    public isHost() {
        return this.singleplayer || this.webrtcController?.isHost();
    }

    /** Checks if the current controller is connected to the room. */
    public isConnected() {
        return this.singleplayer || this.webrtcController?.isConnected();
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
        this.webrtcController?.destroy();
        this.webrtcController = undefined;
        super.destroy();
    }

    /**
     * Startup the controller in singleplayer mode.
     *
     * @see {@link LockStepGameStateController.multiplayerConnect} for starting the controller in multiplayer mode.
     */
    public startSingleplayer() {
        this.singleplayer = true;
        this.finishFrame();
    }
    /**
     * Startup the controller in multiplayer mode and connect to a room.
     *
     * @returns Whether the connection was a successful or not.
     * @see {@link LockStepGameStateController.startSingleplayer} for starting the controller in singleplayer mode.
     */
    public async multiplayerConnect(
        gameId: string,
        multiplayerApi: Readonly<MultiplayerApi>,
        /**
         * - 'stun.l.google.com:19302'
         * - 'stun.stunprotocol.org'
         * - 'stun.cloudflare.com:3478'
         */
        stunServerUrls: ReadonlyArray<string>,
        multiplayerRoom: Readonly<RoomInput>,
    ): Promise<boolean> {
        const webrtcController = new WebrtcMultiplayerController<LockStepMessage<Action>>(
            gameId,
            multiplayerApi,
            stunServerUrls,
            multiplayerRoom,
            this.clientId,
            (data) => {
                return this.allowMultiplayerConnectionCheck({
                    ...data,
                    controller: this,
                });
            },
        );

        this.webrtcController = webrtcController;
        this.webrtcController.listen(WebrtcMultiplayerMessageEvent, (event) => {
            this.handleReceivedMessage(event);
        });
        this.webrtcController.listen(WebrtcMultiplayerConnectionUpdateEvent, (event) => {
            this.handleConnection(event);
        });

        await this.webrtcController.initConnection();
        const connectionResult = await waitUntil.isDefined(() => {
            const connected = webrtcController.isConnected();
            const destroyed = webrtcController.isDestroyed;

            if (!connected && !destroyed) {
                return undefined;
            } else {
                return {
                    connected,
                    destroyed,
                };
            }
        });
        if (connectionResult.destroyed) {
            this.destroy();
            return false;
        } else {
            this.finishFrame();
            return true;
        }
    }

    private handleConnection(event: WebrtcMultiplayerConnectionUpdateEvent) {
        if (this.webrtcController && this.isHost() && 'newMember' in event.detail) {
            this.webrtcController.sendToOnlyOneClient(event.detail.newMember, {
                type: LockStepMessageType.Frame,
                actions: [],
            });
        }
        this.dispatch(event);
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

    private handleReceivedMessage({
        sourceClientId,
        detail: message,
    }: WebrtcMultiplayerMessageEvent<LockStepMessage<Action>>) {
        if (!this.webrtcController) {
            return;
        }

        if (this.isHost() && message.type === LockStepMessageType.Actions) {
            this.clientsResponded[sourceClientId] = true;
            this.frameActions.push(...message.actions);
            this.maybeFinishFrame();
        } else if (!this.isHost() && message.type === LockStepMessageType.Frame) {
            const currentFrameActions = this.frameActions;
            /**
             * This must be cleared before {@link LockStepFrameEvent} is emitted in case that event
             * triggers more actions.
             */
            this.frameActions = [];
            this.calculateFps();
            this.webrtcController.sendMessage({
                actions: currentFrameActions,
                sourceClientId: this.clientId,
                type: LockStepMessageType.Actions,
            });
            this.dispatch(
                new LockStepFrameEvent<Action>({
                    detail: message.actions,
                }),
            );
        }
    }

    private finishFrame() {
        const currentFrameActions = this.frameActions;
        /**
         * This must be cleared before {@link LockStepFrameEvent} is emitted in case that event
         * triggers more actions.
         */
        this.frameActions = [];
        this.webrtcController?.sendMessage({
            type: LockStepMessageType.Frame,
            actions: currentFrameActions,
        });
        this.dispatch(
            new LockStepFrameEvent<Action>({
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
            this.webrtcController?.getConnectedClientIds().every((clientId) => {
                return this.clientsResponded[clientId];
            });

        if (
            !this.frameTickReady ||
            /** Still waiting on clients */
            !clientsReady
        ) {
            return;
        }
        this.finishFrame();
    }
}
