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
import {assertWrap, check} from '@augment-vir/assert';
import {
    clamp,
    getObjectTypedKeys,
    getObjectTypedValues,
    type JsonCompatibleValue,
    makeWritable,
    mapObjectValues,
    omitObjectKeys,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {type AnyDuration, convertDuration, type Duration, type DurationUnit} from 'date-vir';
import {defineTypedCustomEvent, type TypedCustomEventInit} from 'typed-event-target';

/**
 * Message type for {@link P2pAuthoritativeClientMessage}.
 *
 * @category Internal
 */
export enum P2pAuthoritativeClientMessageType {
    ClientStates = 'client-states',
    ClientList = 'client-list',
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
    /**
     * Counts up by one with each state the client sends, so receivers can tell which states never
     * arrived.
     */
    sequence: number;
    /**
     * The newest state this client had received from each other client, echoed back so that client
     * can measure its round trip.
     */
    echoes: StateEcho[];
    state: ClientState;
};

/**
 * Echoes a state back to the client that sent it, for measuring its round trip.
 *
 * @category Internal
 */
export type StateEcho = {
    /** The client that sent the echoed state. */
    clientId: ClientId;
    /** The echoed state's `sentAt`, on its sender's clock. */
    sentAt: number;
    /** When the echoing client received that state, on the echoing client's clock. */
    receivedAt: number;
};

/**
 * How well states from one remote client have been arriving, from
 * {@link P2pAuthoritativeClientMultiplayerController.getConnectionStats}.
 *
 * @category Internal
 */
export type ClientConnectionStats = {
    /** States received. */
    receivedCount: number;
    /**
     * States received only as a repeat in a later message, because the message that first carried
     * them was lost.
     */
    recoveredCount: number;
    /** States that never arrived, even as a repeat, or arrived after a newer one. */
    missedCount: number;
    /**
     * The longest wait between received states, including the wait since the newest one. The wait
     * before a client's first state, such as while it loads or joins, is not counted.
     */
    longestGap: Duration<DurationUnit.Milliseconds>;
    /** How much slower the slowest delivery was than the fastest one. */
    jitter: Duration<DurationUnit.Milliseconds>;
    /** The fastest round trip measured, or `undefined` before that client echoes a state back. */
    roundTrip: Duration<DurationUnit.Milliseconds> | undefined;
};

/**
 * One state accepted from a remote client, kept for {@link ClientConnectionStats}.
 *
 * @category Internal
 */
export type StateDelivery = {
    sequence: number;
    sentAt: number;
    receivedAt: number;
    /** Whether the state arrived only as a repeat in a later message. */
    isRepeat: boolean;
    /** The round trip measured from the state's echo, if it had one for the local client. */
    roundTrip: number | undefined;
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
        /**
         * When this state would have been received over the fastest delivery seen recently from its
         * client, on the local `performance.now()` clock. Unlike `receivedAt`, network jitter
         * doesn't move it, so interpolate on this instead. It speeds up or slows down by only a few
         * percent when that client's delivery changes, so it never jumps.
         */
        smoothedReceivedAt: number;
        /**
         * The fastest recent round trip between the local client and this client, through the host.
         * Half of it is about how far behind its owner's screen this state is shown. `undefined`
         * until that client echoes a state back.
         */
        roundTrip: Duration<DurationUnit.Milliseconds> | undefined;
    };

/**
 * Message exchanged by p2p-authoritative-client clients.
 *
 * @category Internal
 */
export type P2pAuthoritativeClientMessage<ClientState extends JsonCompatibleValue> =
    /**
     * Sent unreliably from each member to the host with its own recent states, and from the host to
     * each member with every other client's recent states. Each client's states are oldest first
     * and repeat earlier sends, so a lost message is covered by the next one.
     */
    | {
          type: P2pAuthoritativeClientMessageType.ClientStates;
          clientStates: ClientStateUpdate<ClientState>[];
      }
    /**
     * Sent reliably from the host to members whenever a member joins or leaves, including when
     * members reconnect to a new host. Lists every client in the room, the host included. Members
     * drop every other client, and ignore states from them until a later list includes them.
     */
    | {
          type: P2pAuthoritativeClientMessageType.ClientList;
          clientIds: ClientId[];
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
         * Every send repeats the latest state, even when it hasn't changed, and the states from the
         * previous sends, so a lost message is covered by the next one.
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
        /**
         * Called with each new state received from another client. Return `false` to drop the
         * state: it's then not stored, emitted, or relayed by the host.
         *
         * @default every state is accepted
         */
        isValidState: (
            params: Readonly<{
                /** The newest state accepted from the same client before this one. */
                previous: Readonly<ReceivedClientState<ClientState>> | undefined;
                next: Readonly<ClientStateUpdate<ClientState>>;
            }>,
        ) => boolean;
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
/** Each send includes this many states from earlier sends, to cover lost messages. */
const repeatedStateCount = 2;
/** How far back the fastest delivery from each client is looked for. */
const clockSyncWindow = {
    milliseconds: 2000,
} as const satisfies AnyDuration;
/**
 * How long deliveries are kept for
 * {@link P2pAuthoritativeClientMultiplayerController.getConnectionStats}.
 */
const deliveryHistory = {
    milliseconds: 30_000,
} as const satisfies AnyDuration;
/**
 * How much faster or slower than real time `smoothedReceivedAt` may run while it adjusts to a
 * client's changing delivery.
 */
const maxClockRateChange = 0.05;

/**
 * Per remote client, what is needed to compute `smoothedReceivedAt`.
 *
 * @category Internal
 */
export type ClientClockSync = {
    /** Recent deliveries: the sender's `sentAt` and how much later the local clock received it. */
    deliveries: {
        sentAt: number;
        delay: number;
    }[];
    /** The delay currently added to `sentAt` to get `smoothedReceivedAt`. */
    delay: number;
    /** The newest `sentAt` that the delay was adjusted for. */
    sentAt: number;
};

function isFiniteNumber(value: unknown) {
    return check.isNumber(value) && check.isFinite(value);
}

function isValidStateEcho(echo: unknown) {
    return (
        check.isPlainObject(echo) &&
        check.isString(echo.clientId) &&
        isFiniteNumber(echo.sentAt) &&
        isFiniteNumber(echo.receivedAt)
    );
}

function isValidClientStateUpdate(clientStateUpdate: unknown) {
    return (
        check.isPlainObject(clientStateUpdate) &&
        check.isString(clientStateUpdate.clientId) &&
        isFiniteNumber(clientStateUpdate.sentAt) &&
        isFiniteNumber(clientStateUpdate.sequence) &&
        check.isArray(clientStateUpdate.echoes) &&
        clientStateUpdate.echoes.every(isValidStateEcho)
    );
}

/**
 * Checks the parts of a peer's message that the controller reads. Client states themselves are left
 * to `isValidState`.
 */
function isValidMessage(message: unknown) {
    if (
        !check.isPlainObject(message) ||
        !check.isEnumValue(message.type, P2pAuthoritativeClientMessageType)
    ) {
        return false;
    }

    const validators: Record<P2pAuthoritativeClientMessageType, () => boolean> = {
        [P2pAuthoritativeClientMessageType.ClientStates]() {
            return (
                check.isArray(message.clientStates) &&
                message.clientStates.every(isValidClientStateUpdate)
            );
        },
        [P2pAuthoritativeClientMessageType.ClientList]() {
            return check.isArray(message.clientIds) && message.clientIds.every(check.isString);
        },
    };

    return validators[message.type]();
}

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

    /**
     * The latest states sent by each client, oldest first, to repeat in each send. Members keep
     * only their own; the host also keeps every member's, to relay.
     */
    protected recentClientStates: Record<ClientId, ClientStateUpdate<ClientState>[]> = {};
    protected clientClockSyncs: Record<ClientId, ClientClockSync> = {};
    /** Recent states accepted from each remote client, oldest first. */
    protected clientDeliveries: Record<ClientId, StateDelivery[]> = {};
    protected nextSequence = 0;
    protected sendIntervalId: ReturnType<typeof globalThis.setInterval> | undefined;
    protected sendAnimationFrameId: number | undefined;
    /**
     * On members, every client in the room from the host's latest client list, or `undefined`
     * before the first list arrives.
     */
    protected roomClientIds: ClientId[] | undefined;
    /** On members, the host that the latest message came from. */
    protected hostClientId: ClientId | undefined;

    constructor(
        protected readonly params: P2pAuthoritativeClientMultiplayerControllerParams<ClientState>,
    ) {
        super(params);
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
        this.roomClientIds = undefined;
        this.hostClientId = undefined;
        this.removeAllRemoteClients();
        this.singleplayer = false;
        this.roomConnection = assertWrap.isDefined(
            this.roomController.currentConnection,
            'Cannot start p2p-authoritative-client multiplayer: room connection is missing.',
        );
        this.watchHost();
        this.sendIntervalId = globalThis.setInterval(
            () => {
                /**
                 * Browsers stop animation frames in hidden pages but keep running timers. Waiting
                 * for one stops a hidden host from sending, so its members drop it and recreate the
                 * room instead of playing on with a host that only sends occasionally.
                 */
                this.sendAnimationFrameId ??= globalThis.requestAnimationFrame(() => {
                    this.sendAnimationFrameId = undefined;
                    this.sendClientStates();
                });
            },
            convertDuration(this.params.sendInterval || defaultSendInterval, {
                milliseconds: true,
            }).milliseconds,
        );
        this.debugLog(
            `attached p2p-authoritative-client connection; client=${this.clientId} host=${this.isHost()}`,
        );
    }

    /** Leave the current room or single player connection. */
    public override leaveRoom() {
        this.stopSending();
        this.roomClientIds = undefined;
        this.hostClientId = undefined;
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
            this.sendClientList();
        } else if (status.newMember) {
            this.sendClientList();
        } else if (status.lostHost && this.hostClientId) {
            /** `lostHost` is the local client's id, not the host's. */
            this.removeRemoteClient(this.hostClientId);
            this.hostClientId = undefined;
        }
    }

    /**
     * On the host, drops every remote client that's no longer connected and sends the room's
     * clients to every member.
     */
    protected sendClientList() {
        if (!this.roomConnection || !this.isHost()) {
            return;
        }

        const clientIds = this.roomConnection.getAllClientIds();

        this.removeRemoteClientsExcept(clientIds);
        this.roomConnection.sendMessage({
            type: P2pAuthoritativeClientMessageType.ClientList,
            clientIds,
        });
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
                const newestSentAts = message.clientStates.reduce<
                    Partial<Record<ClientId, number>>
                >((newest, {clientId, sentAt}) => {
                    return {
                        ...newest,
                        [clientId]: Math.max(newest[clientId] ?? sentAt, sentAt),
                    };
                }, {});
                const acceptedCount = message.clientStates.filter((clientStateUpdate) => {
                    /** The host only trusts a member's own state, and members never take their own. */
                    const isAllowed = this.isHost()
                        ? clientStateUpdate.clientId === sourceClientId
                        : clientStateUpdate.clientId !== this.clientId;

                    return (
                        isAllowed &&
                        this.receiveClientState({
                            clientStateUpdate,
                            isRepeat:
                                clientStateUpdate.sentAt !==
                                newestSentAts[clientStateUpdate.clientId],
                        })
                    );
                }).length;

                if (this.isHost() && acceptedCount) {
                    this.relayClientStates(sourceClientId);
                }
            },
        },
        [P2pAuthoritativeClientMessageType.ClientList]: {
            handle: ({message}) => {
                if (!this.isHost()) {
                    this.roomClientIds = message.clientIds;
                    this.removeRemoteClientsExcept(message.clientIds);
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
        if (!isValidMessage(message)) {
            this.debugLog(`dropped an invalid message from client ${sourceClientId}`);
            return;
        }
        if (!this.isHost()) {
            this.hostClientId = sourceClientId;
        }

        /** Indexing by `message.type` directly loses the link between the handler and `message`. */
        const type: Type = message.type;

        this.messageHandlers[type].handle({
            message,
            sourceClientId,
        });
    }

    /**
     * Stores and emits a client state, unless a newer one from that client already arrived or the
     * state is invalid. Returns whether the state was stored.
     */
    protected receiveClientState({
        clientStateUpdate,
        isRepeat,
    }: Readonly<{
        clientStateUpdate: Readonly<ClientStateUpdate<ClientState>>;
        /** Whether the state is a repeat of one that a later state in the same message follows. */
        isRepeat: boolean;
    }>) {
        const previous = this.remoteClientStates[clientStateUpdate.clientId];

        if (
            (previous && previous.sentAt >= clientStateUpdate.sentAt) ||
            (!this.isHost() &&
                this.roomClientIds &&
                !this.roomClientIds.includes(clientStateUpdate.clientId)) ||
            this.params.isValidState?.({
                previous,
                next: clientStateUpdate,
            }) === false
        ) {
            return false;
        }

        const receivedAt = performance.now();
        const roundTrip = this.recordDelivery({
            clientStateUpdate,
            isRepeat,
            receivedAt,
        });
        const receivedClientState: ReceivedClientState<ClientState> = {
            roundTrip,
            ...clientStateUpdate,
            receivedAt,
            smoothedReceivedAt:
                clientStateUpdate.sentAt +
                this.syncClientClock({
                    clientId: clientStateUpdate.clientId,
                    sentAt: clientStateUpdate.sentAt,
                    receivedAt,
                }),
        };

        makeWritable(this).remoteClientStates = {
            ...this.remoteClientStates,
            [clientStateUpdate.clientId]: receivedClientState,
        };
        if (this.isHost()) {
            this.addRecentClientState(clientStateUpdate);
        }
        this.dispatch(
            new MultiplayerControllerClientStateEvent<ClientState>({
                detail: receivedClientState,
            }),
        );

        return true;
    }

    /**
     * On the host, forwards a member's recent states to every other member as soon as they arrive.
     * Waiting for the host's own send would hold them back, and browsers slow that send to about
     * once a second while the host's page is hidden.
     */
    protected relayClientStates(memberClientId: ClientId) {
        const clientStates = assertWrap.isDefined(this.recentClientStates[memberClientId]);

        this.roomConnection?.getConnectedClientIds().forEach((otherClientId) => {
            if (otherClientId !== memberClientId) {
                this.roomConnection?.sendToOnlyOneClient(
                    otherClientId,
                    {
                        type: P2pAuthoritativeClientMessageType.ClientStates,
                        clientStates,
                    },
                    MessageDelivery.Unreliable,
                );
            }
        });
    }

    /**
     * Get how well states from each remote client arrived during the given window, up to now. Only
     * recent deliveries are kept, so a long window covers only what is still kept.
     */
    public getConnectionStats(window: Readonly<AnyDuration>) {
        const now = performance.now();
        const since =
            now -
            convertDuration(window, {
                milliseconds: true,
            }).milliseconds;

        return mapObjectValues(
            this.clientDeliveries,
            (clientId, deliveries): ClientConnectionStats => {
                const recentDeliveries = deliveries.filter(
                    (delivery) => delivery.receivedAt > since,
                );
                const sequences = recentDeliveries.map(({sequence}) => sequence);
                /** A client that joined during the window has no gap before its first state. */
                const hasEarlierDelivery = deliveries.some(
                    (delivery) => delivery.receivedAt <= since,
                );
                const receivedAts = [
                    ...(hasEarlierDelivery ? [since] : []),
                    ...recentDeliveries.map(({receivedAt}) => receivedAt),
                    now,
                ];
                const firstDeliveryDelays = recentDeliveries
                    .filter(({isRepeat}) => !isRepeat)
                    .map(({sentAt, receivedAt}) => receivedAt - sentAt);
                const roundTrips = recentDeliveries
                    .map(({roundTrip}) => roundTrip)
                    .filter(check.isDefined);

                return {
                    receivedCount: recentDeliveries.length,
                    recoveredCount: recentDeliveries.filter(({isRepeat}) => isRepeat).length,
                    missedCount: sequences.length
                        ? Math.max(...sequences) -
                          Math.min(...sequences) +
                          1 -
                          recentDeliveries.length
                        : 0,
                    longestGap: {
                        milliseconds: Math.max(
                            ...receivedAts.slice(1).map((receivedAt, index) => {
                                return receivedAt - assertWrap.isDefined(receivedAts[index]);
                            }),
                        ),
                    },
                    jitter: {
                        milliseconds: firstDeliveryDelays.length
                            ? Math.max(...firstDeliveryDelays) - Math.min(...firstDeliveryDelays)
                            : 0,
                    },
                    roundTrip: roundTrips.length
                        ? {
                              milliseconds: Math.min(...roundTrips),
                          }
                        : undefined,
                };
            },
        );
    }

    /**
     * Keeps an accepted state for
     * {@link P2pAuthoritativeClientMultiplayerController.getConnectionStats} and returns the fastest
     * recent round trip to its client.
     */
    protected recordDelivery({
        clientStateUpdate,
        isRepeat,
        receivedAt,
    }: Readonly<{
        clientStateUpdate: Readonly<ClientStateUpdate<ClientState>>;
        isRepeat: boolean;
        receivedAt: number;
    }>) {
        const echo = clientStateUpdate.echoes.find(({clientId}) => clientId === this.clientId);
        const deliveries = [
            ...(this.clientDeliveries[clientStateUpdate.clientId] || []).filter((delivery) => {
                return delivery.receivedAt > receivedAt - deliveryHistory.milliseconds;
            }),
            {
                sequence: clientStateUpdate.sequence,
                sentAt: clientStateUpdate.sentAt,
                receivedAt,
                isRepeat,
                /** The echoing client held the state from `echo.receivedAt` until it sent this one. */
                roundTrip: echo
                    ? receivedAt - echo.sentAt - (clientStateUpdate.sentAt - echo.receivedAt)
                    : undefined,
            },
        ];
        this.clientDeliveries = {
            ...this.clientDeliveries,
            [clientStateUpdate.clientId]: deliveries,
        };

        const roundTrips = deliveries
            .filter((delivery) => {
                return delivery.receivedAt > receivedAt - clockSyncWindow.milliseconds;
            })
            .map(({roundTrip}) => roundTrip)
            .filter(check.isDefined);

        return roundTrips.length
            ? {
                  milliseconds: Math.min(...roundTrips),
              }
            : undefined;
    }

    /**
     * Returns the delay to add to a client's `sentAt` to get `smoothedReceivedAt`. The delay heads
     * toward the smallest delay seen recently from that client, which is the delivery with the
     * least jitter. It changes by only a few percent of the time between sends, so consecutive
     * states never swap order or jump.
     */
    protected syncClientClock({
        clientId,
        sentAt,
        receivedAt,
    }: Readonly<{
        clientId: ClientId;
        sentAt: number;
        receivedAt: number;
    }>) {
        const previous = this.clientClockSyncs[clientId];
        const deliveries = [
            ...(previous?.deliveries || []).filter((delivery) => {
                return delivery.sentAt > sentAt - clockSyncWindow.milliseconds;
            }),
            {
                sentAt,
                delay: receivedAt - sentAt,
            },
        ];
        const fastestDelay = Math.min(...deliveries.map(({delay}) => delay));
        const maxChange = previous ? (sentAt - previous.sentAt) * maxClockRateChange : 0;
        const delay = previous
            ? previous.delay +
              clamp(fastestDelay - previous.delay, {
                  min: -maxChange,
                  max: maxChange,
              })
            : fastestDelay;

        this.clientClockSyncs = {
            ...this.clientClockSyncs,
            [clientId]: {
                deliveries,
                delay,
                sentAt,
            },
        };

        return delay;
    }

    /** Adds a client's newest state to the states repeated in each send. */
    protected addRecentClientState(clientStateUpdate: Readonly<ClientStateUpdate<ClientState>>) {
        this.recentClientStates = {
            ...this.recentClientStates,
            [clientStateUpdate.clientId]: [
                ...(this.recentClientStates[clientStateUpdate.clientId] || []),
                clientStateUpdate,
            ].slice(-(repeatedStateCount + 1)),
        };
    }

    /**
     * Sends this client's own recent states: from a member to the host, or from the host to every
     * member.
     */
    protected sendClientStates() {
        const localState = this.params.createLocalState?.();

        if (!this.roomConnection || localState == undefined) {
            return;
        }

        this.addRecentClientState({
            clientId: this.clientId,
            sentAt: performance.now(),
            sequence: this.nextSequence++,
            echoes: getObjectTypedValues(this.remoteClientStates).map(
                ({clientId, sentAt, receivedAt}) => {
                    return {
                        clientId,
                        sentAt,
                        receivedAt,
                    };
                },
            ),
            state: localState,
        });
        this.roomConnection.sendMessage(
            {
                type: P2pAuthoritativeClientMessageType.ClientStates,
                clientStates: assertWrap.isDefined(this.recentClientStates[this.clientId]),
            },
            MessageDelivery.Unreliable,
        );
    }

    /** Forgets a remote client's state and emits its leave, if its state was ever received. */
    protected removeRemoteClient(clientId: ClientId) {
        this.recentClientStates = omitObjectKeys<
            Record<ClientId, ClientStateUpdate<ClientState>[]>,
            ClientId
        >(this.recentClientStates, [
            clientId,
        ]);
        this.clientDeliveries = omitObjectKeys<Record<ClientId, StateDelivery[]>, ClientId>(
            this.clientDeliveries,
            [
                clientId,
            ],
        );
        this.clientClockSyncs = omitObjectKeys<Record<ClientId, ClientClockSync>, ClientId>(
            this.clientClockSyncs,
            [
                clientId,
            ],
        );

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

    /** Removes every remote client that isn't in `clientIds`. */
    protected removeRemoteClientsExcept(clientIds: ReadonlyArray<ClientId>) {
        getObjectTypedKeys(this.remoteClientStates).forEach((clientId) => {
            if (!clientIds.includes(clientId)) {
                this.removeRemoteClient(clientId);
            }
        });
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
        if (this.sendAnimationFrameId != undefined) {
            globalThis.cancelAnimationFrame(this.sendAnimationFrameId);
            this.sendAnimationFrameId = undefined;
        }
        this.recentClientStates = {};
    }
}
