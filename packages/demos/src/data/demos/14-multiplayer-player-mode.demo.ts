import {
    AnthaEngine,
    AnthaUi,
    css,
    defineAnthaMod,
    defineElement,
    html,
    listen,
    nothing,
    type AnthaMod,
    type HTMLTemplateResult,
} from '@antha/engine';
import {
    ControllerClientEvent,
    ControllerConnectionEvent,
    ControllerRoomListEvent,
    createMockRoomHandlerServerApiClient,
    createNewRoom,
    type ApiAndRoomConnectionState,
    type MultiplayerApiClient,
    type MultiplayerClientRooms,
    type RoomInput,
} from '@antha/multiplayer-core';
import {
    ControllerFrameEvent,
    createAnthaMultiplayerP2pLockStepMod,
    type AnthaMultiplayerP2pLockStepState,
    type FrameEventDetail,
    type P2pLockStepMultiplayerController,
} from '@antha/multiplayer-p2p-lock-step';
import {check} from '@augment-vir/assert';
import {
    awaitedBlockingMap,
    combineErrorMessages,
    getObjectTypedValues,
    log,
    randomString,
    type MaybePromise,
    type SetRequiredAndNotNull,
} from '@augment-vir/common';
import {createUtcFullDate} from 'date-vir';
import {ViraError} from 'vira';
import {type AnthaDemo} from '../demo.js';

const roomModeSelectionGameId = 'room-mode-selection-demo';

enum RoomMode {
    Multiplayer = 'multiplayer',
    Singleplayer = 'singleplayer',
}

enum MultiplayerActionType {
    StateSync = 'state-sync',
    Click = 'click',
}

type MultiplayerAction =
    | {
          type: MultiplayerActionType.StateSync;
          currentClickCount: number;
      }
    | {
          type: MultiplayerActionType.Click;
      };

type SelectableRoomState = AnthaMultiplayerP2pLockStepState<MultiplayerAction> & {
    clickCount: number;
    roomMode: RoomMode | undefined;
    multiplayerInit: WeakMap<P2pLockStepMultiplayerController, boolean>;
};

const DemoLockStepCounter = defineElement<{
    isHost: boolean;
    p2pLockStep: Readonly<SelectableRoomState['multiplayerP2pLockStep']>;
    clickCount: number | undefined;
}>()({
    tagName: 'demo-lock-step-counter',
    styles: css`
        :host {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 4px;
        }
    `,
    render({inputs}) {
        const statusLines = [
            'Mode: lock step',
            `Authority: ${inputs.isHost ? 'this client' : 'room host'}`,
        ];

        return html`
            <span class="count">${inputs.clickCount || 0}</span>
            <button
                ${listen('click', () => {
                    inputs.p2pLockStep.multiplayerController.act({
                        type: MultiplayerActionType.Click,
                    });
                })}
            >
                Click
            </button>
            <div class="status">
                ${statusLines.map((line) => {
                    return html`
                        <span>${line}</span>
                    `;
                })}
            </div>
        `;
    },
});

