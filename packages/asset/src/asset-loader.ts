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
    /** Receives this bulk load's progress. */
    loadSession: AssetLoadSession;
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

/** Progress tracked by an {@link AssetLoadSession}. */
export type AssetLoadProgress = {
    current: number;
    total: number;
    currentResourceName?: string | undefined;
};

/** State of the active asset load. */
export type AssetLoadState = AssetLoadProgress & {
    completedAt: DOMHighResTimeStamp | undefined;
    isLoading: boolean;
};

/** Event dispatched when an {@link AssetLoadSession} progresses or completes. */
export class AssetLoadSessionUpdateEvent extends defineTypedCustomEvent<
    AssetLoadProgress & {
        /** Indicates that the caller explicitly requested load completion. */
        complete: boolean;
    }
>()('antha-asset-load-session-update-event') {}

/** Manages the progress and explicit completion of an asset load. */
export class AssetLoadSession extends ListenTarget<AssetLoadSessionUpdateEvent> {
    protected currentProgress: AssetLoadProgress = {
        current: 0,
        currentResourceName: undefined,
        total: 0,
    };

    protected isComplete = false;

    /** Reports a load-progress update without completing the session. */
    public reportProgress(progress: Readonly<AssetLoadProgress>) {
        this.currentProgress = progress;
        this.isComplete = false;
        this.dispatch(
            new AssetLoadSessionUpdateEvent({
                detail: {
                    ...progress,
                    complete: false,
                },
            }),
        );
    }

    /** Adds progress to the active resource. */
    public incrementProgress({
        amount,
        currentResourceName,
    }: Readonly<{
        amount?: number | undefined;
        currentResourceName: string;
    }>) {
        this.reportProgress({
            ...this.currentProgress,
            current: this.currentProgress.current + (amount ?? 1),
            currentResourceName,
        });
    }

    /** Marks this asset load as complete. */
    public complete() {
        if (this.isComplete) {
            return;
        }

        this.isComplete = true;
        this.dispatch(
            new AssetLoadSessionUpdateEvent({
                detail: {
                    ...this.currentProgress,
                    complete: true,
                },
            }),
        );
    }
}

class AssetLoadSessionController {
    protected currentLoadSessionInternal: AssetLoadSession;
    protected loadStateInternal: AssetLoadState | undefined;
    protected completionRequestedAtTick: number | undefined;
    protected latestEngineTick = 0;
    protected removeLoadSessionListener: (() => boolean) | undefined;

    constructor() {
        const initialLoadSession = new AssetLoadSession();
        this.currentLoadSessionInternal = initialLoadSession;
        this.listenToLoadSession(initialLoadSession);
    }

    public get currentLoadSession() {
        return this.currentLoadSessionInternal;
    }

    public get loadState() {
        return this.loadStateInternal;
    }

    public createLoadSession() {
        const loadSession = new AssetLoadSession();
        this.removeLoadSessionListener?.();
        this.currentLoadSessionInternal = loadSession;
        this.listenToLoadSession(loadSession);
        loadSession.reportProgress({
            current: 0,
            total: 0,
        });

        return loadSession;
    }

    public advance({
        currentTick,
        totalMs,
    }: Readonly<{
        currentTick: number;
        totalMs: DOMHighResTimeStamp;
    }>) {
        this.latestEngineTick = currentTick + 1;

        if (
            this.completionRequestedAtTick != undefined &&
            this.completionRequestedAtTick < currentTick &&
            this.loadStateInternal
        ) {
            this.completionRequestedAtTick = undefined;
            this.loadStateInternal = {
                ...this.loadStateInternal,
                completedAt: totalMs,
                isLoading: false,
            };
        }
    }

    public destroy() {
        this.removeLoadSessionListener?.();
        this.currentLoadSessionInternal.destroy();
        this.completionRequestedAtTick = undefined;
        this.loadStateInternal = undefined;
    }

    protected listenToLoadSession(loadSession: AssetLoadSession) {
        this.removeLoadSessionListener = loadSession.listen(
            AssetLoadSessionUpdateEvent,
            (event) => {
                if (event.detail.complete) {
                    this.completionRequestedAtTick = this.latestEngineTick;
                } else {
                    this.completionRequestedAtTick = undefined;
                    this.loadStateInternal = {
                        current: event.detail.current,
                        currentResourceName: event.detail.currentResourceName,
                        total: event.detail.total,
                        completedAt: undefined,
                        isLoading: true,
                    };
                }
            },
        );
    }
}

