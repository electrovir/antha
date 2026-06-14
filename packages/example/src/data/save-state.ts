import {defineShape, recordShape} from 'object-shape-tester';

export const saveStateShape = defineShape({
    /** The position of the bottom of the screen. */
    forwardProgress: -1,
    playerPositions: recordShape({
        /** Player name. */
        keys: '',
        values: {
            /** Horizontal position across the map. */
            x: -1,
            /** Y position on the current screen. */
            y: -1,
        },
    }),
});

export type SaveState = typeof saveStateShape.runtimeType;

export const emptySaveState: SaveState = {
    forwardProgress: 0,
    playerPositions: {},
};