const DemoModeRoomLobby = defineElement<{
    gameState: SetRequiredAndNotNull<Partial<SelectableRoomState>, 'multiplayerP2pLockStep'>;
    clickCount: number | undefined;
}>()({
    tagName: 'demo-mode-room-lobby',
    styles: css`
        :host {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 4px;
        }
    `,
    state() {
        return {
            connectionError: '',
            connectionState: undefined as ApiAndRoomConnectionState | undefined,
            joinedRoom: undefined as Readonly<RoomInput> | undefined,
            cleanup: undefined as (() => void) | undefined,
            availableRooms: {} as Readonly<MultiplayerClientRooms>,
            connectedClientCount: 0,
        };
    },
    init({inputs, updateState, state}) {
        function updateConnectedClientCount() {
            updateState({
                connectedClientCount:
                    inputs.gameState.multiplayerP2pLockStep.multiplayerController.getAllClientIds()
                        .length,
            });
        }

        const cleanupCallbacks = [
            inputs.gameState.multiplayerP2pLockStep.multiplayerController.listen(
                ControllerClientEvent,
                () => {
                    updateConnectedClientCount();
                },
            ),
            inputs.gameState.multiplayerP2pLockStep.multiplayerController.listen(
                ControllerConnectionEvent,
                (event) => {
                    updateState({
                        connectionState: event.detail,
                    });
                    updateConnectedClientCount();
                },
            ),
            inputs.gameState.multiplayerP2pLockStep.multiplayerController.listen(
                ControllerRoomListEvent,
                (event) => {
                    if (check.notDeepEquals(event.detail, state.availableRooms)) {
                        updateState({
                            availableRooms: event.detail,
                        });
                    }
                },
            ),
        ];

        updateState({
            cleanup() {
                cleanupCallbacks.forEach((callback) => callback());
            },
        });
    },
    cleanup({state, updateState}) {
        state.cleanup?.();
        updateState({
            cleanup: undefined,
        });
    },
    render({inputs, state, updateState}) {
        async function joinRoom(room: Readonly<RoomInput>) {
            try {
                await inputs.gameState.multiplayerP2pLockStep.multiplayerController.joinOrCreateRoom(
                    room,
                );
                updateState({
                    joinedRoom: room,
                    connectedClientCount:
                        inputs.gameState.multiplayerP2pLockStep.multiplayerController.getAllClientIds()
                            .length,
                });
            } catch (error) {
                log.error(error);
                updateState({
                    connectionError: combineErrorMessages('Failed to join room.', error),
                });
            }
        }

        if (state.joinedRoom) {
            const apiLabel =
                state.connectionState?.api instanceof Error
                    ? `Error: ${state.connectionState.api.message}`
                    : state.connectionState?.api;

            const roomLabel =
                state.connectionState?.room instanceof Error
                    ? `Error: ${state.connectionState.room.message}`
                    : state.connectionState?.room;

            const statusLines = [
                `Client ID: ${inputs.gameState.multiplayerP2pLockStep.multiplayerController.getClientId() || 'pending...'}`,
                `Api: ${apiLabel}`,
                `Room: ${roomLabel}`,
                `Room Name: ${state.joinedRoom.roomName}`,
                `Connected Clients: ${state.connectedClientCount}`,
            ];

            return html`
                <button
                    ${listen('click', () => {
                        inputs.gameState.multiplayerP2pLockStep.multiplayerController.leaveRoom();
                        updateState({
                            joinedRoom: undefined,
                            connectedClientCount: 0,
                        });
                    })}
                >
                    Leave Room
                </button>
                <strong>
                    ${inputs.gameState.multiplayerP2pLockStep.multiplayerController.isHost()
                        ? 'Host Client'
                        : 'Member Client'}
                </strong>
                ${statusLines.map((line) => {
                    return html`
                        <span>${line}</span>
                    `;
                })}
                <${DemoLockStepCounter.assign({
                    clickCount: inputs.clickCount,
                    isHost: inputs.gameState.multiplayerP2pLockStep.multiplayerController.isHost(),
                    p2pLockStep: inputs.gameState.multiplayerP2pLockStep,
                })}></${DemoLockStepCounter}>
                ${state.connectionError
                    ? html`
                          <${ViraError}>${state.connectionError}</${ViraError}>
                      `
                    : nothing}
            `;
        } else {
            const roomTemplates = getObjectTypedValues(
                inputs.gameState.multiplayerP2pLockStep.availableRooms,
            ).map((room) => {
                return html`
                    <tr>
                        <th>${room.roomName}</th>
                        <td>${room.clientCount}</td>
                        <td>
                            <button
                                ${listen('click', async () => {
                                    try {
                                        await joinRoom({
                                            ...room,
                                            roomPassword: '',
                                        });
                                    } catch (error) {
                                        log.error(error);
                                        updateState({
                                            connectionError: combineErrorMessages(
                                                'Failed to join room.',
                                                error,
                                            ),
                                        });
                                    }
                                })}
                            >
                                Join
                            </button>
                        </td>
                    </tr>
                `;
            });

            return html`
                <button
                    ${listen('click', async () => {
                        await joinRoom(
                            createNewRoom({
                                roomName: `My Room ${randomString(4)}`,
                            }),
                        );
                    })}
                >
                    Create Room
                </button>
                ${state.connectionError
                    ? html`
                          <${ViraError}>${state.connectionError}</${ViraError}>
                      `
                    : nothing}
                <p>Rooms</p>
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Clients</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>${roomTemplates}</tbody>
                </table>
            `;
        }
    },
});

const DemoSingleplayerStatus = defineElement<{
    gameState: SetRequiredAndNotNull<Partial<SelectableRoomState>, 'multiplayerP2pLockStep'>;
    clickCount: number | undefined;
}>()({
    tagName: 'demo-singleplayer-status',
    styles: css`
        :host {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
    `,
    render({inputs}) {
        const statusLines = [
            `Client ID: ${inputs.gameState.multiplayerP2pLockStep.multiplayerController.getClientId() || 'pending...'}`,
        ];

        return html`
            <strong>Singleplayer</strong>
            ${statusLines.map((line) => {
                return html`
                    <span>${line}</span>
                `;
            })}
            <${DemoLockStepCounter.assign({
                clickCount: inputs.clickCount,
                isHost: true,
                p2pLockStep: inputs.gameState.multiplayerP2pLockStep,
            })}></${DemoLockStepCounter}>
        `;
    },
});

