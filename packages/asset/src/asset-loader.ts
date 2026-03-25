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
import {type AnthaLogger, browserAnthaLogger} from 'antha';
import {defineTypedCustomEvent, ListenTarget} from 'typed-event-target';

/**
 * Call this to increment the loading progress of this asset. It is expected that this gets called
 * enough times to increment the progress count until the asset's `maxProgress` is reached.
 *
 * @category Internal
 */
export type AnthaAssetIncrementProgressCallback = (
    /** The amount that the progress should be incremented with this call. */
    amount?: number | undefined,
) => void;

export type AnthaAssetLoaderCallback<Params, AssetValue> = (
    params: Readonly<{
        /**
         * Call this to increment the loading progress of this asset. It is expected that this gets
         * called enough times to increment the progress count until the asset's `maxProgress` is
         * reached.
         */
        incrementProgressCallback: AnthaAssetIncrementProgressCallback;
        params: Readonly<Params>;
    }>,
) => MaybePromise<AnthaAssetLoaderResult<AssetValue>>;

export type AnthaAssetLoaderResult<AssetValue = any> = {
    value: AssetValue;
    cleanup?: undefined | AnthaAssetCleanupCallback;
};

export type AnthaAssetCleanupCallback = () => MaybePromise<void>;

export type AnthaAssetValue<Asset extends Pick<AnthaAsset, 'load'>> = Awaited<
    ReturnType<Asset['load']>
>['value'];

export type AnthaAsset<Params = any, AssetValue = any> = {
    name: string;
    maxProgress: number;
    load: AnthaAssetLoaderCallback<Params, AssetValue>;
};

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
}>;

/**
 * Options for {@link AnthaAssetLoader}.
 *
 * @category Internal
 */
export type AnthaAssetLoaderOptions = PartialWithUndefined<{
    /**
     * A custom logger to handle mod and engine logs. By default, this merely logs to the browser
     * console.
     */
    logger: AnthaLogger;
}>;

export class AnthaAssetLoaderProgressUpdateEvent extends defineTypedCustomEvent<{
    current: number;
    total: number;
    /**
     * Always check this complete field first, as any misconfigured assets ma not correctly
     * increment `total` but complete will always reliably mark the end of loading.
     */
    complete: boolean;
}>()('antha-asset-loader-progress-update-event') {}

export class AnthaAssetLoader extends ListenTarget<AnthaAssetLoaderProgressUpdateEvent> {
    constructor(options: Readonly<AnthaAssetLoaderOptions> = {}) {
        super();
        this.log = options.logger || browserAnthaLogger;
    }

    /** Logs data. This will use the user's provided logger or default to browser logs. */
    protected readonly log: AnthaLogger;

    protected readonly assetCache = new Map<
        Readonly<AnthaAsset>,
        Promise<AnthaAssetLoaderResult>
    >();

    public async loadIndividualAsset<Params, Asset extends AnthaAsset<Params>>({
        asset,
        incrementProgressCallback,
        params,
    }: Readonly<{
        params: Params;
        asset: Readonly<Asset>;
        incrementProgressCallback?: AnthaAssetIncrementProgressCallback | undefined;
    }>): Promise<AnthaAssetValue<Asset>> {
        const cached = this.assetCache.get(asset);
        if (cached) {
            const assetResult: AnthaAssetLoaderResult<AnthaAssetValue<Asset>> = await cached;

            return assetResult.value;
        }

        const deferredLoadPromise = new DeferredPromise<
            AnthaAssetLoaderResult<AnthaAssetValue<Asset>>
        >();

        this.assetCache.set(asset, deferredLoadPromise.promise);

        const loadedAsset = await asset.load({
            params,
            incrementProgressCallback(progressParams) {
                incrementProgressCallback?.(progressParams);
            },
        });

        deferredLoadPromise.resolve(loadedAsset);

        return loadedAsset.value;
    }

    public async unloadAssets(assets: ReadonlyArray<AnthaAsset>) {
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

    public async bulkLoadAssets(
        assets: ReadonlyArray<{
            params: any;
            asset: AnthaAsset;
        }>,
        options: Readonly<AssetBulkLoaderLoadOptions> = {},
    ): Promise<ReadonlyArray<unknown>> {
        const rawAssets = assets.map((asset) => asset.asset);

        const assetsToCleanup = options.doNotUnload
            ? []
            : Array.from(this.assetCache.keys()).filter((asset) => {
                  return rawAssets.includes(asset);
              });

        const cleanupCount = assetsToCleanup.length ? 1 : 0;

        const alreadyLoadedProgress = assets.reduce((sum, entry) => {
            return sum + (this.assetCache.has(entry.asset) ? entry.asset.maxProgress : 0);
        }, 0);

        const maxProgress =
            assets.reduce((count, asset) => {
                return count + asset.asset.maxProgress;
            }, 0) + cleanupCount;

        let currentProgress = alreadyLoadedProgress;

        this.dispatch(
            new AnthaAssetLoaderProgressUpdateEvent({
                detail: {
                    current: 0,
                    total: maxProgress,
                    complete: false,
                },
            }),
        );

        await this.unloadAssets(assetsToCleanup);

        currentProgress += cleanupCount;

        this.dispatch(
            new AnthaAssetLoaderProgressUpdateEvent({
                detail: {
                    current: currentProgress,
                    total: maxProgress,
                    complete: false,
                },
            }),
        );

        const chunkedAssets: ArrayElement<typeof assets>[][] = options.maxParallelism
            ? chunkArray(assets, {
                  chunkSize: options.maxParallelism,
              })
            : [[...assets]];

        const incrementProgressCallback: AnthaAssetIncrementProgressCallback = (amount) => {
            currentProgress += amount ?? 1;
            this.dispatch(
                new AnthaAssetLoaderProgressUpdateEvent({
                    detail: {
                        current: currentProgress,
                        total: maxProgress,
                        complete: false,
                    },
                }),
            );
        };

        const results: unknown[] = (
            await awaitedBlockingMap(chunkedAssets, async (assetChunk) => {
                return await Promise.all(
                    assetChunk.map(async ({asset, params}) => {
                        return await this.loadIndividualAsset({
                            incrementProgressCallback,
                            asset,
                            params,
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
                        assetCount: assets.length,
                        assetNames: assets.map((entry) => entry.asset.name).filter(Boolean),
                    },
                    tags: {
                        mod: '@antha/asset',
                    },
                },
            );
        }

        this.dispatch(
            new AnthaAssetLoaderProgressUpdateEvent({
                detail: {
                    current: maxProgress,
                    total: maxProgress,
                    complete: true,
                },
            }),
        );

        return results;
    }
}
