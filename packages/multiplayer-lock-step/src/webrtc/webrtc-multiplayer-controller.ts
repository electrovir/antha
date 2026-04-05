import {assert, waitUntil} from '@augment-vir/assert';
import {
    type JsonCompatibleValue,
    type MaybePromise,
    type PartialWithUndefined,
    PromiseQueue,
    type Uuid,
    createUuidV4,
    ensureErrorAndPrependMessage,
    extractErrorMessage,
    filterMap,
    getObjectTypedValues,
    log,
    makeWritable,
    mergeDefinedProperties,
    randomString,
    stringify,
} from '@augment-vir/common';
import {type ClientWebSocket} from '@rest-vir/define-service';
import {type RequireExactlyOne} from 'type-fest';
import {ListenTarget, defineTypedCustomEvent} from 'typed-event-target';
import {type MultiplayerApi} from '../multiplayer-service/multiplayer-api.js';
import {type MultiplayerService} from '../multiplayer-service/multiplayer-service.js';
import {MultiplayerWebSocketMessageType} from './web-rtc-communication.js';
import {WebrtcConnectEvent, WebrtcController, WebrtcMessageEvent} from './webrtc-controller.js';

/**
 * An event that is omitted from {@link WebrtcController} when a WebRTC message is received.
 *
 * @category Internal
 */
export class WebrtcMultiplayerMessageEvent<
    MessageData extends JsonCompatibleValue,
> extends defineTypedCustomEvent<any>()('webrtc-multiplayer-message') {
    public declare detail: MessageData;

    constructor(
        public readonly sourceClientId: Uuid,
        detail: MessageData,
    ) {
        super({
            detail,
        });
    }
}

/**
 * Type for data in {@link WebrtcMultiplayerConnectionUpdateEvent}.
 *
 * @category Internal
 */
export type MultiplayerConnectionUpdate = RequireExactlyOne<{
    newHost: Uuid;
    newMember: Uuid;
    lostHost: Uuid;
    lostMember: Uuid;
}>;

/**
 * An event that is omitted from {@link WebrtcMultiplayerController} when the multiplayer room host
 * is updated.
 *
 * @category Internal
 */
export class WebrtcMultiplayerConnectionUpdateEvent extends defineTypedCustomEvent<MultiplayerConnectionUpdate>()(
    'webrtc-multiplayer-connection-update',
) {}

/**
 * A helper for creating a new empty room.
 *
 * @category Internal
 */
export function createNewRoom(
    params: Readonly<PartialWithUndefined<Omit<RoomInput, 'roomId'>>> = {},
): RoomInput {
    return mergeDefinedProperties<RoomInput>(
        {
            roomId: createUuidV4(),
            roomName: '',
            roomPassword: '',
        },
        params,
    );
}

/**
 * Room selection input for {@link WebrtcMultiplayerController}.
 *
 * @category Internal
 */
export type RoomInput = Pick<
    Extract<
        MultiplayerService['webSockets']['/connect']['MessageFromClientType'],
        {type: MultiplayerWebSocketMessageType.Offer}
    >,
    'roomPassword' | 'roomId' | 'roomName'
>;

/**
 * This is used to check if a new WebRTC connection should be allowed. This will only be triggered
 * on a room host client. Return `true`
 *
 * @category Internal
 */
export type ShouldAllowConnectionCheck<Controller> = (data: {
    connectingClientId: Uuid;
    controller: Controller;
}) => MaybePromise<boolean>;

/**
 * A controller that connects to the multiplayer api and establishes a WebRTC connection to the
 * selected room, or, if the room does not exist yet, creates the room and becomes the host.
 *
 * Make sure, after constructing this class, to call
 * {@link WebrtcMultiplayerController.initConnection} when you're ready to being the connection.
 *
 * @category Internal
 */
export class WebrtcMultiplayerController<
    MessageData extends JsonCompatibleValue = any,
