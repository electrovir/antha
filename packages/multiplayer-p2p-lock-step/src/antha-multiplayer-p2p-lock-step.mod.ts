import {defineAnthaMod, type ModExecuteParams, ModExecutionTriggerType} from '@antha/engine';
import {
    type ApiAndRoomConnectionState,
    emptyApiAndRoomConnectionState,
    MultiplayerControllerClientStatusEvent,
    MultiplayerControllerConnectionEvent,
} from '@antha/multiplayer-core';
import {
    awaitedBlockingMap,
    type JsonCompatibleValue,
    log,
    type MaybePromise,
    type PartialWithUndefined,
    type SelectFrom,
} from '@augment-vir/common';
import {type AnyDuration} from 'date-vir';
import {
    MultiplayerControllerFrameEvent,
    MultiplayerControllerStateSyncEvent,
    type MultiplayerFramePacket,
    P2pLockStepMultiplayerController,
    type P2pLockStepMultiplayerControllerParams,
} from './p2p-lock-step-multiplayer-controller.js';

/**
 * Engine state added by the p2p-lock-step multiplayer mod.
 *
 * @category Internal
 */
export type AnthaMultiplayerP2pLockStepState<MultiplayerPacket extends JsonCompatibleValue = any> =
    {
        /** Enables verbose multiplayer debug logs. */
        debugMultiplayer?: boolean | undefined;
        /** Number of completed lock-step frame updates. */
        multiplayerLockstepTick: number;
        /** P2p-lock-step controller state. */
        multiplayerP2pLockStep: {
            /** Multiplayer controller used to drive singleplayer or multiplayer frame sync. */
            multiplayerController: P2pLockStepMultiplayerController<MultiplayerPacket>;
            /** Current backend API and room connection state. */
            connectionState: ApiAndRoomConnectionState;
        };
    };

/**
 * Indicates whether a p2p-lock-step multiplayer room is currently connected.
 *
 * @category Util
 */
export function isMultiplayerRoomConnected({
    multiplayerP2pLockStep,
}: Readonly<
    Partial<SelectFrom<AnthaMultiplayerP2pLockStepState, {multiplayerP2pLockStep: true}>>
>) {
    return !!multiplayerP2pLockStep?.multiplayerController.roomId;
}

/**
 * Options for {@link createAnthaMultiplayerP2pLockStepMod}.
 *
 * @category Internal
 */
export type AnthaMultiplayerP2pLockStepOptions<
    MultiplayerPacket extends JsonCompatibleValue = any,
    State extends
        AnthaMultiplayerP2pLockStepState<MultiplayerPacket> = AnthaMultiplayerP2pLockStepState<MultiplayerPacket>,
    StateSync extends JsonCompatibleValue = JsonCompatibleValue,
> = PartialWithUndefined<
    SelectFrom<
        P2pLockStepMultiplayerControllerParams<MultiplayerPacket>,
        {
            acceptConnection: true;
            debugMultiplayer: true;
            frameDuration: true;
            gameId: true;
        }
    >