/**
 * Manages loading, caching, and cleanup of game assets with progress tracking.
 *
 * @category Asset
 */
export class AssetLoader {
    constructor(options: Readonly<AssetLoaderOptions> = {}) {
        this.log = options.logger || browserAnthaLogger;
    }

    /** Logs data. This will use the user's provided logger or default to browser logs. */
    protected readonly log: AnthaLogger;

    protected readonly assetCache = new Map<Readonly<Asset>, Promise<AssetLoaderResult>>();

    protected readonly loadSessionController = new AssetLoadSessionController();

    /** The active asset-load session. */
    public get currentLoadSession() {
        return this.loadSessionController.currentLoadSession;
    }

    /** The active asset-load state. */
    public get loadState() {
        return this.loadSessionController.loadState;
    }

    /** Creates and activates a new asset-load session. */
    public createLoadSession() {
        return this.loadSessionController.createLoadSession();
    }

    /** Advances asset-load completion after an engine render. */
    public advanceLoadState({
        currentTick,
        totalMs,
    }: Readonly<{
        currentTick: number;
        totalMs: DOMHighResTimeStamp;
    }>) {
        this.loadSessionController.advance({
            currentTick,
            totalMs,
        });
    }

    /** Loads a single asset, returning its cached value if already loaded. */
    public async loadIndividualAsset<ThisAsset extends Asset>({
        asset,
        incrementProgressCallback,
        loadSession,
    }: Readonly<{
        asset: Readonly<ThisAsset>;
        incrementProgressCallback?: AssetIncrementProgressCallback | undefined;
        loadSession?: AssetLoadSession | undefined;
    }>): Promise<AssetValue<ThisAsset>> {
        const cached = this.assetCache.get(asset);
        if (cached) {
            const assetResult: AssetLoaderResult = await cached;

            return assetResult.value;
        }

        const deferredLoadPromise = new DeferredPromise<AssetLoaderResult>();

        this.assetCache.set(asset, deferredLoadPromise.promise);

        loadSession?.reportProgress({
            current: 0,
            currentResourceName: asset.name,
            total: asset.maxProgress,
        });

        const loadedAsset = await asset.load({
            incrementProgressCallback(progressParams) {
                incrementProgressCallback?.(progressParams);
                loadSession?.incrementProgress({
                    amount: progressParams,
                    currentResourceName: asset.name,
                });
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

    public async destroy() {
        this.loadSessionController.destroy();
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

        if (assetsToLoad.length) {
            this.reportProgress({
                loadSession: options.loadSession,
                progress: {
                    current: currentProgress,
                    total: maxProgress,
                    currentResourceName: assetsToLoad[0]?.name,
                },
            });
        }

        await this.unloadAssets(assetsToCleanup);

        if (!assetsToLoad.length) {
            return assets.map((asset) => this.assetCache.get(asset));
        }

        currentProgress += cleanupCount;
        this.reportProgress({
            loadSession: options.loadSession,
            progress: {
                current: currentProgress,
                total: maxProgress,
                currentResourceName: assetsToLoad[0]?.name,
            },
        });

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
                this.reportProgress({
                    loadSession: options.loadSession,
                    progress: {
                        current: currentProgress,
                        total: maxProgress,
                        currentResourceName: asset.name,
                    },
                });
            };
        };

        const results: unknown[] = (
            await awaitedBlockingMap(chunkedAssets, async (assetChunk) => {
                return await Promise.all(
                    assetChunk.map(async (asset) => {
                        if (this.assetCache.has(asset)) {
                            return (await this.assetCache.get(asset))?.value;
                        }

                        this.reportProgress({
                            loadSession: options.loadSession,
                            progress: {
                                current: currentProgress,
                                total: maxProgress,
                                currentResourceName: asset.name,
                            },
                        });

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
        return results;
    }

    /** Sends load progress to the provided session. */
    protected reportProgress({
        loadSession,
        progress,
    }: Readonly<{
        loadSession: AssetLoadSession | undefined;
        progress: AssetLoadProgress;
    }>) {
        loadSession?.reportProgress(progress);
    }
}
