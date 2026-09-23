import {defineAnthaMod, type ModExecuteParams, ModExecutionTriggerType} from '@antha/engine';
import {
    type ApiAndRoomConnectionState,
    emptyApiAndRoomConnectionState,
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
import {
    MultiplayerControllerFrameEvent,
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
>(
    options: Readonly<
        AnthaMultiplayerP2pLockStepOptions<NoInfer<MultiplayerPacket>, NoInfer<State>>
    > = {},
) {
    return defineAnthaMod<NoInfer<State>>({
        modName: 'antha-multiplayer-p2p-lock-step',
        initState: {
            debugMultiplayer: options.debugMultiplayer,
            multiplayerLockstepTick: 0,
        } satisfies Partial<AnthaMultiplayerP2pLockStepState> as Partial<NoInfer<State>>,
        trigger: options.handlePacket
            ? {
                  event: MultiplayerControllerFrameEvent,
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
                        frameDuration: options.frameDuration,
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

            if (
                (options.handlePacket || options.runFrameUpdate) &&
                executeParams.executionTrigger.type === ModExecutionTriggerType.Event
            ) {
                await awaitedBlockingMap(
                    executeParams.executionTrigger
                        .events as MultiplayerControllerFrameEvent<MultiplayerPacket>[],
                    async (event) => {
                        if (!state.multiplayerP2pLockStep?.multiplayerController) {
                            return;
                        }

                        if (options.handlePacket) {
                            for (const detail of event.detail) {
                                await options.handlePacket?.({
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
                    },
                );
            }
        },
    });
}
