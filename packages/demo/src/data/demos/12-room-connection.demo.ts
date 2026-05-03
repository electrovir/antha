import {
    AnthaEngine,
    AnthaUi,
    css,
    defineAnthaMod,
    defineElement,
    html,
    nothing,
} from '@antha/engine';
import {
    createMockRoomHandlerServerApi,
    createNewRoom,
    type MultiplayerApi,
    type RoomInput,
    type ServiceAndRoomConnectionState,
} from '@antha/multiplayer-core';
import {
    createAnthaMultiplayerLockStepMod,
    type AnthaMultiplayerLockStepState,
} from '@antha/multiplayer-lock-step';
import {combineErrorMessages, log, type PartialWithUndefined} from '@augment-vir/common';
import {createUtcFullDate} from 'date-vir';
import {type AnthaDemo} from '../demo.js';
import {ViraError} from 'vira';

const DemoConnectionStatus = defineElement<
    {
        connectionState: Readonly<ServiceAndRoomConnectionState>;
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
        const serviceLabel =
            inputs.connectionState.service instanceof Error
                ? `Error: ${inputs.connectionState.service.message}`
                : inputs.connectionState.service;

        const roomLabel =
            inputs.connectionState.room instanceof Error
                ? `Error: ${inputs.connectionState.room.message}`
                : inputs.connectionState.room;

        const statusLines = [
            `Client ID: ${inputs.clientId || 'pending...'}`,
            `Service: ${serviceLabel}`,
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

type ConnectorState = AnthaMultiplayerLockStepState & {
    connectionStarted: boolean;
    connectionError: string;
};

/**
 * Creates a mod that connects a `MultiplayerController` (from the lock step mod) to a pre-built
 * mock API. This bypasses the normal `startMultiplayer()` flow which tries to reach a real server.
 */
function createConnectorMod(mockApiRef: Readonly<MultiplayerApi>, room: Readonly<RoomInput>) {
    return defineAnthaMod<ConnectorState>({
        modName: 'room-connector',
        async execute({state}) {
            if (!state.multiplayerLockStep) {
                return 'Loading...';
            }

            const controller = state.multiplayerLockStep.multiplayerController;

            if (!state.connectionStarted) {
                state.connectionStarted = true;

                await controller.startMultiplayer({
                    backendOrigin: mockApiRef.serviceOrigin,
                    multiplayerApi: mockApiRef,
                });

                try {
                    await controller.joinOrCreateRoom(room);
                } catch (error) {
                    log.error(error);
                    state.connectionError = combineErrorMessages('Failed to connect', error);
                }
            }

            const connectionState = state.multiplayerLockStep.connectionState;

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

function createRoomClientEngine(mockApiRef: Readonly<MultiplayerApi>, room: Readonly<RoomInput>) {
    const lockStepMod = createAnthaMultiplayerLockStepMod({
        gameId: 'room-demo',
    });
    const connectorMod = createConnectorMod(mockApiRef, room);

    return new AnthaEngine({
        mods: [
            connectorMod,
            lockStepMod,
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
            const mockApi = createMockRoomHandlerServerApi();
            const room = createNewRoom({
                roomName: 'Demo Room',
            });

            updateState({
                engines: {
                    host: createRoomClientEngine(mockApi, room),
                    client: createRoomClientEngine(mockApi, room),
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