const DemoModeSelection = defineElement<{
    roomMode: RoomMode | undefined;
    gameState: Partial<SelectableRoomState>;
    multiplayerApiClient: Readonly<MultiplayerApiClient>;
    /**
     * Split out of as an input separated from `gameState` so that this element re-renders if this
     * changes.
     */
    multiplayerP2pLockStep: Readonly<Partial<SelectableRoomState>['multiplayerP2pLockStep']>;
}>()({
    tagName: 'demo-mode-selection',
    render({inputs}) {
        if (inputs.roomMode) {
            return nothing;
        }
        const p2pLockStep = inputs.multiplayerP2pLockStep;

        if (!p2pLockStep) {
            return 'Loading...';
        }

        return html`
            <div class="mode-buttons">
                <button
                    ${listen('click', () => {
                        inputs.gameState.roomMode = RoomMode.Singleplayer;
                        inputs.gameState.clickCount = 0;
                        p2pLockStep.multiplayerController.startSingleplayer();
                    })}
                >
                    singleplayer
                </button>
                <button
                    ${listen('click', async () => {
                        inputs.gameState.roomMode = RoomMode.Multiplayer;
                        inputs.gameState.clickCount = 0;
                        await p2pLockStep.multiplayerController.initMultiplayer({
                            backendOrigin: inputs.multiplayerApiClient.baseUrl,
                            multiplayerApiClient: inputs.multiplayerApiClient,
                            roomUpdateInterval: {
                                seconds: 1,
                            },
                        });
                    })}
                >
                    multiplayer
                </button>
            </div>
        `;
    },
});

const DemoRoomDisplay = defineElement<{
    roomMode: RoomMode | undefined;
    clickCount: number | undefined;
    gameState: Partial<SelectableRoomState>;
    /**
     * Split out of as an input separated from `gameState` so that this element re-renders if this
     * changes.
     */
    multiplayerP2pLockStep: Readonly<Partial<SelectableRoomState>['multiplayerP2pLockStep']>;
}>()({
    tagName: 'demo-room-display',
    styles: css`
        :host {
            display: flex;
            flex-direction: column;
            gap: 16px;
            align-items: flex-start;
        }
    `,
    render({inputs}) {
        if (
            inputs.roomMode &&
            inputs.multiplayerP2pLockStep &&
            check.hasDefinedProperties(inputs.gameState, ['multiplayerP2pLockStep'])
        ) {
            const exitButton = html`
                <button
                    ${listen('click', () => {
                        inputs.gameState.clickCount = 0;
                        inputs.gameState.multiplayerP2pLockStep?.multiplayerController.leaveRoom();
                        inputs.gameState.roomMode = undefined;
                    })}
                >
                    Exit
                </button>
            `;

            const roomModeTemplate: Record<RoomMode, HTMLTemplateResult> = {
                [RoomMode.Multiplayer]: html`
                    ${exitButton}
                    <${DemoModeRoomLobby.assign({
                        gameState: inputs.gameState,
                        clickCount: inputs.clickCount,
                    })}></${DemoModeRoomLobby}>
                `,
                [RoomMode.Singleplayer]: html`
                    ${exitButton}
                    <${DemoSingleplayerStatus.assign({
                        gameState: inputs.gameState,
                        clickCount: inputs.clickCount,
                    })}></${DemoSingleplayerStatus}>
                `,
            };

            return roomModeTemplate[inputs.roomMode];
        }

        return nothing;
    },
});

const multiplayerActionReactions = {
    [MultiplayerActionType.Click]({state}) {
        state.clickCount = (state.clickCount || 0) + 1;
    },
    [MultiplayerActionType.StateSync]({detail, state}) {
        state.clickCount = detail.packet.currentClickCount;
    },
} satisfies Readonly<{
    [ActionType in MultiplayerActionType]: (
        params: Readonly<{
            detail: Readonly<
                FrameEventDetail<
                    Extract<
                        MultiplayerAction,
                        {
                            type: ActionType;
                        }
                    >
                >
            >;
            state: Partial<SelectableRoomState>;
        }>,
    ) => MaybePromise<void>;
}> as Readonly<
    Record<
        MultiplayerActionType,
        (
            params: Readonly<{
                detail: Readonly<FrameEventDetail<MultiplayerAction>>;
                state: Partial<SelectableRoomState>;
            }>,
        ) => MaybePromise<void>
    >
