import {check} from '@augment-vir/assert';
import {createCuid2, mapObjectValues, type AnyObject, type Branded} from '@augment-vir/common';
import {type TUnsafe} from '@sinclair/typebox';
import {createCustomShape, type Shape} from 'object-shape-tester';

/**
 * Unique id for a multiplayer room client.
 *
 * @category Internal
 */
export type ClientId = Branded<`${typeof idPrefixes.client}${string}`, 'multiplayer-client-id'>;
/**
 * Unique id for a multiplayer room.
 *
 * @category Internal
 */
export type RoomId = Branded<`${typeof idPrefixes.room}${string}`, 'multiplayer-room-id'>;
/**
 * Unique id for a multiplayer signaling socket message.
 *
 * @category Internal
 */
export type SocketMessageId = Branded<
    `${typeof idPrefixes.socketMessage}${string}`,
    'multiplayer-socket-message-id'
>;

/**
 * String prefixes used to distinguish multiplayer id types.
 *
 * @category Internal
 */
export const idPrefixes = {
    /** Prefix for {@link RoomId}. */
    room: 'r_',
    /** Prefix for {@link ClientId}. */
    client: 'c_',
    /** Prefix for {@link SocketMessageId}. */
    socketMessage: 'sm_',
} as const satisfies Readonly<Record<string, string>>;

/**
 * Map of multiplayer id keys to their branded id types.
 *
 * @category Internal
 */
export type IdMap = {
    /** Branded room id type. */
    room: RoomId;
    /** Branded client id type. */
    client: ClientId;
    /** Branded socket message id type. */
    socketMessage: SocketMessageId;
};

/**
 * Create branded multiplayer ids with the correct prefix for each id type.
 *
 * @category Internal
 */
export const createMultiplayerId = mapObjectValues(idPrefixes, (idKey, prefix) => {
    return () => `${prefix}${createCuid2()}`;
}) satisfies Readonly<Record<keyof typeof idPrefixes, () => string>> as {
    [IdType in keyof typeof idPrefixes]: () => IdMap[IdType];
};

/**
 * Runtime shapes for validating branded multiplayer ids.
 *
 * @category Internal
 */
export const multiplayerIdShapes = mapObjectValues(idPrefixes, (idKey) => {
    return createCustomShape<string>({
        checkValue(value): value is string {
            return check.isString(value) && value.startsWith(idPrefixes[idKey]);
        },
        default: '',
        name: `${idKey} multiplayer id shape`,
    });
}) satisfies Readonly<
    Record<keyof typeof idPrefixes, () => Shape<TUnsafe<string>>>
> as AnyObject as {
    [IdType in keyof typeof idPrefixes]: () => Shape<TUnsafe<IdMap[IdType]>>;
};
