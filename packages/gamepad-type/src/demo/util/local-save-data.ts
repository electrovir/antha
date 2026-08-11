import {Store} from 'indexed-vir';
import {
    type GamepadLayout,
    type GamepadModelMap,
    defaultGamepadLayouts,
    defaultGamepadModelMap,
} from '../../index.js';
import {type ChangedEntries} from './check-changes.js';

const gamepadTypeStore = new Store('gamepad-type-indexed-vir');
const savedLayoutsKey = 'saved-layouts';
const savedTypesKey = 'saved-types';
const submittedChangesKey = 'submitted-changes';

async function loadSavedValue<Value>(key: string): Promise<Value | undefined> {
    const storedValue = await gamepadTypeStore.getItem(key);

    return (storedValue ?? undefined) satisfies unknown as Value | undefined;
}

export async function resetAllSavedData() {
    await gamepadTypeStore.clear();
}

export async function loadSavedLayouts(): Promise<ReadonlyArray<Readonly<GamepadLayout>>> {
    return (
        (await loadSavedValue<ReadonlyArray<Readonly<GamepadLayout>>>(savedLayoutsKey)) ??
        defaultGamepadLayouts
    );
}

export async function saveLayouts(layouts: ReadonlyArray<Readonly<GamepadLayout>>): Promise<void> {
    await gamepadTypeStore.setItem(savedLayoutsKey, layouts);
}

export async function loadSavedModelMap(): Promise<Readonly<GamepadModelMap>> {
    const loadedModelMap = (await loadSavedValue<Readonly<GamepadModelMap>>(savedTypesKey)) ?? {};
    return {
        ...defaultGamepadModelMap,
        ...loadedModelMap,
    };
}

export async function saveModelMap(types: Readonly<GamepadModelMap>): Promise<void> {
    await gamepadTypeStore.setItem(savedTypesKey, types);
}

export async function loadSubmittedChanges(): Promise<Readonly<ChangedEntries> | undefined> {
    return (await loadSavedValue<Readonly<ChangedEntries>>(submittedChangesKey)) || undefined;
}

export async function savedSubmittedChanges(changes: Readonly<ChangedEntries>): Promise<void> {
    await gamepadTypeStore.setItem(submittedChangesKey, changes);
}
