import {
    AnthaEngine,
    ModExecutionTriggerType,
    type ModExecuteParams,
    type ModInstanceId,
} from '@antha/engine';
import {
    createMultiplayerId,
    createNewRoom,
    emptyApiAndRoomConnectionState,
    MultiplayerConnectionState,
    MultiplayerControllerClientStatusEvent,
    MultiplayerControllerConnectionEvent,
    MultiplayerControllerRoomListEvent,
    type MultiplayerClientRooms,
} from '@antha/multiplayer-core';
import {assert, assertWrap} from '@augment-vir/assert';
import {applyBrand, type JsonCompatibleValue} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {
    createAnthaMultiplayerP2pLockStepMod,
    isMultiplayerRoomConnected,
    type AnthaMultiplayerP2pLockStepState,
} from './antha-multiplayer-p2p-lock-step.mod.js';
import {
    MultiplayerControllerFrameEvent,
    P2pLockStepMultiplayerController,
} from './p2p-lock-step-multiplayer-controller.js';

type TestEngineState = Partial<AnthaMultiplayerP2pLockStepState<string>>;
type TestPacket = JsonCompatibleValue & {
    amount: number;
};
type FrameTestState = AnthaMultiplayerP2pLockStepState<TestPacket> & {
    receivedAmounts: number[];
    simulationTicks: number[];
};
type ClientEventTestEngineState = AnthaMultiplayerP2pLockStepState<string> & {
    lifecycleEventCount: number;
    statusHandlerCount: number;
};

const testEngine = new AnthaEngine();
const executeParams = {
    currentTick: 0,
    engine: testEngine,
    hostElement: document.createElement('div'),
    lastExecution: undefined,
    modInstanceId: applyBrand<ModInstanceId>('frame-handler-mod-test'),
    msSinceLastExecute: 0,
    ticksSinceLastExecute: 0,
} satisfies Omit<ModExecuteParams, 'executionTrigger' | 'state'>;