> &
    PartialWithUndefined<{
        /**
         * Enables automatic desync checks. Every `interval`, each peer hashes its state with
         * `createStateHash` right after applying the same frame, and the host sends its hash to
         * clients with a later frame. A client whose hash doesn't match logs a warning and emits
         * `MultiplayerControllerDesyncEvent` (which is forwarded to the engine). Handle that event
         * to recover from the desync.
         *
         * @default no desync checks
         */
        desyncCheck: {
            interval: AnyDuration;
            /**
             * Hashes the state that must match across peers, for example with `hashObject` from
             * `@antha/util`. Return `undefined` to skip reporting for this check, such as before a
             * joining peer has received its initial state.
             */
            createStateHash: (
                params: Readonly<{
                    state: Partial<State>;
                }>,
            ) => MaybePromise<number | undefined>;
        };
        /**
         * Sends the host's state to each peer that joins, so games don't need their own sync
         * packets. A joining peer skips every frame until its state is loaded, and desync checks
         * skip it until then too. The host pauses frames while `createStateSync` runs.
         *
         * @default joining peers receive no state
         */
        stateSync: {
            /** Called on the host, right after applying a frame, to capture the state to send. */
            createStateSync: (
                params: Readonly<{
                    state: Partial<State>;
                }>,
            ) => MaybePromise<StateSync>;
            /** Called on a joining (or resyncing) peer to replace its state with the host's. */
            loadStateSync: (
                params: Readonly<{
                    stateSync: StateSync;
                    multiplayerController: P2pLockStepMultiplayerController<MultiplayerPacket>;
                    state: Partial<State>;
                }>,
            ) => MaybePromise<void>;
            /**
             * When `desyncCheck` is also set, a peer that detects a desync reloads the host's state
             * (after `MultiplayerControllerDesyncEvent` is emitted).
             *
             * @default desyncs are only reported
             */
            resyncOnDesync?: boolean | undefined;
        };
        /** Applies an individual action from within a frame event. */
        handlePacket: (
            params: Readonly<{
                packet: Readonly<MultiplayerFramePacket<MultiplayerPacket>>;
                multiplayerController: P2pLockStepMultiplayerController<MultiplayerPacket>;
                state: Partial<State>;
            }>,
        ) => MaybePromise<void>;
        /** Called after all actions in a frame have been applied, in singleplayer and multiplayer. */
        runFrameUpdate: (
            params: Readonly<
                {
                    multiplayerFrameEvent: MultiplayerControllerFrameEvent<MultiplayerPacket>;
                } & ModExecuteParams<State>
            >,
        ) => MaybePromise<void>;
        /** Handles a client or host status change. */
        handleClientStatus: (
            params: Readonly<{
                event: Readonly<MultiplayerControllerClientStatusEvent>;
                multiplayerController: P2pLockStepMultiplayerController<MultiplayerPacket>;
                state: Partial<State>;
            }>,
        ) => MaybePromise<void>;
    }>;

/**
 * Create the engine mod that owns p2p-lock-step multiplayer state. When `handlePacket` and
 * `runFrameUpdate` are provided, the mod also applies every lock-step frame serially, preserving
 * every frame when the engine batches multiple frame events into one tick.
 *
 * @category Main
 */
export function createAnthaMultiplayerP2pLockStepMod<
    const MultiplayerPacket extends JsonCompatibleValue = any,
    State extends
        AnthaMultiplayerP2pLockStepState<MultiplayerPacket> = AnthaMultiplayerP2pLockStepState<MultiplayerPacket>,
    StateSync extends JsonCompatibleValue = JsonCompatibleValue,
