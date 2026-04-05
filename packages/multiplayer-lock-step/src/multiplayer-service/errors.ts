import {omitObjectKeys, type SetOptionalAndNullable} from '@augment-vir/common';
import {type RoomInput} from '../webrtc/webrtc-multiplayer-controller.js';

/**
 * This error is thrown when a multiplayer room connection is established but then intentionally
 * rejected by the host client.
 *
 * @category Error
 */
export class RoomRejectionError extends Error {
    public override readonly name = 'RoomRejectionError';
    public readonly room: Readonly<Omit<RoomInput, 'roomPassword'>>;

    constructor(room: Readonly<SetOptionalAndNullable<RoomInput, 'roomPassword'>>) {
        super('Room connection rejected');
        this.room = omitObjectKeys(room, ['roomPassword']);
    }
}
