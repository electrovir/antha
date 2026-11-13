import {assert, waitUntil} from '@augment-vir/assert';
import {
    type JsonCompatibleValue,
    type MaybePromise,
    type PartialWithUndefined,
    PromiseQueue,
    type RequireExactlyOne,
    ensureErrorAndPrependMessage,
    extractErrorMessage,
    filterMap,
    getObjectTypedValues,
    log,
    makeWritable,
    mergeDefinedProperties,
    randomString,
    removeDuplicates,
    stringify,
} from '@augment-vir/common';
import {type ClientWebSocket} from '@rest-vir/api';
import {type AnyDuration, convertDuration} from 'date-vir';
import {ListenTarget, defineTypedCustomEvent} from 'typed-event-target';
import {rejectOnAbort} from '../multiplayer-api/connection-timeout.js';
import {
    type MultiplayerConnectClientMessage,
    multiplayerConnectWebSocket,
} from '../multiplayer-api/multiplayer-api.js';
import {type MultiplayerApiClient} from '../multiplayer-api/multiplayer-client.js';
import {type ClientId, createMultiplayerId} from '../multiplayer-id.js';
import {MultiplayerWebSocketMessageType} from './web-rtc-communication.js';
import {
    MessageDelivery,
    WebrtcConnectEvent,
    WebrtcController,
    WebrtcMessageEvent,
} from './webrtc-controller.js';

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
        public readonly sourceClientId: ClientId,
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
    newHost: ClientId;
    newMember: ClientId;
    lostHost: ClientId;
    lostMember: ClientId;
    /** Sent on members each time their connection to the host opens, including after reconnects. */
    connectedToHost: ClientId;
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
            roomId: createMultiplayerId.room(),
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
    Extract<MultiplayerConnectClientMessage, {type: MultiplayerWebSocketMessageType.Offer}>,
    'roomPassword' | 'roomId' | 'roomName'
>;

/**
 * This is used to check if a new WebRTC connection should be allowed. This will only be triggered
 * on a room host client. Return `true`
 *
 * @category Internal
 */
export type ShouldAllowConnectionCheck<MultiplayerController> = (data: {
    connectingClientId: ClientId;
    multiplayerController: MultiplayerController;
}) => MaybePromise<boolean>;

/** The longest wait between reconnect attempts. */
const maxReconnectWait = {
    seconds: 30,
} as const satisfies AnyDuration;

/**
 * Resolves once the browser fires `online`, `maxWait` passes, or `abortSignal` aborts. Resolves to
 * whether `abortSignal` aborted.
 */
