import {check} from '@augment-vir/assert';
import {createCuid2, mapObjectValues, type AnyObject, type Branded} from '@augment-vir/common';
import {type TUnsafe} from '@sinclair/typebox';
import {createCustomShape, type Shape} from 'object-shape-tester';

export type ClientId = Branded<`${typeof idPrefixes.client}${string}`, 'multiplayer-client-id'>;
export type RoomId = Branded<`${typeof idPrefixes.room}${string}`, 'multiplayer-room-id'>;
export type SocketMessageId = Branded<
    `${typeof idPrefixes.socketMessage}${string}`,
    'multiplayer-socket-message-id'
>;

export const idPrefixes = {
    room: 'r_',
    client: 'c_',
    socketMessage: 'sm_',
} as const satisfies Readonly<Record<string, string>>;

export type IdMap = {
    room: RoomId;
    client: ClientId;
    socketMessage: SocketMessageId;
};

export const createMultiplayerId = mapObjectValues(idPrefixes, (idKey, prefix) => {
    return () => `${prefix}${createCuid2()}`;
}) satisfies Readonly<Record<keyof typeof idPrefixes, () => string>> as {
    [IdType in keyof typeof idPrefixes]: () => IdMap[IdType];
};

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