describe(createAnthaMultiplayerP2pLockStepMod.name, () => {
    it('creates the lock-step mod and mirrors controller room state', async () => {
        const mod = createAnthaMultiplayerP2pLockStepMod<string>({
            gameId: 'lock-step-mod-test',
            debugMultiplayer: false,
            acceptConnection() {
                return true;
            },
            desyncCheck: {
                createStateHash() {
                    return 0;
                },
                interval: {
                    seconds: 1,
                },
            },
        });
        const engine = new AnthaEngine<TestEngineState>({
            mods: [
                mod,
            ],
        });
        const room = createNewRoom({
            roomName: 'Room Name',
        });

        await engine.runSingleTick();
        await engine.runSingleTick();

        const multiplayerState = assertWrap.isDefined(engine.state.multiplayerP2pLockStep);
        let availableRooms: Readonly<MultiplayerClientRooms> = {};
        let receivedFrame: boolean = false;

        assert.strictEquals(mod.modName, 'antha-multiplayer-p2p-lock-step');

        multiplayerState.multiplayerController.listen(
            MultiplayerControllerRoomListEvent,
            ({detail}) => {
                availableRooms = detail;
            },
        );
        engine.listen(MultiplayerControllerFrameEvent, () => {
            receivedFrame = true;
        });

        multiplayerState.multiplayerController.startSingleplayer();
        multiplayerState.multiplayerController.dispatch(
            new MultiplayerControllerRoomListEvent({
                detail: {
                    [room.roomId]: {
                        clientCount: 1,
                        hasRoomPassword: false,
                        roomId: room.roomId,
                        roomName: room.roomName,
                    },
                },
            }),
        );

        assert.isTrue(receivedFrame);
        assert.deepEquals(
            {
                availableRooms,
                connectionState: multiplayerState.connectionState,
                isRoomConnected: isMultiplayerRoomConnected(engine.state),
            },
            {
                availableRooms: {
                    [room.roomId]: {
                        clientCount: 1,
                        hasRoomPassword: false,
                        roomId: room.roomId,
                        roomName: room.roomName,
                    },
                },
                connectionState: {
                    api: MultiplayerConnectionState.Connected,
                    room: MultiplayerConnectionState.Disconnected,
                },
                isRoomConnected: false,
            },
        );

        await engine.reset();
    });

    it('uses default options and ignores events after state is removed', async () => {
        const mod = createAnthaMultiplayerP2pLockStepMod<string>();
        const engine = new AnthaEngine<TestEngineState>({
            mods: [
                mod,
            ],
        });

        await engine.runSingleTick();

        const multiplayerState = assertWrap.isDefined(engine.state.multiplayerP2pLockStep);
        delete engine.state.multiplayerP2pLockStep;

        multiplayerState.multiplayerController.dispatch(
            new MultiplayerControllerConnectionEvent({
                detail: {
                    api: MultiplayerConnectionState.Connected,
                    room: MultiplayerConnectionState.Disconnected,
                },
            }),
        );
        multiplayerState.multiplayerController.dispatch(
            new MultiplayerControllerRoomListEvent({
                detail: {},
            }),
        );

        assert.isUndefined(engine.state.multiplayerP2pLockStep);

        await engine.reset();
    });

    it('forwards client events from the p2p-lock-step controller', async () => {
        const engine = new AnthaEngine<ClientEventTestEngineState>({
            initState: {
                lifecycleEventCount: 0,
            },
            mods: [
                createAnthaMultiplayerP2pLockStepMod<string>({
                    gameId: 'client-event-mod-test',
                }),
            ],
        });

        engine.listen(MultiplayerControllerClientStatusEvent, () => {
            engine.state.lifecycleEventCount = (engine.state.lifecycleEventCount || 0) + 1;
        });
        await engine.runSingleTick();
        assertWrap.isDefined(engine.state.multiplayerP2pLockStep).multiplayerController.dispatch(
            new MultiplayerControllerClientStatusEvent({
                detail: {
                    newMember: createMultiplayerId.client(),
                },
            }),
        );
        await engine.runSingleTick();

        assert.strictEquals(engine.state.lifecycleEventCount, 1);

        await engine.reset();
    });

    it('handles client status events through the lock-step mod', async () => {
        const engine = new AnthaEngine<ClientEventTestEngineState>({
            initState: {
                lifecycleEventCount: 0,
                statusHandlerCount: 0,
            },
            mods: [
                createAnthaMultiplayerP2pLockStepMod<string, ClientEventTestEngineState>({
                    gameId: 'client-status-handler-mod-test',
                    handleClientStatus({event, state}) {
                        if ('newMember' in event.detail) {
                            state.statusHandlerCount = (state.statusHandlerCount || 0) + 1;
                        }
                    },
                }),
            ],
        });

        await engine.runSingleTick();
        assertWrap.isDefined(engine.state.multiplayerP2pLockStep).multiplayerController.dispatch(
            new MultiplayerControllerClientStatusEvent({
                detail: {
                    newMember: createMultiplayerId.client(),
                },
            }),
        );
        await engine.runSingleTick();

        assert.strictEquals(engine.state.statusHandlerCount, 1);

        await engine.reset();
    });

    it('ignores frame events when frame handlers are not configured', async () => {
        const multiplayerController = new P2pLockStepMultiplayerController<string>({
            gameId: 'lock-step-no-frame-handler-test',
        });
        const mod = createAnthaMultiplayerP2pLockStepMod<string>();
        const state: Partial<TestEngineState> = {
            multiplayerLockstepTick: 0,
            multiplayerP2pLockStep: {
                connectionState: emptyApiAndRoomConnectionState,
                multiplayerController,
            },
        };

        await mod.execute({
            ...executeParams,
            executionTrigger: {
                events: [
                    new MultiplayerControllerFrameEvent<string>({
                        detail: {
                            packets: [
                                {
                                    packet: 'test-frame',
                                    sourceClientId: createMultiplayerId.client(),
                                },
                            ],
                        },
                    }),
                ],
                type: ModExecutionTriggerType.Event,
            },
            state,
        });

        assert.strictEquals(state.multiplayerLockstepTick, 0);
        multiplayerController.destroy();
    });

    it('ignores queued frames after client status handling removes the controller', async () => {
        const multiplayerController = new P2pLockStepMultiplayerController<string>({
            gameId: 'lock-step-event-removal-test',
        });
        const state: Partial<ClientEventTestEngineState> = {
            multiplayerLockstepTick: 0,
            multiplayerP2pLockStep: {
                connectionState: emptyApiAndRoomConnectionState,
                multiplayerController,
            },
            statusHandlerCount: 0,
        };
        const mod = createAnthaMultiplayerP2pLockStepMod<string, ClientEventTestEngineState>({
            handleClientStatus({state}) {
                state.statusHandlerCount = (state.statusHandlerCount || 0) + 1;
                delete state.multiplayerP2pLockStep;
            },
            handlePacket() {},
        });

        await mod.execute({
            ...executeParams,
            executionTrigger: {
                events: [
                    new MultiplayerControllerClientStatusEvent({
                        detail: {
                            newMember: createMultiplayerId.client(),
                        },
                    }),
                    new MultiplayerControllerFrameEvent<string>({
                        detail: {
                            packets: [
                                {
                                    packet: 'test-frame',
                                    sourceClientId: createMultiplayerId.client(),
                                },
                            ],
                        },
                    }),
                ],
                type: ModExecutionTriggerType.Event,
            },
            state,
        });

        assert.deepEquals(state, {
            multiplayerLockstepTick: 0,
            statusHandlerCount: 1,
        });

        multiplayerController.destroy();
    });

    it('simulates every received frame in serial order', async () => {
        const multiplayerController = new P2pLockStepMultiplayerController<TestPacket>({
            gameId: 'frame-handler-mod-test',
        });
        Object.defineProperty(multiplayerController, 'roomId', {
            value: createMultiplayerId.room(),
        });
        const mod = createAnthaMultiplayerP2pLockStepMod<TestPacket, FrameTestState>({
            handlePacket({packet: detail, state}) {
                state.receivedAmounts = [
                    ...(state.receivedAmounts || []),
                    detail.packet.amount,
                ];
            },
            runFrameUpdate({currentTick, state}) {
                state.simulationTicks = [
                    ...(state.simulationTicks || []),
                    currentTick,
                ];
            },
        });
        const engine = new AnthaEngine<FrameTestState>({
            initState: {
                multiplayerP2pLockStep: {
                    connectionState: emptyApiAndRoomConnectionState,
                    multiplayerController,
                },
                receivedAmounts: [],
                simulationTicks: [],
            },
            mods: [
                mod,
            ],
        });
        const sourceClientId = createMultiplayerId.client();

        engine.dispatch(
            new MultiplayerControllerFrameEvent<TestPacket>({
                detail: {
                    packets: [
                        {
                            packet: {
                                amount: 1,
                            },
                            sourceClientId,
                        },
                    ],
                },
            }),
        );
        engine.dispatch(
            new MultiplayerControllerFrameEvent<TestPacket>({
                detail: {
                    packets: [
                        {
                            packet: {
                                amount: 2,
                            },
                            sourceClientId,
                        },
                    ],
                },
            }),
        );

        await engine.runSingleTick();

        assert.deepEquals(
            {
                multiplayerLockstepTick: engine.state.multiplayerLockstepTick,
                receivedAmounts: engine.state.receivedAmounts,
                simulationTicks: engine.state.simulationTicks,
            },
            {
                multiplayerLockstepTick: 2,
                receivedAmounts: [
                    1,
                    2,
                ],
                simulationTicks: [
                    1,
                    2,
                ],
            },
        );

        await engine.reset();
        multiplayerController.destroy();
    });

    it('checks host state hashes before applying frames and reports them after', async () => {
        class HashRecordingController extends P2pLockStepMultiplayerController<TestPacket> {
            public stateHashCalls: string[] = [];

            public override checkStateHash(
                frameEvent: Readonly<MultiplayerControllerFrameEvent<TestPacket>>,
            ) {
                this.stateHashCalls = [
                    ...this.stateHashCalls,
                    `check ${frameEvent.detail.hostStateHash}`,
                ];
            }

            public override reportStateHash({
                stateHash,
            }: Readonly<{
                stateHash: number | undefined;
            }>) {
                this.stateHashCalls = [
                    ...this.stateHashCalls,
                    `report ${stateHash}`,
                ];
            }
        }

        const mod = createAnthaMultiplayerP2pLockStepMod<TestPacket, FrameTestState>({
            desyncCheck: {
                createStateHash({state}) {
                    return state.receivedAmounts?.length || 0;
                },
                interval: {
                    milliseconds: 1,
                },
            },
            handlePacket({packet, state}) {
                state.receivedAmounts = [
                    ...(state.receivedAmounts || []),
                    packet.packet.amount,
                ];
            },
        });
        const multiplayerController = new HashRecordingController({
            gameId: 'desync-check-mod-test',
        });
        const sourceClientId = createMultiplayerId.client();

        await mod.execute({
            ...executeParams,
            executionTrigger: {
                events: [
                    new MultiplayerControllerFrameEvent<TestPacket>({
                        detail: {
                            packets: [
                                {
                                    packet: {
                                        amount: 1,
                                    },
                                    sourceClientId,
                                },
                            ],
                            shouldReportNextFrameHash: true,
                        },
                    }),
                    new MultiplayerControllerFrameEvent<TestPacket>({
                        detail: {
                            packets: [
                                {
                                    packet: {
                                        amount: 2,
                                    },
                                    sourceClientId,
                                },
                            ],
                            hostStateHash: 1,
                            shouldReportNextFrameHash: true,
                        },
                    }),
                    new MultiplayerControllerFrameEvent<TestPacket>({
                        detail: {
                            packets: [],
                        },
                    }),
                ],
                type: ModExecutionTriggerType.Event,
            },
            state: {
                multiplayerP2pLockStep: {
                    connectionState: emptyApiAndRoomConnectionState,
                    multiplayerController,
                },
            },
        });

        assert.deepEquals(multiplayerController.stateHashCalls, [
            'check undefined',
            'report 1',
            'check 1',
            'report 2',
            'check undefined',
        ]);
        multiplayerController.destroy();
    });

    it('runs frame updates without a connected room', async () => {
        let frameUpdateCount = 0;
        const mod = createAnthaMultiplayerP2pLockStepMod<TestPacket, FrameTestState>({
            handlePacket() {},
            runFrameUpdate() {
                frameUpdateCount++;
            },
        });
        const multiplayerController = new P2pLockStepMultiplayerController<TestPacket>({
            gameId: 'frame-handler-mod-test',
        });
        const frameEvent = new MultiplayerControllerFrameEvent<TestPacket>({
            detail: {
                packets: [],
            },
        });

        await mod.execute({
            ...executeParams,
            executionTrigger: {
                events: [
                    frameEvent,
                ],
                type: ModExecutionTriggerType.Event,
            },
            state: {
                multiplayerP2pLockStep: {
                    connectionState: emptyApiAndRoomConnectionState,
                    multiplayerController,
                },
            },
        });

        assert.strictEquals(frameUpdateCount, 1);
        multiplayerController.destroy();
    });
});
