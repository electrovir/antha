import {
    type ClientId,
    emptyApiAndRoomConnectionState,
    MessageDelivery,
    MultiplayerConnectionState,
    type MultiplayerConnectionTimeoutOptions,
    type MultiplayerConnectionUpdate,
    MultiplayerControllerConnectionEvent,
    P2pMultiplayerController,
    type P2pMultiplayerControllerParams,
    type P2pMultiplayerControllerRoomEvents,
    type RoomInput,
} from '@antha/multiplayer-core';
import {assertWrap} from '@augment-vir/assert';
import {
    getObjectTypedKeys,
    getObjectTypedValues,
    type JsonCompatibleValue,
    makeWritable,
    omitObjectKeys,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {type AnyDuration, convertDuration} from 'date-vir';
import {defineTypedCustomEvent, type TypedCustomEventInit} from 'typed-event-target';

/**
 * Message type for {@link P2pAuthoritativeClientMessage}.
 *
 * @category Internal
 */
export enum P2pAuthoritativeClientMessageType {
    ClientStates = 'client-states',
    ClientLeave = 'client-leave',
}

/**
 * One client's state, as sent by that client.
 *
 * @category Internal
 */
export type ClientStateUpdate<ClientState extends JsonCompatibleValue> = {
    clientId: ClientId;
    /**
     * When the client sent this state, from that client's own `performance.now()`. Only compare it
     * against other `sentAt` values from the same client.
     */
    sentAt: number;
    state: ClientState;
};

/**
 * One client's state, as received by the local client.
 *
 * @category Internal
 */
export type ReceivedClientState<ClientState extends JsonCompatibleValue> =
    ClientStateUpdate<ClientState> & {
        /** When the local client received this state, from the local `performance.now()`. */
        receivedAt: number;
    };

/**
 * Message exchanged by p2p-authoritative-client clients.
 *
 * @category Internal
 */
export type P2pAuthoritativeClientMessage<ClientState extends JsonCompatibleValue> =
    /**
     * Sent unreliably from each member to the host with its own state, and from the host to each
     * member with every other client's state.
     */
    | {
          type: P2pAuthoritativeClientMessageType.ClientStates;
          clientStates: ClientStateUpdate<ClientState>[];
      }
    /** Sent from the host to members when a member leaves the room. */
    | {
          type: P2pAuthoritativeClientMessageType.ClientLeave;
          clientId: ClientId;
      };

/**
 * Each {@link P2pAuthoritativeClientMessage} variant, keyed by its message type.
 *
 * @category Internal
 */
export type P2pAuthoritativeClientMessageByType<ClientState extends JsonCompatibleValue> = {
    [Type in P2pAuthoritativeClientMessageType]: Readonly<
        Extract<
            P2pAuthoritativeClientMessage<ClientState>,
            {
                type: Type;
            }
        >
    >;
};

/**
 * Constructor parameters for {@link P2pAuthoritativeClientMultiplayerController}.
 *
 * @category Internal
 */
export type P2pAuthoritativeClientMultiplayerControllerParams<
    ClientState extends JsonCompatibleValue,
> = P2pMultiplayerControllerParams<P2pAuthoritativeClientMultiplayerController<ClientState>> &
    PartialWithUndefined<{
        /**
         * Called on every send to get this client's own state. Return `undefined` to send nothing.
         * Every send repeats the latest state, even when it hasn't changed, so a lost message is
         * replaced by the next one.
         *
         * @default nothing is sent
         */
        createLocalState: () => ClientState | undefined;
        /**
         * How often this client sends its own state while in a room.
         *
         * @default {seconds: 1 / 20}
         */
        sendInterval: AnyDuration;
    }>;

/**
 * This is fired whenever a newer state is received from another client. States arrive unreliably,
 * so some are skipped, and an older state that arrives late is never emitted.
 *
 * @category Events
 */
export class MultiplayerControllerClientStateEvent<
    ClientState extends JsonCompatibleValue,
> extends defineTypedCustomEvent<any>()('multiplayer-controller-client-state') {
    public declare detail: Readonly<ReceivedClientState<ClientState>>;

    constructor(eventInitDict: TypedCustomEventInit<Readonly<ReceivedClientState<ClientState>>>) {
        super(eventInitDict);
    }
}

/**
 * This is fired when a client whose state was received leaves the room, including when the local
 * client leaves or switches rooms.
 *
 * @category Events
 */
export class MultiplayerControllerClientLeaveEvent extends defineTypedCustomEvent<
    Readonly<{
        clientId: ClientId;
    }>
>()('multiplayer-controller-client-leave') {}

/**
 * All events emitted by {@link P2pAuthoritativeClientMultiplayerController}.
 *
 * @category Internal
 */
export type AllP2pAuthoritativeClientMultiplayerControllerEvents<
    ClientState extends JsonCompatibleValue,
> =
    | MultiplayerControllerClientStateEvent<ClientState>
    | MultiplayerControllerClientLeaveEvent
    | P2pMultiplayerControllerRoomEvents;

const defaultSendInterval: AnyDuration = {
    seconds: 1 / 20,
};

/**
 * A controller for singleplayer or p2p multiplayer where each client is the authority over its own
 * state. Each client sends its state to the host, and the host relays it to every other client. The
 * state is opaque: the controller doesn't apply it or smooth it.
 *
 * @category Main
 */
export class P2pAuthoritativeClientMultiplayerController<
    ClientState extends JsonCompatibleValue = any,
> extends P2pMultiplayerController<
    P2pAuthoritativeClientMessage<ClientState>,
    AllP2pAuthoritativeClientMultiplayerControllerEvents<ClientState>
> {
    /** All events emitted by this controller. */
    public static readonly events = {
        MultiplayerControllerClientLeaveEvent,
        MultiplayerControllerClientStateEvent,
    };
    /** All events emitted by this controller. */
    public readonly events = P2pAuthoritativeClientMultiplayerController.events;

    /** The latest state received from each other client in the room. */
    public readonly remoteClientStates: Readonly<
        Record<ClientId, Readonly<ReceivedClientState<ClientState>>>
    > = {};

    /** On the host, member states received since the last send, to relay to the other members. */
    protected relayClientStates: Record<ClientId, ClientStateUpdate<ClientState>> = {};
    protected sendIntervalId: ReturnType<typeof globalThis.setInterval> | undefined;
    protected readonly sendIntervalMs: number;

    constructor(
        protected readonly params: P2pAuthoritativeClientMultiplayerControllerParams<ClientState>,
    ) {
        super(params);
        this.sendIntervalMs = convertDuration(params.sendInterval || defaultSendInterval, {
            milliseconds: true,
        }).milliseconds;
    }

    protected override shouldAcceptConnection(connectingClientId: ClientId) {
        return this.params.acceptConnection?.(connectingClientId, this) ?? true;
    }

    /** Start local play without contacting the multiplayer API. This can later open into a room. */
    public startSingleplayer() {
        if (this.currentConnection) {
            throw new Error('Cannot start singleplayer with a connection already present.');
        }

        this.debugLog('starting singleplayer connection');
        this.singleplayer = true;
        this.dispatch(
            new MultiplayerControllerConnectionEvent({
                detail: {
                    ...emptyApiAndRoomConnectionState,
                    api: MultiplayerConnectionState.Connected,
                },
            }),
        );
    }

    /** Join or create a room. Every client from a previous room leaves. */
    public async joinOrCreateRoom(
        room: Readonly<RoomInput>,
        timeoutOptions: Readonly<MultiplayerConnectionTimeoutOptions> = {},
    ) {
        this.debugLog(`joining or creating room '${room.roomName}' (${room.roomId})`);
        await this.roomController.joinOrCreateRoom(room, timeoutOptions);

        this.stopSending();
        this.removeAllRemoteClients();
        this.singleplayer = false;
        this.roomConnection = assertWrap.isDefined(
            this.roomController.currentConnection,
            'Cannot start p2p-authoritative-client multiplayer: room connection is missing.',
        );
        this.sendIntervalId = globalThis.setInterval(() => {
            this.sendClientStates();
        }, this.sendIntervalMs);
        this.debugLog(
            `attached p2p-authoritative-client connection; client=${this.clientId} host=${this.isHost()}`,
        );
    }

    /** Leave the current room or single player connection. */
    public override leaveRoom() {
        this.stopSending();
        this.removeAllRemoteClients();
        super.leaveRoom();
    }

    /** Cleanup everything. */
    public override destroy() {
        this.stopSending();
        super.destroy();
    }

    protected override handleClientStatus(status: Readonly<MultiplayerConnectionUpdate>) {
        if (status.lostMember) {
            this.removeRemoteClient(status.lostMember);
            this.roomConnection?.sendMessage({
                type: P2pAuthoritativeClientMessageType.ClientLeave,
                clientId: status.lostMember,
            });
        } else if (status.lostHost) {
            this.removeRemoteClient(status.lostHost);
        }
    }

    /** Per message type, how a received message is handled. */
    protected readonly messageHandlers: {
        [Type in P2pAuthoritativeClientMessageType]: {
            /** Handles the message. */
            handle: (
                params: Readonly<{
                    message: P2pAuthoritativeClientMessageByType<ClientState>[Type];
                    sourceClientId: ClientId;
                }>,
            ) => void;
        };
    } = {
        [P2pAuthoritativeClientMessageType.ClientStates]: {
            handle: ({message, sourceClientId}) => {
                message.clientStates.forEach((clientStateUpdate) => {
                    /** The host only trusts a member's own state, and members never take their own. */
                    const isAllowed = this.isHost()
                        ? clientStateUpdate.clientId === sourceClientId
                        : clientStateUpdate.clientId !== this.clientId;

                    if (isAllowed) {
                        this.receiveClientState(clientStateUpdate);
                    }
                });
            },
        },
        [P2pAuthoritativeClientMessageType.ClientLeave]: {
            handle: ({message}) => {
                if (!this.isHost()) {
                    this.removeRemoteClient(message.clientId);
                }
            },
        },
    };

    /**
     * Route a received message to its handler in
     * {@link P2pAuthoritativeClientMultiplayerController.messageHandlers}.
     */
    protected override handleReceivedMessage<Type extends P2pAuthoritativeClientMessageType>(
        sourceClientId: ClientId,
        message: P2pAuthoritativeClientMessageByType<ClientState>[Type],
    ) {
        /** Indexing by `message.type` directly loses the link between the handler and `message`. */
        const type: Type = message.type;

        this.messageHandlers[type].handle({
            message,
            sourceClientId,
        });
    }

    /** Stores and emits a client state, unless a newer one from that client already arrived. */
    protected receiveClientState(clientStateUpdate: Readonly<ClientStateUpdate<ClientState>>) {
        const previous = this.remoteClientStates[clientStateUpdate.clientId];

        if (previous && previous.sentAt >= clientStateUpdate.sentAt) {
            return;
        }

        const receivedClientState: ReceivedClientState<ClientState> = {
            ...clientStateUpdate,
            receivedAt: performance.now(),
        };

        makeWritable(this).remoteClientStates = {
            ...this.remoteClientStates,
            [clientStateUpdate.clientId]: receivedClientState,
        };
        if (this.isHost()) {
            this.relayClientStates = {
                ...this.relayClientStates,
                [clientStateUpdate.clientId]: clientStateUpdate,
            };
        }
        this.dispatch(
            new MultiplayerControllerClientStateEvent<ClientState>({
                detail: receivedClientState,
            }),
        );
    }

    /**
     * Sends this client's own state. On the host, this also relays the member states received since
     * the last send, so each member gets one message per send with every other client's state.
     */
    protected sendClientStates() {
        if (!this.roomConnection) {
            return;
        }

        const localState = this.params.createLocalState?.();
        const localClientStates: ClientStateUpdate<ClientState>[] =
            localState == undefined
                ? []
                : [
                      {
                          clientId: this.clientId,
                          sentAt: performance.now(),
                          state: localState,
                      },
                  ];

        if (!this.isHost()) {
            if (localClientStates.length) {
                this.roomConnection.sendMessage(
                    {
                        type: P2pAuthoritativeClientMessageType.ClientStates,
                        clientStates: localClientStates,
                    },
                    MessageDelivery.Unreliable,
                );
            }
            return;
        }

        const clientStates = [
            ...localClientStates,
            ...getObjectTypedValues(this.relayClientStates),
        ];
        this.relayClientStates = {};

        this.roomConnection.getConnectedClientIds().forEach((memberClientId) => {
            const memberClientStates = clientStates.filter((clientStateUpdate) => {
                return clientStateUpdate.clientId !== memberClientId;
            });

            if (memberClientStates.length) {
                this.roomConnection?.sendToOnlyOneClient(
                    memberClientId,
                    {
                        type: P2pAuthoritativeClientMessageType.ClientStates,
                        clientStates: memberClientStates,
                    },
                    MessageDelivery.Unreliable,
                );
            }
        });
    }

    /** Forgets a remote client's state and emits its leave, if its state was ever received. */
    protected removeRemoteClient(clientId: ClientId) {
        this.relayClientStates = omitObjectKeys<
            Record<ClientId, ClientStateUpdate<ClientState>>,
            ClientId
        >(this.relayClientStates, [
            clientId,
        ]);

        if (!this.remoteClientStates[clientId]) {
            return;
        }

        makeWritable(this).remoteClientStates = omitObjectKeys<
            Record<ClientId, Readonly<ReceivedClientState<ClientState>>>,
            ClientId
        >(this.remoteClientStates, [
            clientId,
        ]);
        this.dispatch(
            new MultiplayerControllerClientLeaveEvent({
                detail: {
                    clientId,
                },
            }),
        );
    }

    /**
     * Removes every remote client with
     * {@link P2pAuthoritativeClientMultiplayerController.removeRemoteClient}.
     */
    protected removeAllRemoteClients() {
        getObjectTypedKeys(this.remoteClientStates).forEach((clientId) => {
            this.removeRemoteClient(clientId);
        });
    }

    /** Stops sending this client's state until a room is joined again. */
    protected stopSending() {
        globalThis.clearInterval(this.sendIntervalId);
        this.sendIntervalId = undefined;
    }
}
