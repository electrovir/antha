import {defineShape} from 'object-shape-tester';

// todo: add actual data here
export const saveStateShape = defineShape({});

export type SaveState = typeof saveStateShape.runtimeType;

export const emptySaveState: SaveState = {};
