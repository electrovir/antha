import {type AnthaLogger, browserAnthaLogger} from '@antha/engine';
import {
    type ArrayElement,
    awaitedBlockingMap,
    awaitedForEach,
    chunkArray,
    DeferredPromise,
    ensureErrorAndPrependMessage,
    type MaybePromise,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {defineTypedCustomEvent, ListenTarget} from 'typed-event-target';

/**
 * Call this to increment the loading progress of this asset. It is expected that this gets called
 * enough times to increment the progress count until the asset's `maxProgress` is reached.
 *
 * @category Internal
 */
export type AssetIncrementProgressCallback = (
    /** The amount that the progress should be incremented with this call. */
    amount?: number | undefined,
) => void;

/**
 * A callback for loading / creating an {@link Asset} value.
 *
 * @category Internal
 */
export type AssetLoaderCallback<AssetValue> = (
    params: Readonly<{
        /**
         * Call this to increment the loading progress of this asset. It is expected that this gets
         * called enough times to increment the progress count until the asset's `maxProgress` is
         * reached.
         */
        incrementProgressCallback: AssetIncrementProgressCallback;
    }>,
) => MaybePromise<AssetLoaderResult<AssetValue>>;

/**
 * A loaded {@link Asset} result, returned from {@link AssetLoaderCallback}
 *
 * @category Internal
 */
export type AssetLoaderResult<AssetValue = any> = {
    value: AssetValue;
    cleanup?: undefined | AssetCleanupCallback;
};

/**
 * Cleanup callback for {@link Asset}.
 *
 * @category Internal
 */
export type AssetCleanupCallback = () => MaybePromise<void>;

/**
 * Extracts the loaded value type from an {@link Asset}.
 *
 * @category Internal
 */
export type AssetValue<SpecificAsset extends Pick<Asset, 'load'>> = Awaited<
    ReturnType<SpecificAsset['load']>
>['value'];

/**
 * Defines a loadable asset.
 *
 * @category Asset
 */
export type Asset<AssetValue = any> = {
    name: string;
    maxProgress: number;
    load: AssetLoaderCallback<AssetValue>;
};

/**
 * A helper for defining and inferring the value type of an {@link Asset}.
 *
 * @category Asset
 */
export function defineAsset<AssetValue>(asset: Asset<AssetValue>): Asset<NoInfer<AssetValue>> {
    return asset;
}

/**
 * Options for {@link AssetLoader.bulkLoadAssets}.
 *
 * @category Internal
 */
export type AssetBulkLoaderLoadOptions = PartialWithUndefined<{
    /**
     * How many assets can be loaded in parallel at once.
     *
     * @default Infinity // no limit
     */
    maxParallelism: number;
    /**
     * If `true`, previous assets will not be unloaded. By default, when loading new bulk assets,
     * all previous assets that are not included in the new asset list will be cleaned up.
     *
     * @default false
     */
    doNotUnload: boolean;
    /**
     * If `true`, the loading screen events will not be emitted.
     *
     * @default false
     */
    hideLoadingScreen: boolean;
}>;

/**
 * Options for {@link AssetLoader}.
 *
 * @category Internal
 */
export type AssetLoaderOptions = PartialWithUndefined<{
    /**
     * A custom logger to handle mod and engine logs. By default, this merely logs to the browser
     * console.
     */
    logger: AnthaLogger;
}>;

/**
 * Custom event dispatched by {@link AssetLoader} whenever bulk loading progress changes. Used for
 * loading screen progression.
 *
 * @category Internal
 */
export class AssetLoaderProgressUpdateEvent extends defineTypedCustomEvent<{
    current: number;
    total: number;
    currentResourceName?: string | undefined;
    /**
     * Always check this complete field first, as any misconfigured assets ma not correctly
     * increment `total` but complete will always reliably mark the end of loading.
     */
    complete: boolean;
}>()('antha-asset-loader-progress-update-event') {}

/**
 * Manages loading, caching, and cleanup of game assets with progress tracking.
 *
 * @category Asset
 */
export class AssetLoader extends ListenTarget<AssetLoaderProgressUpdateEvent> {
    constructor(options: Readonly<AssetLoaderOptions> = {}) {
        super();
        this.log = options.logger || browserAnthaLogger;
    }

    /** Logs data. This will use the user's provided logger or default to browser logs. */
    protected readonly log: AnthaLogger;

    protected readonly assetCache = new Map<Readonly<Asset>, Promise<AssetLoaderResult>>();

    /** Loads a single asset, returning its cached value if already loaded. */
    public async loadIndividualAsset<ThisAsset extends Asset>({
        asset,
        incrementProgressCallback,
    }: Readonly<{
        asset: Readonly<ThisAsset>;
        incrementProgressCallback?: AssetIncrementProgressCallback | undefined;
    }>): Promise<AssetValue<ThisAsset>> {
        const cached = this.assetCache.get(asset);
        if (cached) {
            const assetResult: AssetLoaderResult = await cached;

            return assetResult.value;
        }

        const deferredLoadPromise = new DeferredPromise<AssetLoaderResult>();

        this.assetCache.set(asset, deferredLoadPromise.promise);

        const loadedAsset = await asset.load({
            incrementProgressCallback(progressParams) {
                incrementProgressCallback?.(progressParams);
            },
        });

        deferredLoadPromise.resolve(loadedAsset);

        return loadedAsset.value;
    }

    /** Runs cleanup callbacks for the given assets and removes them from the cache. */
    public async unloadAssets(assets: ReadonlyArray<Asset>) {
        await awaitedForEach(assets, async (asset) => {
            const entry = await this.assetCache.get(asset);

            if (entry?.cleanup) {
                try {
                    await entry.cleanup();
                } catch (error) {
                    this.log.error(
                        ensureErrorAndPrependMessage(
                            error,
                            `Failed to cleanup asset: ${asset.name}`,
                        ),
                    );
                }
            }
            this.assetCache.delete(asset);
        });
    }

    public override async destroy() {
        super.destroy();
        const entries = Array.from(this.assetCache.entries());
        await awaitedForEach(
            entries,
            async ([
                asset,
                result,
            ]) => {
                await (await result).cleanup?.();
                this.assetCache.delete(asset);
            },
        );
    }

    /** Loads multiple assets. */
    public async bulkLoadAssets(
        assets: ReadonlyArray<Readonly<Asset>>,
        options: Readonly<AssetBulkLoaderLoadOptions> = {},
    ): Promise<ReadonlyArray<unknown>> {
        const assetsToCleanup = options.doNotUnload
            ? []
            : Array.from(this.assetCache.keys()).filter((asset) => {
                  return !assets.includes(asset);
              });

        const assetsToLoad = assets.filter((asset) => {
            return !this.assetCache.has(asset);
        });

        const cleanupCount = assetsToCleanup.length ? 1 : 0;

        const maxProgress =
            assetsToLoad.reduce((count, asset) => {
                return count + asset.maxProgress;
            }, 0) + cleanupCount;

        let currentProgress = 0;

        if (!options.hideLoadingScreen && assetsToLoad.length) {
            this.dispatchProgressUpdate({
                current: currentProgress,
                total: maxProgress,
                currentResourceName: assetsToLoad[0]?.name,
                complete: false,
            });
        }

        await this.unloadAssets(assetsToCleanup);

        if (!assetsToLoad.length) {
            return assets.map((asset) => this.assetCache.get(asset));
        }

        currentProgress += cleanupCount;
        if (!options.hideLoadingScreen) {
            this.dispatchProgressUpdate({
                current: currentProgress,
                total: maxProgress,
                currentResourceName: assetsToLoad[0]?.name,
                complete: false,
            });
        }

        const chunkedAssets: ArrayElement<typeof assetsToLoad>[][] = options.maxParallelism
            ? chunkArray(assets, {
                  chunkSize: options.maxParallelism,
              })
            : [[...assets]];

        const createIncrementProgressCallback = (
            asset: Readonly<Asset>,
        ): AssetIncrementProgressCallback => {
            return (amount) => {
                currentProgress += amount ?? 1;
                if (!options.hideLoadingScreen) {
                    this.dispatchProgressUpdate({
                        current: currentProgress,
                        total: maxProgress,
                        currentResourceName: asset.name,
                        complete: false,
                    });
                }
            };
        };

        const results: unknown[] = (
            await awaitedBlockingMap(chunkedAssets, async (assetChunk) => {
                return await Promise.all(
                    assetChunk.map(async (asset) => {
                        if (this.assetCache.has(asset)) {
                            return (await this.assetCache.get(asset))?.value;
                        }

                        if (!options.hideLoadingScreen) {
                            this.dispatchProgressUpdate({
                                current: currentProgress,
                                total: maxProgress,
                                currentResourceName: asset.name,
                                complete: false,
                            });
                        }

                        return await this.loadIndividualAsset({
                            incrementProgressCallback: createIncrementProgressCallback(asset),
                            asset,
                        });
                    }),
                );
            })
        ).flat();

        if (currentProgress !== maxProgress) {
            this.log.error(
                new Error('Finished loading assets but did not reach max loading progress.'),
                {
                    context: {
                        currentProgress,
                        maxProgress,
                        assetCount: assetsToLoad.length,
                        assetNames: assetsToLoad.map((entry) => entry.name).filter(Boolean),
                    },
                    tags: {
                        mod: '@antha/asset',
                    },
                },
            );
        }
        if (!options.hideLoadingScreen) {
            this.dispatchProgressUpdate({
                current: maxProgress,
                total: maxProgress,
                currentResourceName: assetsToLoad[assetsToLoad.length - 1]?.name,
                complete: true,
            });
        }

        return results;
    }

    /** Dispatch a loading progress event for the active bulk load. */
    protected dispatchProgressUpdate(
        detail: ConstructorParameters<typeof AssetLoaderProgressUpdateEvent>[0]['detail'],
    ): void {
        this.dispatch(
            new AssetLoaderProgressUpdateEvent({
                detail,
            }),
        );
    }
}
