import {AnthaEngine, createEngineTime, emptyAnthaLogger} from '@antha/engine';
import {assert, assertWrap, waitUntil} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {LocalDbClient} from 'local-db-client';
import {defineShape, type Shape} from 'object-shape-tester';
import {AssetLoader} from './asset-loader.js';
import {createSaveGameSuite, type AutosaveModState, type SaveGameSuite} from './save-game-suite.js';

type SaveState = {
    value: number;
};

const saveDataStoreName = 'Save Game Suite Test';
const storedSaveStateShape = defineShape({
    storedValue: 0,
});
const identityStoredSaveStateShape = defineShape({
    value: 0,
});

function createTestLocalDbClient<StoredSaveStateShape extends Shape>({
    storeName = saveDataStoreName,
    storedSaveStateShape,
}: Readonly<{
    storeName?: string | undefined;
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
    storeName,
    storedSaveStateShape,
}: Readonly<{
    storeName?: string | undefined;
    storedSaveStateShape: StoredSaveStateShape;
}>) {
    const localDbClient = await createTestLocalDbClient({
        storeName,
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
        storeName: saveDataStoreName,
        storedSaveStateShape,
    });
}

function createIdentityTestSuite() {
    return createSaveGameSuite({
        fallbackState: {
            value: 0,
        },
        storeName: saveDataStoreName,
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
    it('creates a Save Data asset with its default store', async () => {
        await clearTestStorage({
            storeName: 'Game Save Data',
            storedSaveStateShape: identityStoredSaveStateShape,
        });

        const suite = createSaveGameSuite({
            fallbackState: {
                value: 0,
            },
            storedSaveStateShape: identityStoredSaveStateShape,
        });
        const assetLoader = new AssetLoader();
        const loadedSaveGame = await assetLoader.loadIndividualAsset({
            asset: suite.loadSaveDataAsset,
        });

        assert.deepEquals(
            {
                assetName: suite.loadSaveDataAsset.assetName,
                saveState: loadedSaveGame.saveState,
            },
            {
                assetName: 'Save Data',
                saveState: {
                    value: 0,
                },
            },
        );
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

    it('loads stored state directly when deserialization is omitted', async () => {
        await clearTestStorage({
            storedSaveStateShape: identityStoredSaveStateShape,
        });

        const localDbClient = await createTestLocalDbClient({
            storedSaveStateShape: identityStoredSaveStateShape,
        });
        await localDbClient.set.saveState({
            value: 1,
        });

        const suite = createIdentityTestSuite();
        const assetLoader = new AssetLoader();
        const loadedSaveGame = await assetLoader.loadIndividualAsset({
            asset: suite.loadSaveDataAsset,
        });

        assert.deepEquals(loadedSaveGame.saveState, {
            value: 1,
        });
    });

    it('uses an asynchronous fallback state factory', async () => {
        await clearTestStorage({
            storedSaveStateShape: identityStoredSaveStateShape,
        });

        const suite = createSaveGameSuite({
            fallbackState() {
                return Promise.resolve({
                    value: 1,
                });
            },
            storeName: saveDataStoreName,
            storedSaveStateShape: identityStoredSaveStateShape,
        });
        const assetLoader = new AssetLoader();
        const loadedSaveGame = await assetLoader.loadIndividualAsset({
            asset: suite.loadSaveDataAsset,
        });

        assert.deepEquals(loadedSaveGame.saveState, {
            value: 1,
        });
    });

    it('throws when stored state cannot be deserialized', async () => {
        await clearTestStorage({
            storedSaveStateShape: identityStoredSaveStateShape,
        });

        const localDbClient = await createTestLocalDbClient({
            storedSaveStateShape: identityStoredSaveStateShape,
        });
        await localDbClient.set.saveState({
            value: 1,
        });

        const suite = createSaveGameSuite({
            fallbackState: {
                value: 0,
            },
            deserialize(): SaveState {
                throw new Error('Expected deserialization failure.');
            },
            storeName: saveDataStoreName,
            storedSaveStateShape: identityStoredSaveStateShape,
        });
        const assetLoader = new AssetLoader();

        await assert.throws(
            () => {
                return assetLoader.loadIndividualAsset({
                    asset: suite.loadSaveDataAsset,
                });
            },
            {
                matchMessage: 'Expected deserialization failure.',
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

    it('respects configured and default autosave intervals', async () => {
        await clearTestStorage({
            storedSaveStateShape: identityStoredSaveStateShape,
        });

        const suite = createIdentityTestSuite();
        const engine = createTestEngine({
            saveState: {
                value: 0,
            },
            suite,
        });
        await runAutosave(engine);

        engine.state.autosaveInterval = {
            milliseconds: Number.MAX_SAFE_INTEGER,
        };
        engine.state.saveState = {
            value: 1,
        };
        await engine.runSingleTick();

        delete engine.state.autosaveInterval;
        await engine.runSingleTick();

        const localDbClient = await createTestLocalDbClient({
            storedSaveStateShape: identityStoredSaveStateShape,
        });

        assert.deepEquals(await localDbClient.load.saveState(), {
            value: 0,
        });
    });

    it('does nothing when a save is already in progress', async () => {
        await clearTestStorage({
            storedSaveStateShape: identityStoredSaveStateShape,
        });

        const suite = createIdentityTestSuite();
        const engine = createTestEngine({
            saveState: {
                value: 1,
            },
            suite,
        });
        engine.state.savingStaredAt = createEngineTime({
            milliseconds: 1,
        });

        await engine.runSingleTick();
        await engine.reset();

        const localDbClient = await createTestLocalDbClient({
            storedSaveStateShape: identityStoredSaveStateShape,
        });

        assert.isUndefined(await localDbClient.load.saveState());
    });

    it('does nothing when engine state has no save state', async () => {
        const suite = createIdentityTestSuite();
        const engine = new AnthaEngine<AutosaveModState<SaveState>>({
            engineOptions: {
                logger: emptyAnthaLogger,
            },
            mods: [
                suite.anthaAutosaveMod,
            ],
        });

        await engine.runSingleTick();
        await engine.reset();

        assert.deepEquals(engine.state, {});
    });

    it('records failed autosaves as failures', async () => {
        await clearTestStorage({
            storedSaveStateShape: identityStoredSaveStateShape,
        });

        const suite = createSaveGameSuite({
            fallbackState: {
                value: 0,
            },
            serialize() {
                throw new Error('Expected serialization failure.');
            },
            storeName: saveDataStoreName,
            storedSaveStateShape: identityStoredSaveStateShape,
        });
        const engine = createTestEngine({
            saveState: {
                value: 1,
            },
            suite,
        });

        await engine.runSingleTick();
        await waitUntil.isDefined(() => engine.state.lastAutosaveFailure);

        assert.deepEquals(
            {
                errorMessage: assertWrap.isDefined(engine.state.lastAutosaveFailure).error.message,
                lastAutosaveSuccess: engine.state.lastAutosaveSuccess,
                savingStartedAt: engine.state.savingStaredAt,
            },
            {
                errorMessage: 'Failed to save game data.',
                lastAutosaveSuccess: undefined,
                savingStartedAt: undefined,
            },
        );
    });
});
