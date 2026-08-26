import {emptyAnthaLogger} from '@antha/engine';
import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {type SpritesheetData} from 'pixi.js';
import {
    type Asset,
    AssetLoader,
    AssetLoadSessionUpdateEvent,
    type AssetLoadState,
    type AssetValue,
    defineAsset,
} from './asset-loader.js';

function createMockAsset(
    value: string,
    maxProgress = 1,
): {asset: Asset<string>; cleanedUp: {value: boolean}} {
    const cleanedUp = {
        value: false,
    };

    return {
        asset: {
            assetName: value,
            maxProgress,
            load({incrementProgressCallback}) {
                incrementProgressCallback();
                return {
                    value,
                    cleanup() {
                        cleanedUp.value = true;
                    },
                };
            },
        },
        cleanedUp,
    };
}

describe(AssetLoader.name, () => {
    it('manages its active load session and load state', () => {
        const loader = new AssetLoader();
        const initialLoadSession = loader.currentLoadSession;

        initialLoadSession.reportProgress({
            current: 1,
            currentResourceName: 'initial-asset',
            total: 2,
        });

        const initialLoadState = loader.loadState;
        assert.deepEquals(initialLoadState, {
            current: 1,
            currentResourceName: 'initial-asset',
            total: 2,
            completedAt: undefined,
            isLoading: true,
        } satisfies AssetLoadState);

        const loadSession = loader.createLoadSession();

        assert.strictEquals(loader.currentLoadSession, loadSession);
        const replacementLoadState = loader.loadState;
        assert.deepEquals(replacementLoadState, {
            current: 0,
            currentResourceName: undefined,
            total: 0,
            completedAt: undefined,
            isLoading: true,
        } satisfies AssetLoadState);

        initialLoadSession.reportProgress({
            current: 2,
            currentResourceName: 'stale-asset',
            total: 2,
        });

        const staleLoadState = loader.loadState;
        assert.deepEquals(staleLoadState, {
            current: 0,
            currentResourceName: undefined,
            total: 0,
            completedAt: undefined,
            isLoading: true,
        } satisfies AssetLoadState);

        loader.advanceLoadState({
            currentTick: 0,
            totalMs: 0,
        });
        loadSession.complete();
        loader.advanceLoadState({
            currentTick: 1,
            totalMs: 10,
        });

        const incompleteLoadState = loader.loadState;
        assert.isUndefined(incompleteLoadState?.completedAt);

        loader.advanceLoadState({
            currentTick: 2,
            totalMs: 20,
        });

        const completedLoadState = loader.loadState;
        assert.deepEquals(completedLoadState, {
            current: 0,
            currentResourceName: undefined,
            total: 0,
            completedAt: 20,
            isLoading: false,
        } satisfies AssetLoadState);
    });

    describe('loadIndividualAsset', () => {
        it('loads an asset and returns its value', async () => {
            const loader = new AssetLoader();
            const {asset} = createMockAsset('loaded-value');

            const result = await loader.loadIndividualAsset({
                asset,
            });

            assert.strictEquals(result, 'loaded-value');
        });

        it('returns cached value on subsequent loads', async () => {
            const loader = new AssetLoader();
            let loadCount = 0;
            const asset = defineAsset({
                assetName: 'cached',
                maxProgress: 1,
                load({incrementProgressCallback}) {
                    loadCount++;
                    incrementProgressCallback();
                    return {
                        value: 'cached-value',
                    };
                },
            });

            const first = await loader.loadIndividualAsset({
                asset,
            });
            const second = await loader.loadIndividualAsset({
                asset,
            });

            assert.strictEquals(first, 'cached-value');
            assert.strictEquals(second, 'cached-value');
            assert.strictEquals(loadCount, 1);
        });

        it('calls incrementProgressCallback when provided', async () => {
            const loader = new AssetLoader();
            const progressAmounts: (number | undefined)[] = [];
            const asset = defineAsset({
                assetName: 'progress',
                maxProgress: 3,
                load({incrementProgressCallback}) {
                    incrementProgressCallback(1);
                    incrementProgressCallback(2);
                    return {
                        value: 'progress-value',
                    };
                },
            });

            await loader.loadIndividualAsset({
                asset,
                incrementProgressCallback(amount) {
                    progressAmounts.push(amount);
                },
            });

            assert.deepEquals(
                progressAmounts,
                [
                    1,
                    2,
                ],
            );
        });

        it('works without incrementProgressCallback', async () => {
            const loader = new AssetLoader();
            const asset = defineAsset({
                assetName: 'no-callback',
                maxProgress: 1,
                load({incrementProgressCallback}) {
                    incrementProgressCallback();
                    return {
                        value: 'no-callback',
                    };
                },
            });

            const result = await loader.loadIndividualAsset({
                asset,
            });

            assert.strictEquals(result, 'no-callback');
        });

        it('reports individual asset progress to a load session', async () => {
            const loader = new AssetLoader();
            const loadSession = loader.createLoadSession();
            const completionStates: boolean[] = [];
            const asset = defineAsset({
                assetName: 'session-asset',
                maxProgress: 2,
                load({incrementProgressCallback}) {
                    incrementProgressCallback();
                    incrementProgressCallback();
                    return {
                        value: 'session-value',
                    };
                },
            });

            loadSession.listen(AssetLoadSessionUpdateEvent, (event) => {
                completionStates.push(event.detail.complete);
            });

            await loader.loadIndividualAsset({
                asset,
                loadSession,
            });

            assert.deepEquals(completionStates, [
                false,
                false,
                false,
            ]);

            loadSession.complete();
            loadSession.complete();

            assert.deepEquals(completionStates, [
                false,
                false,
                false,
                true,
            ]);
        });
    });

    describe('unloadAssets', () => {
        it('calls cleanup on loaded assets', async () => {
            const loader = new AssetLoader();
            const {asset, cleanedUp} = createMockAsset('cleanup-test');

            await loader.loadIndividualAsset({
                asset,
            });
            assert.isFalse(cleanedUp.value);

            await loader.unloadAssets([asset]);
            assert.isTrue(cleanedUp.value);
        });

        it('handles assets without cleanup callbacks', async () => {
            const loader = new AssetLoader();
            const asset = defineAsset({
                assetName: 'no-cleanup',
                maxProgress: 1,
                load({incrementProgressCallback}) {
                    incrementProgressCallback();
                    return {
                        value: 'no-cleanup',
                    };
                },
            });

            const value = await loader.loadIndividualAsset({
                asset,
            });
            await loader.unloadAssets([asset]);

            assert.strictEquals(value, 'no-cleanup');
        });

        it('handles assets that were never loaded', async () => {
            const loader = new AssetLoader();
            const {asset, cleanedUp} = createMockAsset('never-loaded');

            await loader.unloadAssets([asset]);

            assert.isFalse(cleanedUp.value);
        });
    });

    describe('destroy', () => {
        it('cleans up all cached assets', async () => {
            const loader = new AssetLoader();
            const mock1 = createMockAsset('asset-1');
            const mock2 = createMockAsset('asset-2');

            await loader.loadIndividualAsset({
                asset: mock1.asset,
            });
            await loader.loadIndividualAsset({
                asset: mock2.asset,
            });

            await loader.destroy();

            assert.isTrue(mock1.cleanedUp.value);
            assert.isTrue(mock2.cleanedUp.value);
        });

        it('handles assets without cleanup on destroy', async () => {
            const loader = new AssetLoader();
            const asset = defineAsset({
                assetName: 'no-cleanup-destroy',
                maxProgress: 1,
                load({incrementProgressCallback}) {
                    incrementProgressCallback();
                    return {
                        value: 'no-cleanup-destroy',
                    };
                },
            });

            const value = await loader.loadIndividualAsset({
                asset,
            });
            await loader.destroy();

            assert.strictEquals(value, 'no-cleanup-destroy');
        });
    });

    describe('bulkLoadAssets', () => {
        it('loads multiple assets and returns their values', async () => {
            const loader = new AssetLoader();
            const mock1 = createMockAsset('bulk-1');
            const mock2 = createMockAsset('bulk-2');

            const results = await loader.bulkLoadAssets([
                mock1.asset,
                mock2.asset,
            ]);

            assert.deepEquals(results, [
                'bulk-1',
                'bulk-2',
            ]);
        });

        it('reports progress to a load session until explicitly completed', async () => {
            const loader = new AssetLoader();
            const loadSession = loader.createLoadSession();
            const {asset} = createMockAsset('events-test');
            const events: {current: number; total: number; complete: boolean}[] = [];

            loadSession.listen(AssetLoadSessionUpdateEvent, (event) => {
                events.push({
                    current: event.detail.current,
                    total: event.detail.total,
                    complete: event.detail.complete,
                });
            });

            await loader.bulkLoadAssets(
                [
                    asset,
                ],
                {
                    loadSession,
                },
            );

            assert.deepEquals(events, [
                {
                    current: 0,
                    total: 1,
                    complete: false,
                },
                {
                    current: 0,
                    total: 1,
                    complete: false,
                },
                {
                    current: 0,
                    total: 1,
                    complete: false,
                },
                {
                    current: 1,
                    total: 1,
                    complete: false,
                },
            ]);

            loadSession.complete();

            assert.deepEquals(events.at(-1), {
                complete: true,
                current: 1,
                total: 1,
            });
        });

        it('reports bulk progress to a load session', async () => {
            const loader = new AssetLoader();
            const loadSession = loader.createLoadSession();
            const progressUpdates: {current: number; total: number; complete: boolean}[] = [];

            loadSession.listen(AssetLoadSessionUpdateEvent, (event) => {
                progressUpdates.push({
                    current: event.detail.current,
                    total: event.detail.total,
                    complete: event.detail.complete,
                });
            });

            const asset1 = defineAsset({
                assetName: 'asset-a',
                maxProgress: 2,
                load({incrementProgressCallback}) {
                    incrementProgressCallback();
                    incrementProgressCallback();
                    return {
                        value: 'a',
                    };
                },
            });
            const asset2 = defineAsset({
                assetName: 'asset-b',
                maxProgress: 1,
                load({incrementProgressCallback}) {
                    incrementProgressCallback();
                    return {
                        value: 'b',
                    };
                },
            });

            await loader.bulkLoadAssets(
                [
                    asset1,
                    asset2,
                ],
                {
                    loadSession,
                },
            );

            assert.deepEquals(progressUpdates, [
                {
                    current: 0,
                    total: 3,
                    complete: false,
                },
                {
                    current: 0,
                    total: 3,
                    complete: false,
                },
                {
                    current: 0,
                    total: 3,
                    complete: false,
                },
                {
                    current: 1,
                    total: 3,
                    complete: false,
                },
                {
                    current: 2,
                    total: 3,
                    complete: false,
                },
                {
                    current: 2,
                    total: 3,
                    complete: false,
                },
                {
                    current: 3,
                    total: 3,
                    complete: false,
                },
            ]);
        });

        it('reports the current asset name to a load session', async () => {
            const loader = new AssetLoader();
            const loadSession = loader.createLoadSession();
            const resourceNames: (string | undefined)[] = [];

            loadSession.listen(AssetLoadSessionUpdateEvent, (event) => {
                resourceNames.push(event.detail.currentResourceName);
            });

            const asset = defineAsset({
                assetName: 'entity:asset',
                maxProgress: 2,
                load({incrementProgressCallback}) {
                    incrementProgressCallback();
                    incrementProgressCallback();
                    return {
                        value: 'asset-value',
                    };
                },
            });

            await loader.bulkLoadAssets(
                [
                    asset,
                ],
                {
                    loadSession,
                },
            );

            assert.deepEquals(resourceNames, [
                'entity:asset',
                'entity:asset',
                'entity:asset',
                'entity:asset',
                'entity:asset',
            ]);
        });

        it('respects maxParallelism option', async () => {
            const loader = new AssetLoader();
            const loadOrder: string[] = [];

            function createOrderedAsset(assetName: string): Asset<string> {
                return {
                    assetName,
                    maxProgress: 1,
                    load({incrementProgressCallback}) {
                        loadOrder.push(assetName);
                        incrementProgressCallback();
                        return {
                            value: assetName,
                        };
                    },
                };
            }

            const results = await loader.bulkLoadAssets(
                [
                    createOrderedAsset('a'),
                    createOrderedAsset('b'),
                    createOrderedAsset('c'),
                ],
                {
                    maxParallelism: 2,
                },
            );

            assert.deepEquals(results, [
                'a',
                'b',
                'c',
            ]);
            assert.isLengthExactly(loadOrder, 3);
        });

        it('cleans up previous assets not in new batch by default', async () => {
            const loader = new AssetLoader();
            const mock1 = createMockAsset('old');
            const mock2 = createMockAsset('new');

            await loader.bulkLoadAssets([
                mock1.asset,
            ]);

            assert.isFalse(mock1.cleanedUp.value);

            await loader.bulkLoadAssets([
                mock2.asset,
            ]);

            assert.isTrue(mock1.cleanedUp.value);
        });

        it('does not clean up previous assets when doNotUnload is true', async () => {
            const loader = new AssetLoader();
            const mock1 = createMockAsset('keep');
            const mock2 = createMockAsset('add');

            await loader.bulkLoadAssets([
                mock1.asset,
            ]);

            await loader.bulkLoadAssets(
                [
                    mock2.asset,
                ],
                {
                    doNotUnload: true,
                },
            );

            assert.isFalse(mock1.cleanedUp.value);
        });

        it('handles empty asset list', async () => {
            const loader = new AssetLoader();

            const results = await loader.bulkLoadAssets([]);

            assert.deepEquals(results, []);
        });

        it('increments progress by custom amount', async () => {
            const loader = new AssetLoader();
            const loadSession = loader.createLoadSession();
            const progressUpdates: {current: number; total: number; complete: boolean}[] = [];

            loadSession.listen(AssetLoadSessionUpdateEvent, (event) => {
                progressUpdates.push({
                    current: event.detail.current,
                    total: event.detail.total,
                    complete: event.detail.complete,
                });
            });

            const asset = defineAsset({
                assetName: 'custom-increment',
                maxProgress: 5,
                load({incrementProgressCallback}) {
                    incrementProgressCallback(3);
                    incrementProgressCallback(2);
                    return {
                        value: 'custom-increment',
                    };
                },
            });

            await loader.bulkLoadAssets(
                [
                    asset,
                ],
                {
                    loadSession,
                },
            );

            assert.deepEquals(progressUpdates, [
                {
                    current: 0,
                    total: 5,
                    complete: false,
                },
                {
                    current: 0,
                    total: 5,
                    complete: false,
                },
                {
                    current: 0,
                    total: 5,
                    complete: false,
                },
                {
                    current: 3,
                    total: 5,
                    complete: false,
                },
                {
                    current: 5,
                    total: 5,
                    complete: false,
                },
            ]);
        });
    });

    it('infers the asset value type', async () => {
        const spriteSizes = {
            enemy: {
                w: 36,
                h: 36,
            },
            player: {
                w: 50,
                h: 50,
            },
        };

        const resolution = 4;

        const asset = {
            assetName: 'test',
            maxProgress: 2,
            load({incrementProgressCallback}) {
                const spritesheetData = {
                    frames: {
                        enemy1: {
                            frame: {
                                x: 0,
                                y: 0,
                                ...spriteSizes.enemy,
                            },
                        },
                        enemy2: {
                            frame: {
                                x: 36,
                                y: 0,
                                ...spriteSizes.enemy,
                            },
                        },
                        enemy3: {
                            frame: {
                                x: 72,
                                y: 0,
                                ...spriteSizes.enemy,
                            },
                        },
                        player1: {
                            frame: {
                                x: 0,
                                y: 36,
                                ...spriteSizes.player,
                            },
                        },
                        player2: {
                            frame: {
                                x: 50,
                                y: 36,
                                ...spriteSizes.player,
                            },
                        },
                        player3: {
                            frame: {
                                x: 100,
                                y: 36,
                                ...spriteSizes.player,
                            },
                        },
                        player4: {
                            frame: {
                                x: 50,
                                y: 36,
                                ...spriteSizes.player,
                            },
                        },
                    },
                    meta: {
                        image: '/sprites/sprites.svg',
                        scale: 1,
                    },
                    animations: {
                        enemy: [
                            'enemy1',
                            'enemy2',
                            'enemy3',
                        ],
                        player: [
                            'player1',
                            'player2',
                            'player3',
                            'player4',
                        ],
                    },
                } satisfies SpritesheetData;

                Object.values(spritesheetData.frames).forEach((frame) => {
                    frame.frame.x *= resolution;
                    frame.frame.y *= resolution;
                    frame.frame.h *= resolution;
                    frame.frame.w *= resolution;
                });

                incrementProgressCallback();
                incrementProgressCallback();

                return {
                    value: spritesheetData,
                };
            },
        } satisfies Asset<SpritesheetData>;

        const loader = new AssetLoader();
        const result = await loader.loadIndividualAsset({
            asset,
        });

        assert.isDefined(result.animations.enemy);
        assert.isDefined(result.animations.player);
        assert.tsType(result).equals<AssetValue<typeof asset>>();
    });

    describe('unloadAssets', () => {
        it('catches and logs cleanup errors', async () => {
            const errors: unknown[] = [];
            const loader = new AssetLoader({
                logger: {
                    ...emptyAnthaLogger,
                    error(message) {
                        errors.push(message);
                    },
                },
            });

            const asset = defineAsset({
                assetName: 'failing-cleanup',
                maxProgress: 1,
                load({incrementProgressCallback}) {
                    incrementProgressCallback();
                    return {
                        value: 'value',
                        cleanup() {
                            throw new Error('cleanup failed');
                        },
                    };
                },
            });

            await loader.loadIndividualAsset({
                asset,
            });
            await loader.unloadAssets([asset]);
            assert.isLengthExactly(errors, 1);
        });
    });

    describe('bulkLoadAssets', () => {
        it('logs error when progress does not reach max', async () => {
            const errors: unknown[] = [];
            const loader = new AssetLoader({
                logger: {
                    ...emptyAnthaLogger,
                    error(message) {
                        errors.push(message);
                    },
                },
            });

            const asset = defineAsset({
                assetName: 'no-progress',
                maxProgress: 5,
                load() {
                    /** Intentionally do not call incrementProgressCallback. */
                    return {
                        value: 'loaded',
                    };
                },
            });

            await loader.bulkLoadAssets([
                asset,
            ]);

            assert.isLengthExactly(errors, 1);
        });

        it('accounts for already loaded assets and cleanup in progress', async () => {
            const loader = new AssetLoader();
            const mock1 = createMockAsset('overlap-1');
            const mock2 = createMockAsset('overlap-2');

            /** Pre-load mock1 so it is already cached. */
            await loader.bulkLoadAssets([
                mock1.asset,
            ]);

            /** Load again with mock1 (overlap) and mock2 (new). */
            const results = await loader.bulkLoadAssets([
                mock1.asset,
                mock2.asset,
            ]);

            assert.deepEquals(results, [
                'overlap-1',
                'overlap-2',
            ]);
        });
    });
});