> extends ListenTarget<
    WebrtcMultiplayerMessageEvent<MessageData> | WebrtcMultiplayerConnectionUpdateEvent
> {
    public readonly hostClientId: Uuid | undefined;

    /**
     * Connections between multiple WebRTC peers.
     *
     * A connection with the current client's id is the init connection.
     */
    private connections: Record<Uuid, WebrtcController<MessageData>> = {};
    private webSocket: ClientWebSocket<MultiplayerApi['webSockets']['/connect']> | undefined;
    private readonly clientSecret = randomString(32);
    public readonly isDestroyed = false as boolean;

    constructor(
        private readonly gameId: string,
        private readonly multiplayerApi: Readonly<MultiplayerApi>,
        /**
         * - 'stun.l.google.com:19302'
         * - 'stun.stunprotocol.org'
         * - 'stun.cloudflare.com:3478'
         */
        public readonly stunServerUrls: ReadonlyArray<string>,
        public readonly multiplayerRoom: Readonly<RoomInput>,
        /** The randomized client id for this controller and client. */
        public readonly clientId: Uuid = createUuidV4(),
        /**
         * This is fired when a WebRTC peer attempts to connect to the host client (this will only
         * be fired if your client is the host). Return `true` to accept the connection. Return
         * `false` to reject it.
         *
         * @default accept all connections
         */
        private readonly shouldAllowConnectionCheck: ShouldAllowConnectionCheck<
            WebrtcMultiplayerController<MessageData>
        > = () => true,
    ) {
        super();
    }

    /**
     * If this controller is the host, it'll behave differently:
     *
     * - Hosts hold WebRTC connections to all clients (non-hosts only hold a WebRTC connection to the
     *   host).
     * - Hosts hold a WebSocket connection to the signal server so they can receive more clients at
     *   any time.
     */
    public isHost(): boolean {
        return this.hostClientId === this.clientId;
    }

    /**
     * Get all connected client ids.
     *
     * - For host clients, this will indicate how many member clients are connected to the host
     *   client, _not_ including the host itself.
     * - For non-host clients, this will only list the host's client.
     *
     * For host clients, this does ont include the host client id whereas
     * {@link WebrtcMultiplayerController.getAllClientIds} does.
     */
    public getConnectedClientIds(): Uuid[] {
        const connectedClientIds = filterMap(
            getObjectTypedValues(this.connections),
            (connection) => connection.clientId,
            (clientId, connection) => {
                return connection.isConnected;
            },
        );

        return connectedClientIds;
    }

    /**
     * Get all room client ids.
     *
     * - For host clients, this will indicate how many clients are connected to the room, including
     *   the host client itself.
     * - For non-host clients, this will only list the host's client.
     *
     * For host clients, this includes the host client id whereas
     * {@link WebrtcMultiplayerController.getConnectedClientIds} does not.
     */
    public getAllClientIds(): Uuid[] {
        const connectedClientIds = this.getConnectedClientIds();

        const allClients = [
            ...connectedClientIds,
            ...(this.isHost() ? [this.clientId] : []),
        ];

        return allClients;
    }

    /** Indicates whether ths client is connected to a multiplayer room. */
    public isConnected(): boolean {
        return this.isHost() || !!this.getConnectedClientIds().length;
    }

    /** Destroy this controller and clean everything up. */
    public override destroy() {
        makeWritable(this).isDestroyed = true;
        Object.values(this.connections).forEach((connection) => connection.destroy());
        void this.webSocket?.close();
        this.connectionQueue.destroy();
        super.destroy();
    }

    /**
     * Send a message to the room participants.
     *
     * - If the current client is the room host, this message is sent to all other room clients.
     * - If the current client is just a room member (not the host), the message is sent to the host.
     */
    public sendMessage(data: Readonly<MessageData>) {
        /**
         * When this client is the host, this set of connections will be the all the member clients.
         * When this client is a member client, there will only be one connection and it will be the
         * host client.
         */
        Object.values(this.connections).forEach((connection) => {
            if (!connection.isConnected) {
                return;
            }

            try {
                connection.sendMessage(data);
            } catch (error) {
                log.error(extractErrorMessage(error));
            }
        });
    }

    /** Send a message to just a single client. This is only allowed on a host client. */
    public sendToOnlyOneClient(clientId: Uuid, data: Readonly<MessageData>) {
        if (!this.isHost()) {
            log.error(new Error(`Cannot send to an individual client as not a host.`));
            return;
        }

        const client = this.connections[clientId];

        if (!client || !client.isConnected) {
            log.error(new Error(`Cannot send to missing or disconnected client ('${clientId}')`));
            return;
        }

        client.sendMessage(data);
    }

    /**
     * Call this to connect to the multiplayer server.
     *
     * @returns Whether or not the connection was initialized (it won't be initialized, for example,
     *   if the WebRTC connections already exist).
     */
    public async initConnection(): Promise<boolean> {
        if (Object.values(this.connections).length) {
            // connections already exist
            return false;
        }

        const newConnection = this.createNewConnection(this.clientId);
        const newOffer = await newConnection.createOffer(this.stunServerUrls);

        const webSocket = await this.setupWebSocket();
        const reply = await webSocket.sendAndWaitForReply({
            message: {
                messageId: createUuidV4(),
                type: MultiplayerWebSocketMessageType.Offer,
                clientId: this.clientId,
                clientSecret: this.clientSecret,
                data: newOffer,
                ...this.multiplayerRoom,
            },
            replyCheck(message) {
                return message.type === MultiplayerWebSocketMessageType.OfferResult;
            },
        });

        assert.strictEquals(reply.type, MultiplayerWebSocketMessageType.OfferResult);

        /**
         * `hostClientId` will be set by the already attached listener. We just need to wait until
         * it does, because we need to know who the host is before calling `sendHostPing`.
         */
        await waitUntil.isDefined(() => this.hostClientId);

        this.sendHostPing();

        return true;
    }

    private sendHostPing() {
        if (this.isHost() && this.webSocket) {
            this.webSocket.send({
                messageId: createUuidV4(),
                type: MultiplayerWebSocketMessageType.HostPing,
                clientCount: this.getAllClientIds().length,
                clientId: this.clientId,
                clientSecret: this.clientSecret,
                ...this.multiplayerRoom,
            });

            setTimeout(() => this.sendHostPing(), 1000);
        }
    }

    private connectionQueue = new PromiseQueue();

    private async setupWebSocket() {
        if (
            this.webSocket &&
            (this.webSocket.readyState === WebSocket.OPEN ||
                this.webSocket.readyState === WebSocket.CONNECTING)
        ) {
            return this.webSocket;
        }
        const webSocket = await this.multiplayerApi.webSockets['/connect'].connect({
            searchParams: {
                gameId: [this.gameId],
            },
            listeners: {
                message: async ({message, webSocket}) => {
                    try {
                        if (message.type === MultiplayerWebSocketMessageType.Offer) {
                            if (!this.isHost()) {
                                throw new Error(
                                    `Non-host multiplayer client received a WebRTC offer.`,
                                );
                            }
                            const baseAnswerMessageProperties = {
                                messageId: message.messageId,
                                type: MultiplayerWebSocketMessageType.Answer,
                                roomId: message.roomId,
                                roomName: message.roomName,
                                clientId: message.clientId,
                            } as const;

                            await this.connectionQueue.add(async () => {
                                if (
                                    !this.shouldAllowConnectionCheck({
                                        connectingClientId: message.clientId,
                                        controller: this,
                                    })
                                ) {
                                    log.warning('offer rejected');
                                    webSocket.send({
                                        ...baseAnswerMessageProperties,
                                        data: {
                                            rejected: true,
                                        },
                                    });
                                    return;
                                }
                                log.faint('received offer');

                                const newConnection = this.createNewConnection(message.clientId);
                                const answer = await newConnection.createAnswer(
                                    message.data,
                                    this.stunServerUrls,
                                );

                                webSocket.send({
                                    ...baseAnswerMessageProperties,
                                    data: answer,
                                });

                                await waitUntil.isTrue(() => newConnection.isConnected);
                            });
                        } else if (message.type === MultiplayerWebSocketMessageType.Answer) {
                            if (this.isHost()) {
                                throw new Error(
                                    `Host multiplayer client received a WebRTC answer.`,
                                );
                            }
                            /** A connection with the current uuid is the init connection. */
                            const initConnection = this.connections[this.clientId];

                            if ('rejected' in message.data) {
                                log.warning('offer was rejected');

                                this.destroy();
                            } else {
                                log.faint('received answer');
                                if (!initConnection) {
                                    throw new Error(
                                        'Cannot accept answer, no init connection found.',
                                    );
                                }

                                await initConnection.acceptAnswer(message.data);
                                /**
                                 * This client does not need a WebSocket connection anymore if it is
                                 * not the host.
                                 */
                                await webSocket.close();
                            }
                        } else if (message.type === MultiplayerWebSocketMessageType.OfferResult) {
                            if (message.hostClientId !== this.hostClientId) {
                                makeWritable(this).hostClientId = message.hostClientId;

                                if (this.isHost()) {
                                    const initConnection = this.connections[this.clientId];
                                    /**
                                     * Remove the init connection since it won't be used now that
                                     * this instance is the host.
                                     */
                                    delete this.connections[this.clientId];
                                    initConnection?.destroy();
                                }

                                this.dispatch(
                                    new WebrtcMultiplayerConnectionUpdateEvent({
                                        detail: {
                                            newHost: message.hostClientId,
                                        },
                                    }),
                                );
                            }
                        } else if (
                            (message.type as string) === MultiplayerWebSocketMessageType.Error
                        ) {
                            throw new Error(message.errorMessage);
                        } else {
                            throw new Error(
                                `Unexpected ${WebrtcMultiplayerController.name} WebSocket message type: ${message.type}`,
                            );
                        }
                    } catch (error) {
                        log.error(
                            ensureErrorAndPrependMessage(
                                error,
                                `WebSocket message failed: ${stringify(message)}`,
                            ),
                        );
                    }
                },
                error: (error) => {
                    log.error(error);
                },
                close: () => {
                    this.webSocket = undefined;
                },
            },
        });

        this.webSocket = webSocket;
        return webSocket;
    }

    private createNewConnection(uuid: Uuid): WebrtcController<MessageData> {
        const newController = new WebrtcController<MessageData>(uuid);
        this.connections[uuid] = newController;
        newController.listen(WebrtcConnectEvent, (event) => {
            const connectionEstablished = event.detail;

            if (connectionEstablished) {
                if (uuid !== this.clientId) {
                    this.dispatch(
                        new WebrtcMultiplayerConnectionUpdateEvent({
                            detail: {
                                newMember: uuid,
                            },
                        }),
                    );
                }
            } else {
                newController.destroy();
                delete this.connections[uuid];
                if (this.isHost()) {
                    this.dispatch(
                        new WebrtcMultiplayerConnectionUpdateEvent({
                            detail: {
                                lostMember: uuid,
                            },
                        }),
                    );
                } else {
                    this.dispatch(
                        new WebrtcMultiplayerConnectionUpdateEvent({
                            detail: {
                                lostHost: uuid,
                            },
                        }),
                    );
                    /**
                     * If this member client has lost connection to its host, we've got to get it
                     * back!
                     */
                    void this.initConnection();
                }
            }
        });
        newController.listen(WebrtcMessageEvent, (event) => {
            const sourceUuid = uuid === this.clientId ? this.hostClientId : uuid;

            if (sourceUuid) {
                this.dispatch(
                    new WebrtcMultiplayerMessageEvent<MessageData>(sourceUuid, event.detail),
                );
            }
        });

        return newController;
    }
}