function waitUntilOnline({
    maxWait,
    abortSignal,
}: Readonly<{
    maxWait: Readonly<AnyDuration>;
    abortSignal: AbortSignal;
}>) {
    return new Promise<boolean>((resolve) => {
        const timeoutId = globalThis.setTimeout(
            finish,
            convertDuration(maxWait, {
                milliseconds: true,
            }).milliseconds,
        );

        function finish() {
            globalThis.clearTimeout(timeoutId);
            globalThis.removeEventListener('online', finish);
            abortSignal.removeEventListener('abort', finish);
            resolve(abortSignal.aborted);
        }

        globalThis.addEventListener('online', finish);
        abortSignal.addEventListener('abort', finish);
    });
}

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
    public readonly hostClientId: ClientId | undefined;

    /**
     * Connections between multiple WebRTC peers.
     *
     * A connection with the current client's id is the init connection.
     */
    protected connections: Record<ClientId, WebrtcController<MessageData>> = {};
    protected webSocket: ClientWebSocket<typeof multiplayerConnectWebSocket> | undefined;
    protected readonly clientSecret = randomString(32);
    public readonly isDestroyed = false as boolean;
    protected hostPingTimeoutId: ReturnType<typeof setTimeout> | undefined;
    protected hostPingAnimationFrameId: number | undefined;
    protected reconnectPromise: Promise<void> | undefined;
    protected isCleaningUpConnection = false;
    protected readonly destroyAbortController = new AbortController();

    constructor(
        protected readonly gameId: string,
        protected readonly multiplayerApiClient: Readonly<MultiplayerApiClient>,
        public readonly stunServerUrls: ReadonlyArray<string>,
        public readonly multiplayerRoom: Readonly<RoomInput>,
        /** The randomized client id for this controller and client. */
        public readonly clientId: ClientId = createMultiplayerId.client(),
        /**
         * This is fired when a WebRTC peer attempts to connect to the host client (this will only
         * be fired if your client is the host). Return `true` to accept the connection. Return
         * `false` to reject it.
         *
         * @default accept all connections
         */
        protected readonly shouldAllowConnectionCheck: ShouldAllowConnectionCheck<
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
     * On a member, treat the host as lost: drop its connection and rejoin the room, recreating it
     * if the host is gone. Does nothing on the host.
     */
    public dropHost() {
        if (!this.isHost()) {
            this.connections[this.clientId]?.handleDisconnect();
        }
    }

    /**
     * Get all connected client ids.
     *
     * - For host clients, this indicates how many member clients are connected to the host client,
     *   _not_ including the host itself.
     * - For non-host clients, this only lists the local connection used to reach the host.
     *
     * For host clients, this does ont include the host client id whereas
     * {@link WebrtcMultiplayerController.getAllClientIds} does.
     */
    public getConnectedClientIds(): ClientId[] {
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
     * - For host clients, this indicates how many clients are connected to the room, including the
     *   host client itself.
     * - For non-host clients, this includes the member client and the host client once connected.
     *
     * For host clients, this includes the host client id whereas
     * {@link WebrtcMultiplayerController.getConnectedClientIds} does not.
     */
    public getAllClientIds(): ClientId[] {
        const connectedClientIds = this.getConnectedClientIds();

        const allClients = this.isHost()
            ? [
                  ...connectedClientIds,
                  this.clientId,
              ]
            : this.hostClientId && this.isConnected()
              ? [
                    ...connectedClientIds,
                    this.clientId,
                    this.hostClientId,
                ]
              : connectedClientIds;

        return removeDuplicates(allClients);
    }

    /** Indicates whether ths client is connected to a multiplayer room. */
    public isConnected(): boolean {
        return this.isHost() || !!this.getConnectedClientIds().length;
    }

    /** Destroy this controller and clean everything up. */
    public override destroy() {
        makeWritable(this).isDestroyed = true;
        this.destroyAbortController.abort();
        this.stopHostPings();
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
    public sendMessage(
        data: Readonly<MessageData>,
        delivery: MessageDelivery = MessageDelivery.Reliable,
    ) {
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
                connection.sendMessage(data, delivery);
            } catch (error) {
                log.error(extractErrorMessage(error));
            }
        });
    }

    /** Send a message to just a single client. This is only allowed on a host client. */
    public sendToOnlyOneClient(
        clientId: ClientId,
        data: Readonly<MessageData>,
        delivery: MessageDelivery = MessageDelivery.Reliable,
    ) {
        if (!this.isHost()) {
            log.error(new Error('Cannot send to an individual client as not a host.'));
            return;
        }

        const client = this.connections[clientId];

        if (!client || !client.isConnected) {
            log.error(new Error(`Cannot send to missing or disconnected client ('${clientId}')`));
            return;
        }

        client.sendMessage(data, delivery);
    }

    /**
     * Call this to connect to the multiplayer server. Aborting `abortSignal` rejects the attempt
     * and cleans up its WebRTC connection and WebSocket.
     *
     * @returns Whether or not the connection was initialized (it won't be initialized, for example,
     *   if the WebRTC connections already exist).
     */
    public async initConnection({
        abortSignal,
    }: Readonly<
        PartialWithUndefined<{
            abortSignal: AbortSignal;
        }>
    > = {}): Promise<boolean> {
        if (Object.values(this.connections).length) {
            // connections already exist
            return false;
        }

        try {
            const newConnection = this.createNewConnection(this.clientId);
            const newOffer = await rejectOnAbort(
                newConnection.createOffer(this.stunServerUrls),
                abortSignal,
            );

            const webSocket = await this.setupWebSocket(abortSignal);
            const reply = await rejectOnAbort(
                webSocket.sendAndWaitForReply({
                    message: {
                        messageId: createMultiplayerId.socketMessage(),
                        type: MultiplayerWebSocketMessageType.Offer,
                        clientId: this.clientId,
                        clientSecret: this.clientSecret,
                        data: newOffer,
                        ...this.multiplayerRoom,
                    },
                    replyCheck(message) {
                        return message.type === MultiplayerWebSocketMessageType.OfferResult;
                    },
                }),
                abortSignal,
            );

            assert.strictEquals(reply.type, MultiplayerWebSocketMessageType.OfferResult);

            /**
             * `hostClientId` will be set by the already attached listener. We just need to wait
             * until it does, because we need to know who the host is before calling
             * `sendHostPing`.
             */
            await rejectOnAbort(
                waitUntil.isDefined(() => this.hostClientId),
                abortSignal,
            );

            this.sendHostPing();

            return true;
        } catch (error) {
            await this.destroyOwnConnection();
            throw error;
        }
    }

    /** Send the current room client count to the multiplayer server and schedule the next update. */
    protected sendHostPing() {
        if (this.isHost() && this.webSocket) {
            this.webSocket.send({
                messageId: createMultiplayerId.socketMessage(),
                type: MultiplayerWebSocketMessageType.HostPing,
                clientCount: this.getAllClientIds().length,
                clientId: this.clientId,
                clientSecret: this.clientSecret,
                ...this.multiplayerRoom,
            });

            this.hostPingTimeoutId = setTimeout(() => {
                /**
                 * Browsers stop animation frames in hidden pages but keep running timers. Waiting
                 * for one stops the pings from a hidden host, so the multiplayer server deletes its
                 * room and members can recreate it instead of rejoining the hidden host.
                 */
                this.hostPingAnimationFrameId = globalThis.requestAnimationFrame(() => {
                    this.hostPingAnimationFrameId = undefined;
                    this.sendHostPing();
                });
            }, 1000);
        }
    }

    /** Cancels the next host ping, including one waiting for an animation frame. */
    protected stopHostPings() {
        globalThis.clearTimeout(this.hostPingTimeoutId);
        this.hostPingTimeoutId = undefined;
        if (this.hostPingAnimationFrameId != undefined) {
            globalThis.cancelAnimationFrame(this.hostPingAnimationFrameId);
        }
        this.hostPingAnimationFrameId = undefined;
    }

    /**
     * Turns a host that the multiplayer server has replaced into a member of the room's new host.
     * Its own members are dropped so that they also reconnect to the new host.
     */
    protected rejoinAsMember() {
        if (!this.isHost()) {
            return;
        }

        this.stopHostPings();
        getObjectTypedValues(this.connections).forEach((connection) => {
            connection.handleDisconnect();
            connection.destroy();
        });
        /**
         * `initConnection` won't reconnect while any connection is left, even one that never
         * opened.
         */
        this.connections = {};
        /**
         * Members also get `lostHost` with their own client id, so this is dispatched while still
         * host for listeners to tell the two apart.
         */
        this.dispatch(
            new WebrtcMultiplayerConnectionUpdateEvent({
                detail: {
                    lostHost: this.clientId,
                },
            }),
        );
        makeWritable(this).hostClientId = undefined;
        this.reconnectAfterHostLoss();
    }

    /** Reconnect this room member after it loses its connection to the host. */
    protected reconnectAfterHostLoss() {
        if (this.isDestroyed || this.reconnectPromise || this.isCleaningUpConnection) {
            return;
        }

        this.reconnectPromise = this.reconnectUntilDestroyed().finally(() => {
            this.reconnectPromise = undefined;
        });
    }

    /** How long a reconnect waits for its new connection to open before trying again. */
    protected reconnectOpenTimeout: AnyDuration = {
        seconds: 10,
    };

    /**
     * Keep trying to connect, waiting longer after each failure, until it works or this controller
     * is destroyed. The browser coming back online skips the wait.
     */
    protected async reconnectUntilDestroyed(failureCount = 0): Promise<void> {
        if (await this.tryReconnect()) {
            return;
        }

        const isDestroyed = await waitUntilOnline({
            maxWait: {
                seconds: Math.min(2 ** failureCount, maxReconnectWait.seconds),
            },
            abortSignal: this.destroyAbortController.signal,
        });

        if (!isDestroyed) {
            /** Recursion is why this function's return type is annotated. */
            await this.reconnectUntilDestroyed(failureCount + 1);
        }
    }

    /**
     * Makes one reconnect attempt, which only succeeds once the new connection opens. Returns
     * whether to stop trying: the connection opened or this controller was destroyed.
     */
    protected async tryReconnect() {
        try {
            await this.initConnection({
                abortSignal: this.destroyAbortController.signal,
            });
            await rejectOnAbort(
                waitUntil.isTrue(() => this.isConnected(), {
                    timeout: this.reconnectOpenTimeout,
                }),
                this.destroyAbortController.signal,
            );
            return true;
        } catch (error) {
            if (this.destroyAbortController.signal.aborted) {
                return true;
            }
            log.warning(
                ensureErrorAndPrependMessage(error, 'Failed to reconnect to the multiplayer room.'),
            );
            /**
             * A connection that never opened never fires a disconnect, and `initConnection` won't
             * start a new one while it exists.
             */
            await this.destroyOwnConnection();
            return false;
        }
    }

    protected connectionQueue = new PromiseQueue();

    /** Create or reuse the WebSocket used for multiplayer room signaling. */
    protected async setupWebSocket(abortSignal?: AbortSignal | undefined) {
        if (
            this.webSocket &&
            (this.webSocket.readyState === WebSocket.OPEN ||
                this.webSocket.readyState === WebSocket.CONNECTING)
        ) {
            return this.webSocket;
        }
        const webSocketPromise = this.multiplayerApiClient.connectWebSocket(
            multiplayerConnectWebSocket,
            {
                searchParams: {
                    gameId: [this.gameId],
                },
                listeners: {
                    message: async ({message, webSocket}) => {
                        try {
                            if (message.type === MultiplayerWebSocketMessageType.Offer) {
                                if (!this.isHost()) {
                                    throw new Error(
                                        'Non-host multiplayer client received a WebRTC offer.',
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
                                            multiplayerController: this,
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

                                    const newConnection = this.createNewConnection(
                                        message.clientId,
                                    );
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
                                        'Host multiplayer client received a WebRTC answer.',
                                    );
                                }
                                /** A connection with the current id is the init connection. */
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
                                     * This client does not need a WebSocket connection anymore if
                                     * it is not the host.
                                     */
                                    await webSocket.close();
                                }
                            } else if (
                                message.type === MultiplayerWebSocketMessageType.OfferResult
                            ) {
                                if (message.hostClientId !== this.hostClientId) {
                                    makeWritable(this).hostClientId = message.hostClientId;

                                    if (this.isHost()) {
                                        const initConnection = this.connections[this.clientId];
                                        /**
                                         * Remove the init connection since it won't be used now
                                         * that this instance is the host.
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
                                message.type === MultiplayerWebSocketMessageType.HostReplaced
                            ) {
                                this.rejoinAsMember();
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
                    error(error) {
                        log.error(error);
                    },
                    close: () => {
                        this.webSocket = undefined;
                        this.stopHostPings();
                    },
                },
            },
        );

        try {
            const webSocket = await rejectOnAbort(webSocketPromise, abortSignal);
            this.webSocket = webSocket;
            return webSocket;
        } catch (error) {
            /** `connectWebSocket` can't be cancelled, so close its socket once it finally opens. */
            void webSocketPromise.then(
                (lateWebSocket) => lateWebSocket.close(),
                () => {},
            );
            throw error;
        }
    }

    /**
     * Destroys the local client's own WebRTC connection and its WebSocket, without treating it as a
     * lost host.
     */
    protected async destroyOwnConnection() {
        this.isCleaningUpConnection = true;
        try {
            this.connections[this.clientId]?.destroy();
            delete this.connections[this.clientId];
            this.stopHostPings();
            await this.webSocket?.close();
            this.webSocket = undefined;
        } finally {
            this.isCleaningUpConnection = false;
        }
    }

    /** Create and track a WebRTC connection for the given client. */
    protected createNewConnection(clientId: ClientId): WebrtcController<MessageData> {
        const newController = new WebrtcController<MessageData>(clientId);
        this.connections[clientId] = newController;
        newController.listen(WebrtcConnectEvent, (event) => {
            const connectionEstablished = event.detail;

            if (connectionEstablished) {
                if (clientId !== this.clientId) {
                    this.dispatch(
                        new WebrtcMultiplayerConnectionUpdateEvent({
                            detail: {
                                newMember: clientId,
                            },
                        }),
                    );
                } else if (this.hostClientId) {
                    this.dispatch(
                        new WebrtcMultiplayerConnectionUpdateEvent({
                            detail: {
                                connectedToHost: this.hostClientId,
                            },
                        }),
                    );
                }
            } else {
                newController.destroy();
                delete this.connections[clientId];
                if (this.isHost()) {
                    this.dispatch(
                        new WebrtcMultiplayerConnectionUpdateEvent({
                            detail: {
                                lostMember: clientId,
                            },
                        }),
                    );
                } else {
                    this.dispatch(
                        new WebrtcMultiplayerConnectionUpdateEvent({
                            detail: {
                                lostHost: clientId,
                            },
                        }),
                    );
                    /**
                     * If this member client has lost connection to its host, we've got to get it
                     * back!
                     */
                    this.reconnectAfterHostLoss();
                }
            }
        });
        newController.listen(WebrtcMessageEvent, (event) => {
            const sourceId = clientId === this.clientId ? this.hostClientId : clientId;

            if (sourceId) {
                this.dispatch(
                    new WebrtcMultiplayerMessageEvent<MessageData>(sourceId, event.detail),
                );
            }
        });

        return newController;
    }
}