>(
    options: Readonly<
        AnthaMultiplayerP2pLockStepOptions<MultiplayerPacket, NoInfer<State>, NoInfer<StateSync>>
    > = {},
) {
    const shouldHandleFrames = !!(
        options.handlePacket ||
        options.runFrameUpdate ||
        options.desyncCheck ||
        options.stateSync
    );

    return defineAnthaMod<NoInfer<State>>({
        modName: 'antha-multiplayer-p2p-lock-step',
        initState: {
            debugMultiplayer: options.debugMultiplayer,
            multiplayerLockstepTick: 0,
        } satisfies Partial<AnthaMultiplayerP2pLockStepState> as Partial<NoInfer<State>>,
        trigger:
            shouldHandleFrames || options.handleClientStatus
                ? {
                      event: [
                          ...(shouldHandleFrames
                              ? [
                                    MultiplayerControllerFrameEvent,
                                ]
                              : []),
                          ...(options.stateSync
                              ? [
                                    MultiplayerControllerStateSyncEvent,
                                ]
                              : []),
                          ...(options.handleClientStatus
                              ? [MultiplayerControllerClientStatusEvent]
                              : []),
                      ],
                      executeImmediately: true,
                  }
                : undefined,
        cleanup({state}) {
            log.if(!!state.debugMultiplayer).faint('[multiplayer] cleaning up p2p-lock-step mod');
            state.multiplayerP2pLockStep?.multiplayerController.destroy();
        },
        async execute(executeParams) {
            const {engine, state} = executeParams;

            if (!state.multiplayerP2pLockStep) {
                log.if(!!state.debugMultiplayer).faint(
                    '[multiplayer] creating p2p-lock-step mod state',
                );

                state.multiplayerP2pLockStep = {
                    multiplayerController: new P2pLockStepMultiplayerController<MultiplayerPacket>({
                        gameId: options.gameId || 'antha',
                        acceptConnection: options.acceptConnection,
                        debugMultiplayer: state.debugMultiplayer,
                        desyncCheckInterval: options.desyncCheck?.interval,
                        enableStateSync: !!options.stateSync,
                        frameDuration: options.frameDuration,
                        resyncOnDesync: options.stateSync?.resyncOnDesync,
                    }),
                    connectionState: emptyApiAndRoomConnectionState,
                };

                state.multiplayerP2pLockStep.multiplayerController.listen(
                    MultiplayerControllerConnectionEvent,
                    ({detail: newConnectionState}) => {
                        if (!state.multiplayerP2pLockStep) {
                            return;
                        }

                        log.if(!!state.debugMultiplayer).faint(
                            `[multiplayer] mod connection state updated: api=${String(newConnectionState.api)} room=${String(newConnectionState.room)}`,
                        );

                        state.multiplayerP2pLockStep.connectionState = newConnectionState;
                    },
                );
                state.multiplayerP2pLockStep.multiplayerController.listenToAll((event) => {
                    engine.dispatch(event);
                });
            }

            if (executeParams.executionTrigger.type === ModExecutionTriggerType.Event) {
                await awaitedBlockingMap(executeParams.executionTrigger.events, async (event) => {
                    if (!state.multiplayerP2pLockStep?.multiplayerController) {
                        return;
                    } else if (event instanceof MultiplayerControllerClientStatusEvent) {
                        await options.handleClientStatus?.({
                            event,
                            multiplayerController:
                                state.multiplayerP2pLockStep.multiplayerController,
                            state,
                        });
                        return;
                    } else if (event instanceof MultiplayerControllerStateSyncEvent) {
                        await options.stateSync?.loadStateSync({
                            stateSync: event.detail
                                .stateSync satisfies JsonCompatibleValue as StateSync,
                            multiplayerController:
                                state.multiplayerP2pLockStep.multiplayerController,
                            state,
                        });
                        state.multiplayerP2pLockStep.multiplayerController.finishStateSync();
                        return;
                    } else if (
                        event instanceof MultiplayerControllerFrameEvent &&
                        shouldHandleFrames &&
                        !state.multiplayerP2pLockStep.multiplayerController.awaitingStateSync
                    ) {
                        state.multiplayerP2pLockStep.multiplayerController.checkStateHash(event);

                        if (options.handlePacket) {
                            for (const detail of event.detail.packets) {
                                await options.handlePacket({
                                    packet: detail,
                                    multiplayerController:
                                        state.multiplayerP2pLockStep.multiplayerController,
                                    state,
                                });
                            }
                        }

                        state.multiplayerLockstepTick = (state.multiplayerLockstepTick || 0) + 1;
                        await options.runFrameUpdate?.({
                            ...executeParams,
                            currentTick: state.multiplayerLockstepTick,
                            executionTrigger: {
                                events: [
                                    event,
                                ],
                                type: ModExecutionTriggerType.Event,
                            },
                            /**
                             * This is a fixed duration so that clients don't get out of sync with
                             * each other. If a client is ever executing multiple events per
                             * execution, that means they got behind somehow, so we should still
                             * keep this duration fixed so that they run the same calculations as
                             * everyone else while catching up.
                             */
                            msSinceLastExecute:
                                state.multiplayerP2pLockStep.multiplayerController.frameMs,
                            multiplayerFrameEvent: event,
                            ticksSinceLastExecute: 1,
                        });

                        if (event.detail.shouldReportNextFrameHash) {
                            state.multiplayerP2pLockStep.multiplayerController.reportStateHash({
                                frameEvent: event,
                                stateHash: await options.desyncCheck?.createStateHash({
                                    state,
                                }),
                            });
                        }

                        if (event.detail.shouldSendStateSync && options.stateSync) {
                            state.multiplayerP2pLockStep.multiplayerController.sendStateSync(
                                await options.stateSync.createStateSync({
                                    state,
                                }),
                            );
                        }
                    }
                });
            }
        },
    });
}
