import {assert} from '@augment-vir/assert';
import {applyBrand, type Branded} from '@augment-vir/common';
import {assertWrapValidShape, typedStringShape} from 'object-shape-tester';
import {type ClientId, multiplayerIdShapes} from './multiplayer-id.js';

/**
 * Separator for client id and player position in {@link MultiplayerPlayerId}.
 *
 * @category Internal
 */
export const multiplayerPlayerIdSeparator = ':';

/**
 * Raw, unbranded multiplayer id string for {@link MultiplayerPlayerId}.
 *
 * @category Internal
 */
export type RawMultiplayerIdString = `${string}${typeof multiplayerPlayerIdSeparator}${string}`;

/**
 * Identifies one player slot belonging to a multiplayer client.
 *
 * @category Internal
 */
export type MultiplayerPlayerId = Branded<RawMultiplayerIdString, 'multiplayer-player-id'>;

/**
 * Checks only that a value is a string; it does not validate the encoded client id or player
 * position.
 *
 * @category Internal
 */
export const multiplayerPlayerIdShape = typedStringShape<MultiplayerPlayerId>();

/**
 * The client and local slot encoded in a {@link MultiplayerPlayerId}.
 *
 * @category Internal
 */
export type MultiplayerPlayerIdParts = {
    clientId: ClientId;
    playerPosition: string;
};

/**
 * Combines a peer id and its local player slot into a stable multiplayer player id.
 *
 * @category Util
 */
export function createMultiplayerPlayerId({
    clientId,
    playerPosition,
}: Readonly<{
    clientId: ClientId;
    playerPosition: string;
}>) {
    const validatedClientId = assertWrapValidShape(clientId, multiplayerIdShapes.client());
    const playerId: RawMultiplayerIdString = `${validatedClientId}${multiplayerPlayerIdSeparator}${playerPosition}`;

    assert.isNotIn(multiplayerPlayerIdSeparator, validatedClientId, 'Invalid client id.');
    assert.isNotIn(multiplayerPlayerIdSeparator, playerPosition, 'Invalid client id.');
    assert.isNotEmpty(playerPosition, 'Invalid player position.');

    return applyBrand<MultiplayerPlayerId>(playerId);
}

/**
 * Splits a multiplayer player id back into its peer id and local player slot.
 *
 * @category Util
 */
export function extractMultiplayerPlayerIdParts({
    playerId,
}: Readonly<{
    playerId: MultiplayerPlayerId;
}>): MultiplayerPlayerIdParts {
    const [
        clientId,
        playerPosition,
        ...extraParts
    ] = playerId.split(multiplayerPlayerIdSeparator);

    assert.isTruthy(clientId, 'Invalid multiplayer id.');
    assert.isTruthy(playerPosition, 'Invalid multiplayer id.');
    assert.isEmpty(extraParts, 'Invalid multiplayer id.');

    return {
        clientId: assertWrapValidShape(clientId, multiplayerIdShapes.client()),
        playerPosition,
    };
}
