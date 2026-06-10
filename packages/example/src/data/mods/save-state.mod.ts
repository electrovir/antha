import {type AnthaAssetModLoadingScreenState, type AnthaAssetModState} from '@antha/asset';
import {defineAnthaMod} from '@antha/engine';
import {ensureErrorAndPrependMessage} from '@augment-vir/common';
import {Store} from 'indexed-vir';
import {emptySaveState, type SaveState, saveStateShape} from '../save-state.js';

const saveStateKey = 'save-state';

export class ExampleSaveStateStore {
    protected readonly store = new Store('example-game-save-state');

    public async storeState(state: SaveState) {
        await this.store.setItem(saveStateKey, state, saveStateShape);
    }

    public async loadState() {
        return await this.store.getItem(saveStateKey, saveStateShape);
    }
}

export type SaveStateModState = {
    saveState: SaveState;
    saveStateLoadPromise: Promise<void> | undefined;
    saveStateStore: ExampleSaveStateStore;
} & AnthaAssetModState;

const sharedLoadingScreenState = {
    total: 1,
    currentResourceName: 'Save data',
} as const satisfies Readonly<Partial<AnthaAssetModLoadingScreenState>>;

export const saveStateMod = defineAnthaMod<SaveStateModState>({
    modName: 'save-state',
    execute({state, engine}) {
        if (!state.saveStateStore) {
            state.saveStateStore = new ExampleSaveStateStore();
        }

        if (!state.saveState && !state.saveStateLoadPromise) {
            state.isShowingLoadingScreen = true;
            state.loadingScreenState = {
                ...sharedLoadingScreenState,
                current: 0,
                completedAt: undefined,
            };

            state.saveStateLoadPromise = state.saveStateStore
                .loadState()
                .then((savedState) => {
                    state.saveState = savedState || emptySaveState;
                })
                .catch((error: unknown) => {
                    state.saveState = emptySaveState;
                    engine.log.error(
                        ensureErrorAndPrependMessage(error, 'Failed to load saved game state.'),
                    );
                })
                .finally(() => {
                    state.saveStateLoadPromise = undefined;
                    state.isShowingLoadingScreen = false;
                    state.loadingScreenState = {
                        ...sharedLoadingScreenState,
                        current: 1,
                        completedAt: performance.now() - engine.engineStartTime,
                    };
                });
        }
    },
});