>;

function createRoomModeSelectionMod(
    multiplayerApiClient: Readonly<MultiplayerApiClient>,
): AnthaMod<SelectableRoomState> {
    return defineAnthaMod<SelectableRoomState>({
        modName: 'room-mode-selector',
        initState: {
            clickCount: 0,
            roomMode: undefined,
            multiplayerInit: new WeakMap(),
        },
        execute({state}) {
            if (!state.multiplayerInit) {
                return;
            }

            if (
                state.multiplayerP2pLockStep &&
                !state.multiplayerInit.get(state.multiplayerP2pLockStep.multiplayerController)
            ) {
                state.multiplayerInit.set(state.multiplayerP2pLockStep.multiplayerController, true);

                state.multiplayerP2pLockStep.multiplayerController.listen(
                    ControllerFrameEvent,
                    async (event) => {
                        await awaitedBlockingMap(event.detail, async (detail) => {
                            await multiplayerActionReactions[detail.packet.type]({
                                detail,
                                state,
                            });
                        });
                    },
                );

                state.multiplayerP2pLockStep.multiplayerController.listen(
                    ControllerClientEvent,
                    (event) => {
                        if (
                            state.multiplayerP2pLockStep?.multiplayerController.isHost() &&
                            event.detail.newMember
                        ) {
                            state.multiplayerP2pLockStep.multiplayerController.act({
                                type: MultiplayerActionType.StateSync,
                                currentClickCount: state.clickCount || 0,
                            });
                        }
                    },
                );
            }

            return html`
                <${DemoRoomDisplay.assign({
                    roomMode: state.roomMode,
                    gameState: state,
                    multiplayerP2pLockStep: state.multiplayerP2pLockStep,
                    clickCount: state.clickCount,
                })}></${DemoRoomDisplay}>

                <${DemoModeSelection.assign({
                    gameState: state,
                    multiplayerApiClient,
                    multiplayerP2pLockStep: state.multiplayerP2pLockStep,
                    roomMode: state.roomMode,
                })}></${DemoModeSelection}>
            `;
        },
    });
}

function createRoomModeEngine(multiplayerApiClient: Readonly<MultiplayerApiClient>) {
    const multiplayerP2pLockStepMod = createAnthaMultiplayerP2pLockStepMod<MultiplayerAction>({
        gameId: roomModeSelectionGameId,
    });
    const modeSelectionMod = createRoomModeSelectionMod(multiplayerApiClient);

    return new AnthaEngine({
        mods: [
            modeSelectionMod,
            multiplayerP2pLockStepMod,
        ],
    });
}

const Demo14 = defineElement()({
    tagName: 'demo-14',
    state() {
        return {
            engines: undefined as
                | {
                      clientA: AnthaEngine;
                      clientB: AnthaEngine;
                  }
                | undefined,
        };
    },
    styles: css`
        :host {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-evenly;
            align-items: flex-start;
            gap: 32px;
            padding: 32px;
            box-sizing: border-box;
        }

        ${AnthaUi} {
            width: unset;
            height: unset;
            gap: unset;
            border: 2px solid grey;
            box-sizing: border-box;
            border-radius: 4px;
            padding: 16px;
            flex-grow: 1;
            min-width: 280px;
        }
    `,
    init({state, updateState}) {
        if (!state.engines) {
            const mockMultiplayerApiClient = createMockRoomHandlerServerApiClient();

            updateState({
                engines: {
                    clientA: createRoomModeEngine(mockMultiplayerApiClient),
                    clientB: createRoomModeEngine(mockMultiplayerApiClient),
                },
            });
        }
    },
    cleanup({state, updateState}) {
        void Promise.all(Object.values(state.engines || {}).map((engine) => engine.reset())).then(
            () => {
                updateState({
                    engines: undefined,
                });
            },
        );
    },
    render({state}) {
        if (!state.engines) {
            return html`
                <p>Initializing...</p>
            `;
        }

        return html`
            <${AnthaUi.assign({
                engine: state.engines.clientA,
            })}></${AnthaUi}>
            <${AnthaUi.assign({
                engine: state.engines.clientB,
            })}></${AnthaUi}>
        `;
    },
});

export const multiplayerPlayerModeDemo: AnthaDemo = {
    demoName: 'Multiplayer Player Mode',
    demoPathId: 'multiplayer-player-mode',
    demoSortDate: createUtcFullDate('2026-06-05'),
    element: Demo14,
};
