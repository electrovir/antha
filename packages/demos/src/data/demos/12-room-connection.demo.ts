import {AnthaEngine, AnthaUi, defineAnthaMod} from '@antha/engine';
import {
    createMockRoomHandlerServerApiClient,
    createNewRoom,
    type ApiAndRoomConnectionState,
    type MultiplayerApiClient,
    type RoomInput,
} from '@antha/multiplayer-core';
import {
    createAnthaMultiplayerP2pLockStepMod,
    type AnthaMultiplayerP2pLockStepState,
} from '@antha/multiplayer-p2p-lock-step';
import {combineErrorMessages, log, type PartialWithUndefined} from '@augment-vir/common';
import {createUtcFullDate} from 'date-vir';
import {css, defineElement, html, nothing} from 'element-vir';
import {ViraError} from 'vira';
import {type AnthaDemo} from '../demo.js';

const DemoConnectionStatus = defineElement<
    {
        connectionState: Readonly<ApiAndRoomConnectionState>;
        roomName: string;
    } & PartialWithUndefined<{
        clientId: string;
        isHost: boolean;
        connectedClientCount: number;
        connectionError: string;
    }>
>()({
    tagName: 'demo-connection-status',
    styles: css`
        :host {
            display: flex;
            flex-direction: column;
            gap: 4px;
            font-family: monospace;
            padding: 16px;
        }
    `,
    render({inputs}) {
        const apiLabel =
            inputs.connectionState.api instanceof Error
                ? `Error: ${inputs.connectionState.api.message}`
                : inputs.connectionState.api;

        const roomLabel =
            inputs.connectionState.room instanceof Error
                ? `Error: ${inputs.connectionState.room.message}`
                : inputs.connectionState.room;

        const statusLines = [
            `Client ID: ${inputs.clientId || 'pending...'}`,
            `Api: ${apiLabel}`,
            `Room: ${roomLabel}`,
            `Room Name: ${inputs.roomName}`,
            `Connected Clients: ${String(inputs.connectedClientCount ?? 0)}`,
        ];

        return html`
            <strong>${inputs.isHost ? 'Host Client' : 'Member Client'}</strong>
            ${statusLines.map((line) => {
                return html`
                    <span>${line}</span>
                `;
            })}
            ${inputs.connectionError
                ? html`
                      <${ViraError}>${inputs.connectionError}</${ViraError}>
                  `
                : nothing}
        `;
    },
});

type ConnectorState = AnthaMultiplayerP2pLockStepState & {
    connectionStarted: boolean;
    connectionError: string;
};

function createConnectorMod(
    mockApiClientRef: Readonly<MultiplayerApiClient>,
    room: Readonly<RoomInput>,
) {
    return defineAnthaMod<ConnectorState>({
        modName: 'room-connector',
        async execute({state}) {
            if (!state.multiplayerP2pLockStep) {
                return 'Loading...';
            }

            const controller = state.multiplayerP2pLockStep.multiplayerController;

            if (!state.connectionStarted) {
                state.connectionStarted = true;

                await controller.initMultiplayer({
                    backendOrigin: mockApiClientRef.baseUrl,
                    multiplayerApiClient: mockApiClientRef,
                });

                try {
                    await controller.joinOrCreateRoom(room);
                } catch (error) {
                    log.error(error);
                    state.connectionError = combineErrorMessages('Failed to connect', error);
                }
            }

            const connectionState = state.multiplayerP2pLockStep.connectionState;

            return html`
                <${DemoConnectionStatus.assign({
                    connectionState,
                    roomName: room.roomName,
                    clientId: controller.getClientId(),
                    isHost: controller.isHost(),
                    connectedClientCount: controller.getAllClientIds().length,
                    connectionError: state.connectionError,
                })}></${DemoConnectionStatus}>
            `;
        },
    });
}

function createRoomClientEngine(
    mockApiClientRef: Readonly<MultiplayerApiClient>,
    room: Readonly<RoomInput>,
) {
    const multiplayerP2pLockStepMod = createAnthaMultiplayerP2pLockStepMod({
        gameId: 'room-demo',
    });
    const connectorMod = createConnectorMod(mockApiClientRef, room);

    return new AnthaEngine({
        mods: [
            connectorMod,
            multiplayerP2pLockStepMod,
        ],
    });
}

const DemoRoomConnection = defineElement()({
    tagName: 'demo-room-connection',
    state() {
        return {
            engines: undefined as
                | undefined
                | {
                      host: AnthaEngine;
                      client: AnthaEngine;
                  },
        };
    },
    styles: css`
        :host {
            display: flex;
            align-items: flex-start;
            box-sizing: border-box;
        }

        antha-ui {
            width: unset;
            height: unset;
            border: 2px solid grey;
            border-radius: 4px;
            padding: 16px;
        }
    `,
    init({state, updateState}) {
        if (!state.engines) {
            const mockApiClient = createMockRoomHandlerServerApiClient();
            const room = createNewRoom({
                roomName: 'Demo Room',
            });

            updateState({
                engines: {
                    host: createRoomClientEngine(mockApiClient, room),
                    client: createRoomClientEngine(mockApiClient, room),
                },
            });
        }
    },
    cleanup({state, updateState}) {
        void Promise.all([
            state.engines?.host.reset(),
            state.engines?.client.reset(),
        ]).then(() => {
            updateState({
                engines: undefined,
            });
        });
    },
    render({state}) {
        if (!state.engines) {
            return html`
                <p>Initializing...</p>
            `;
        }

        return html`
            <${AnthaUi.assign({
                engine: state.engines.host,
            })}></${AnthaUi}>
            <${AnthaUi.assign({
                engine: state.engines.client,
            })}></${AnthaUi}>
        `;
    },
});

export const multiplayerRoomConnectionDemo: AnthaDemo = {
    demoName: 'Multiplayer Room Connection',
    demoPathId: 'multiplayer-room-connection',
    demoSortDate: createUtcFullDate('2026-04-06'),
    element: DemoRoomConnection,
};
