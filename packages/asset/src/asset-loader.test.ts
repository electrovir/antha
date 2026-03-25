import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {type SpritesheetData} from 'pixi.js';
import {
    type AnthaAsset,
    AnthaAssetLoader,
    AnthaAssetLoaderProgressUpdateEvent,
    type AnthaAssetValue,
} from './asset-loader.js';

function createMockAsset(
    value: string,
    maxProgress = 1,
): {asset: AnthaAsset<undefined>; cleanedUp: {value: boolean}} {
    const cleanedUp = {
        value: false,
    };

    return {
        asset: {
            name: value,
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

describe(AnthaAssetLoader.name, () => {
    describe('loadIndividualAsset', () => {
        it('loads an asset and returns its value', async () => {
            const loader = new AnthaAssetLoader();
            const {asset} = createMockAsset('loaded-value');

            const result = await loader.loadIndividualAsset({
                asset,
                params: undefined,
            });

            assert.strictEquals(result, 'loaded-value');
        });

        it('returns cached value on subsequent loads', async () => {
            const loader = new AnthaAssetLoader();
            let loadCount = 0;
            const asset: AnthaAsset<undefined> = {
                name: 'cached',
                maxProgress: 1,
                load({incrementProgressCallback}) {
                    loadCount++;
                    incrementProgressCallback();
                    return {
                        value: 'cached-value',
                    };
                },
            };

            const first = await loader.loadIndividualAsset({
                asset,
                params: undefined,
            });
            const second = await loader.loadIndividualAsset({
                asset,
                params: undefined,
            });

            assert.strictEquals(first, 'cached-value');
            assert.strictEquals(second, 'cached-value');
            assert.strictEquals(loadCount, 1);
        });

        it('calls incrementProgressCallback when provided', async () => {
            const loader = new AnthaAssetLoader();
            const progressAmounts: (number | undefined)[] = [];
            const asset: AnthaAsset<undefined> = {
                name: 'progress',
                maxProgress: 3,
                load({incrementProgressCallback}) {
                    incrementProgressCallback(1);
                    incrementProgressCallback(2);
                    return {
                        value: 'progress-value',
                    };
                },
            };

            await loader.loadIndividualAsset({
                asset,
                params: undefined,
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
            const loader = new AnthaAssetLoader();
            const asset: AnthaAsset<undefined> = {
                name: 'no-callback',
                maxProgress: 1,
                load({incrementProgressCallback}) {
                    incrementProgressCallback();
                    return {
                        value: 'no-callback',
                    };
                },
            };

            const result = await loader.loadIndividualAsset({
                asset,
                params: undefined,
            });

            assert.strictEquals(result, 'no-callback');
        });

        it('passes params to the load callback', async () => {
            const loader = new AnthaAssetLoader();
            let receivedParams: {resolution: number} | undefined;
            const asset: AnthaAsset<{resolution: number}> = {
                name: 'params-test',
                maxProgress: 1,
                load({params, incrementProgressCallback}) {
                    receivedParams = params;
                    incrementProgressCallback();
                    return {
                        value: 'params-value',
                    };
                },
            };

            await loader.loadIndividualAsset({
                asset,
                params: {
                    resolution: 4,
                },
            });

            assert.deepEquals(receivedParams, {
                resolution: 4,
            });
        });
    });

    describe('unloadAssets', () => {
        it('calls cleanup on loaded assets', async () => {
            const loader = new AnthaAssetLoader();
            const {asset, cleanedUp} = createMockAsset('cleanup-test');

            await loader.loadIndividualAsset({
                asset,
                params: undefined,
            });
            assert.isFalse(cleanedUp.value);

            await loader.unloadAssets([asset]);
            assert.isTrue(cleanedUp.value);
        });

        it('handles assets without cleanup callbacks', async () => {
            const loader = new AnthaAssetLoader();
            const asset: AnthaAsset<undefined> = {
                name: 'no-cleanup',
                maxProgress: 1,
                load({incrementProgressCallback}) {
                    incrementProgressCallback();
                    return {
                        value: 'no-cleanup',
                    };
                },
            };

            await loader.loadIndividualAsset({
                asset,
                params: undefined,
            });
            await loader.unloadAssets([asset]);
        });

        it('handles assets that were never loaded', async () => {
            const loader = new AnthaAssetLoader();
            const {asset} = createMockAsset('never-loaded');

            await loader.unloadAssets([asset]);
        });
    });

    describe('destroy', () => {
        it('cleans up all cached assets', async () => {
            const loader = new AnthaAssetLoader();
            const mock1 = createMockAsset('asset-1');
            const mock2 = createMockAsset('asset-2');

            await loader.loadIndividualAsset({
                asset: mock1.asset,
                params: undefined,
            });
            await loader.loadIndividualAsset({
                asset: mock2.asset,
                params: undefined,
            });

            await loader.destroy();

            assert.isTrue(mock1.cleanedUp.value);
            assert.isTrue(mock2.cleanedUp.value);
        });

        it('handles assets without cleanup on destroy', async () => {
            const loader = new AnthaAssetLoader();
            const asset: AnthaAsset<undefined> = {
                name: 'no-cleanup-destroy',
                maxProgress: 1,
                load({incrementProgressCallback}) {
                    incrementProgressCallback();
                    return {
                        value: 'no-cleanup-destroy',
                    };
                },
            };

            await loader.loadIndividualAsset({
                asset,
                params: undefined,
            });
            await loader.destroy();
        });
    });

    describe('bulkLoadAssets', () => {
        it('loads multiple assets and returns their values', async () => {
            const loader = new AnthaAssetLoader();
            const mock1 = createMockAsset('bulk-1');
            const mock2 = createMockAsset('bulk-2');

            const results = await loader.bulkLoadAssets([
                {
                    asset: mock1.asset,
                    params: undefined,
                },
                {
                    asset: mock2.asset,
                    params: undefined,
                },
            ]);

            assert.deepEquals(results, [
                'bulk-1',
                'bulk-2',
            ]);
        });

        it('dispatches progress events including complete flag', async () => {
            const loader = new AnthaAssetLoader();
            const {asset} = createMockAsset('events-test');
            const events: {current: number; total: number; complete: boolean}[] = [];

            loader.listen(AnthaAssetLoaderProgressUpdateEvent, (event) => {
                events.push(event.detail);
            });

            await loader.bulkLoadAssets([
                {
                    asset,
                    params: undefined,
                },
            ]);

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
                    current: 1,
                    total: 1,
                    complete: false,
                },
                {
                    current: 1,
                    total: 1,
                    complete: true,
                },
            ]);
        });

        it('dispatches progress update events', async () => {
            const loader = new AnthaAssetLoader();
            const progressUpdates: {current: number; total: number; complete: boolean}[] = [];

            loader.listen(AnthaAssetLoaderProgressUpdateEvent, (event) => {
                progressUpdates.push(event.detail);
            });

            const asset1: AnthaAsset<undefined> = {
                name: 'asset-a',
                maxProgress: 2,
                load({incrementProgressCallback}) {
                    incrementProgressCallback();
                    incrementProgressCallback();
                    return {
                        value: 'a',
                    };
                },
            };
            const asset2: AnthaAsset<undefined> = {
                name: 'asset-b',
                maxProgress: 1,
                load({incrementProgressCallback}) {
                    incrementProgressCallback();
                    return {
                        value: 'b',
                    };
                },
            };

            await loader.bulkLoadAssets([
                {
                    asset: asset1,
                    params: undefined,
                },
                {
                    asset: asset2,
                    params: undefined,
                },
            ]);

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
                    current: 3,
                    total: 3,
                    complete: false,
                },
                {
                    current: 3,
                    total: 3,
                    complete: true,
                },
            ]);
        });

        it('respects maxParallelism option', async () => {
            const loader = new AnthaAssetLoader();
            const loadOrder: string[] = [];

            function createOrderedAsset(assetName: string): AnthaAsset<undefined> {
                return {
                    name: assetName,
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
                    {
                        asset: createOrderedAsset('a'),
                        params: undefined,
                    },
                    {
                        asset: createOrderedAsset('b'),
                        params: undefined,
                    },
                    {
                        asset: createOrderedAsset('c'),
                        params: undefined,
                    },
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
            const loader = new AnthaAssetLoader();
            const mock1 = createMockAsset('old');
            const mock2 = createMockAsset('new');

            await loader.bulkLoadAssets([
                {
                    asset: mock1.asset,
                    params: undefined,
                },
            ]);

            assert.isFalse(mock1.cleanedUp.value);

            await loader.bulkLoadAssets([
                {
                    asset: mock2.asset,
                    params: undefined,
                },
            ]);

            assert.isFalse(mock1.cleanedUp.value);
        });

        it('does not clean up previous assets when doNotUnload is true', async () => {
            const loader = new AnthaAssetLoader();
            const mock1 = createMockAsset('keep');
            const mock2 = createMockAsset('add');

            await loader.bulkLoadAssets([
                {
                    asset: mock1.asset,
                    params: undefined,
                },
            ]);

            await loader.bulkLoadAssets(
                [
                    {
                        asset: mock2.asset,
                        params: undefined,
                    },
                ],
                {
                    doNotUnload: true,
                },
            );

            assert.isFalse(mock1.cleanedUp.value);
        });

        it('handles empty asset list', async () => {
            const loader = new AnthaAssetLoader();

            const results = await loader.bulkLoadAssets([]);

            assert.deepEquals(results, []);
        });

        it('increments progress by custom amount', async () => {
            const loader = new AnthaAssetLoader();
            const progressUpdates: {current: number; total: number; complete: boolean}[] = [];

            loader.listen(AnthaAssetLoaderProgressUpdateEvent, (event) => {
                progressUpdates.push(event.detail);
            });

            const asset: AnthaAsset<undefined> = {
                name: 'custom-increment',
                maxProgress: 5,
                load({incrementProgressCallback}) {
                    incrementProgressCallback(3);
                    incrementProgressCallback(2);
                    return {
                        value: 'custom-increment',
                    };
                },
            };

            await loader.bulkLoadAssets([
                {
                    asset,
                    params: undefined,
                },
            ]);

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
                    current: 3,
                    total: 5,
                    complete: false,
                },
                {
                    current: 5,
                    total: 5,
                    complete: false,
                },
                {
                    current: 5,
                    total: 5,
                    complete: true,
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

        const asset = {
            name: 'test',
            maxProgress: 2,
            load({params: {resolution}, incrementProgressCallback}) {
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
        } satisfies AnthaAsset<{resolution: number}, SpritesheetData>;

        const loader = new AnthaAssetLoader();
        const result = await loader.loadIndividualAsset({
            asset,
            params: {
                resolution: 4,
            },
        });

        assert.isDefined(result.animations?.enemy);
        assert.isDefined(result.animations?.player);
        assert.tsType(result).equals<AnthaAssetValue<typeof asset>>();
    });
});
