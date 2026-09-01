import {AnthaEngine, emptyAnthaLogger} from '@antha/engine';
import {assert, waitUntil} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {LocalDbClient} from 'local-db-client';
import {defineShape, type Shape} from 'object-shape-tester';
import {AssetLoader} from './asset-loader.js';
import {createSaveGameSuite, type AutosaveModState, type SaveGameSuite} from './save-game-suite.js';

type SaveState = {
    value: number;
};

const saveDataStoreName = 'Game Save';
const storedSaveStateShape = defineShape({
    storedValue: 0,
});
const identityStoredSaveStateShape = defineShape({
    value: 0,
});

function createTestLocalDbClient<StoredSaveStateShape extends Shape>({
    storedSaveStateShape,
}: Readonly<{
    storedSaveStateShape: StoredSaveStateShape;
}>) {
    return LocalDbClient.createClient(
        {
            saveState: {
                shape: storedSaveStateShape,
            },
        },
        {
            storeName: saveDataStoreName,
        },
    );
}

async function clearTestStorage<StoredSaveStateShape extends Shape>({
    storedSaveStateShape,
}: Readonly<{
    storedSaveStateShape: StoredSaveStateShape;
}>) {
    const localDbClient = await createTestLocalDbClient({
        storedSaveStateShape,
    });

    await localDbClient.clear();
}

function createTransformedTestSuite() {
    return createSaveGameSuite({
        fallbackState: {
            value: 0,
        },
        deserialize(storedSaveState) {
            return {
                value: storedSaveState.storedValue,
            };
        },
        serialize(saveState) {
            return {
                storedValue: saveState.value,
            };
        },
        storedSaveStateShape,
    });
}

function createIdentityTestSuite() {
    return createSaveGameSuite({
        fallbackState: {
            value: 0,
        },
        storedSaveStateShape: identityStoredSaveStateShape,
    });
}

function createTestEngine({
    saveState,
    suite,
}: Readonly<{
    saveState: SaveState;
    suite: SaveGameSuite<SaveState>;
}>) {
    const engine = new AnthaEngine<AutosaveModState<SaveState>>({
        engineOptions: {
            logger: emptyAnthaLogger,
        },
        mods: [
            suite.anthaAutosaveMod,
        ],
    });

    engine.state.autosaveInterval = {
        milliseconds: 0,
    };
    engine.state.saveState = saveState;

    return engine;
}

async function runAutosave(engine: AnthaEngine<AutosaveModState<SaveState>>) {
    await engine.runSingleTick();
    await waitUntil.isDefined(() => engine.state.lastAutosaveSuccess);
}

describe(createSaveGameSuite.name, () => {
    it('creates a Save Data asset', () => {
        const suite = createIdentityTestSuite();

        assert.strictEquals(suite.loadSaveDataAsset.assetName, 'Save Data');
    });

    it('loads its fallback state and saves directly when transforms are omitted', async () => {
        await clearTestStorage({
            storedSaveStateShape: identityStoredSaveStateShape,
        });

        const suite = createIdentityTestSuite();
        const assetLoader = new AssetLoader();
        const loadedSaveGame = await assetLoader.loadIndividualAsset({
            asset: suite.loadSaveDataAsset,
        });
        const engine = createTestEngine({
            saveState: loadedSaveGame.saveState,
            suite,
        });

        await runAutosave(engine);
        engine.state.saveState = {
            value: 1,
        };
        await engine.reset();

        const localDbClient = await createTestLocalDbClient({
            storedSaveStateShape: identityStoredSaveStateShape,
        });

        assert.deepEquals(
            {
                loadedSaveState: loadedSaveGame.saveState,
                storedSaveState: await localDbClient.load.saveState(),
            },
            {
                loadedSaveState: {
                    value: 0,
                },
                storedSaveState: {
                    value: 1,
                },
            },
        );
    });

    it('deserializes loaded state and serializes the final save state', async () => {
        await clearTestStorage({
            storedSaveStateShape,
        });

        const initialLocalDbClient = await createTestLocalDbClient({
            storedSaveStateShape,
        });
        await initialLocalDbClient.set.saveState({
            storedValue: 1,
        });

        const suite = createTransformedTestSuite();
        const assetLoader = new AssetLoader();
        const loadedSaveGame = await assetLoader.loadIndividualAsset({
            asset: suite.loadSaveDataAsset,
        });
        const engine = createTestEngine({
            saveState: loadedSaveGame.saveState,
            suite,
        });

        await runAutosave(engine);
        engine.state.saveState = {
            value: 2,
        };
        await engine.reset();

        assert.deepEquals(
            {
                loadedSaveState: loadedSaveGame.saveState,
                storedSaveState: await initialLocalDbClient.load.saveState(),
            },
            {
                loadedSaveState: {
                    value: 1,
                },
                storedSaveState: {
                    storedValue: 2,
                },
            },
        );
    });
});
