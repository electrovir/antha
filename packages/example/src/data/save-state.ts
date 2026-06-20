import {clientIdShape} from '@antha/multiplayer-core';
import {fakerEN_US} from '@faker-js/faker';

import {defineShape, enumShape, recordShape} from 'object-shape-tester';

export enum GameLocation {
    Hangar = 'hangar',
}

export const saveStateShape = defineShape({
    /** The position of the bottom of the screen. */
    forwardProgress: -1,
    currentPlayerName: '',
    location: enumShape(GameLocation),
    players: recordShape({
        /** Player name. */
        keys: clientIdShape,
        values: {
            name: '',
            position: {
                /** Horizontal position across the map. */
                x: -1,
                /**
                 * Y position on the current screen. 0 is at the bottom of the screen. As this
                 * increases, the player moves up the screen.
                 */
                y: -1,
            },
        },
    }),
});

export type SaveState = typeof saveStateShape.runtimeType;

const emptyFakeName = fakerEN_US.person.firstName('generic');

export const emptySaveState: SaveState = {
    forwardProgress: 0,
    currentPlayerName: emptyFakeName,
    location: GameLocation.Hangar,
    players: {
        [emptyFakeName]: {
            name: emptyFakeName,
            position: {
                x: 0,
                y: 0,
            },
        },
    },
};
