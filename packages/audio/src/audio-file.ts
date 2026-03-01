import {assertWrap, check} from '@augment-vir/assert';
import {
    clamp,
    DeferredPromise,
    ensureArray,
    ensureError,
    makeWritable,
    stringify,
    type AnyObject,
    type PartialWithUndefined,
    type SelectFrom,
    type Values,
} from '@augment-vir/common';
import {defineTypedCustomEvent, defineTypedEvent, ListenTarget} from 'typed-event-target';
import {isCodecSupported, isFileSupported, type Codec} from './codecs.js';
import {isPlayingEnabled} from './detect-play.js';

/**
 * Accepted types for the {@link AudioFile} source param `AudioFileParams.sources`).
 *
 * @category Internal
 */
export type AudioFileSource =
    /** The URL of the audio file. The codec will be determined automatically by the file name. */
    | string
    | {
          url: string;
          /** Force a specific codec for this file. */
          codec: Codec;
      };

/**
 * Init params for {@link AudioFile}. When {@link AudioFile} instances are constructed internally by
 * `AudioPlayer`, only a subset of these parameters can be / must be manually provided.
 *
 * @category Internal
 */
export type AudioFileParams = Readonly<
    {
        /**
         * An array of possible source file URLs. The first one that is supported by the current
         * browser will be used.
         */
        sources: ReadonlyArray<AudioFileSource> | AudioFileSource;
    } & PartialWithUndefined<{
        /**
         * Override the used `fetch` implementation.
         *
         * @default globalThis.fetch
         */
        fetch: (url: string) => Promise<Pick<Response, 'arrayBuffer'>>;
        /** A value between `0` and `1` to control volume. */
        volume: number;
        outputNode: AudioNode;
        audioContext: BaseAudioContext;
        audioCache: AudioFileCache;
        /**
         * Any audio nodes to chain together. They will automatically be connected together in
         * sequential order.
         */
        createEffects: (
            audioContext: BaseAudioContext,
        ) => ReadonlyArray<AudioNode> | undefined | void;
    }>
>;

export function createAudioSourceKey(
    params: Readonly<
        SelectFrom<
            AudioFileParams,
            {
                volume: true;
                sources: true;
            }
        >
    >,
) {
    return ensureArray(params.sources)
        .map((source) => {
            if (check.isString(source)) {
                return source;
            } else {
                return [
                    source.url,
                    source.codec,
                ].join(',');
            }
        })
        .concat(`v=${params.volume ?? 1}`)
        .join(';');
}

/**
 * Emitted when an {@link AudioFile} finishes playing.
 *
 * @category Events
 */
export class AudioFilePlayEndEvent extends defineTypedEvent('audio-file-play-end') {}
/**
 * Emitted when an {@link AudioFile} starts playing.
 *
 * @category Events
 */
export class AudioFilePlayStartEvent extends defineTypedEvent('audio-file-play-start') {}
/**
 * Emitted when an {@link AudioFile} is destroyed.
 *
 * @category Events
 */
export class AudioFileDestroyedEvent extends defineTypedEvent('audio-file-destroyed') {}
/**
 * Emitted when an {@link AudioFile} is loaded.
 *
 * @category Events
 */
export class AudioFileLoadEvent extends defineTypedEvent('audio-file-load') {}
/**
 * Emitted when an {@link AudioFile} encounters an error.
 *
 * @category Events
 */
export class AudioFileErrorEvent extends defineTypedCustomEvent<Error>()('audio-file-error') {}
/**
 * When this event is fired, it indicates that we've detected that playing sounds has now been
 * enabled in the current session.
 *
 * @category Events
 */
export class PlayingEnabledEvent extends defineTypedEvent('playing-enabled') {}

/**
 * All events that can be emitted from an {@link AudioFile} instance.
 *
 * @category Internal
 */
export type AllAudioFileEvents =
    | AudioFilePlayEndEvent
    | AudioFilePlayStartEvent
    | AudioFileLoadEvent
    | AudioFileErrorEvent
    | PlayingEnabledEvent;

/**
 * Type interface for the audio file cache.
 *
 * @category Internal
 */
export type AudioFileCache = {
    [UrlOrBase64 in string]: Promise<{
        /** Current audio files that are using this url. */
        using: Set<AudioFile>;
        buffer: AudioBuffer;
    }>;
};

/**
 * Allows creating an array of `AudioNode` instances ("effects") by passing the given `AudioContext`
 * to `createEffects`. The effects created by `createEffects`, if any, are then sequentially
 * connected to each other and finally to the `originalOutputNode`. If effects are created, the
 * first one is returned as `outputNode` so all future playback can be routed through all the
 * effects. If no effects were created, `originalOutputNode` is returned as `outputNode`.
 *
 * Some possible connection chains:
 *
 * - 3 effects created: `effects[0]` (`outputNode`) -> `effects[1]` -> `effects[2]` ->
 *   `originalOutputNode`
 * - 1 effect created: `effects[0]` (`outputNode`) -> `originalOutputNode`
 * - No effects created: `originalOutputNode` (`outputNode`)
 *
 * @category Internal
 */
export function setupEffects(
    audioContext: Readonly<BaseAudioContext>,
    originalOutputNode: Readonly<AudioNode>,
    createEffects: AudioFileParams['createEffects'],
): {
    /** The node that all future playback should be connected to. */
    outputNode: AudioNode;
} {
    const effects = createEffects?.(audioContext);

    if (!effects || !check.isLengthAtLeast(effects, 1)) {
        return {
            outputNode: originalOutputNode,
        };
    }

    effects.forEach((effect, index, effects) => {
        const nextEffect = effects[index + 1];
        if (nextEffect) {
            effect.connect(nextEffect);
        } else {
            /** Connect the last effect to the original output node. */
            effect.connect(originalOutputNode);
        }
    });

    return {
        outputNode: effects[0],
    };
}

/**
 * An individual audio file.
 *
 * @category Internal
 */
export class AudioFile extends ListenTarget<AllAudioFileEvents> {
    /**
     * The url or base64 string chosen from the originally provided list of sources that is most
     * compatible with the current browser. This is what will be played.
     */
    public readonly urlOrBase64: string;
    /**
     * - `undefined` indicates that loading has not yet started (or has been unloaded).
     * - `Promise` means that loading has begun (and might be finished).
     */
    protected loadPromise: ReturnType<typeof this.load> | undefined;
    /**
     * The `AudioNode` that all playback should route to. If effects are provided, this will be the
     * first effect (because it'll sequentially route through all of the following effects,
     * eventually into the final volume `GainNode`). If no effects are provided, this will simply be
     * the internal volume `GainNode`.
     */
    protected readonly outputNode: AudioNode;
    /**
     * `AudioContext` for creating and playing audio nodes. This is automatically provided by a
     * parent `AudioPlayer`.
     */
    protected readonly audioContext: BaseAudioContext;
    /**
     * Cache of all loaded audio files. When an {@link AudioFile} instance is part of an
     * `AudioPlayer`, this cache will be provided by the parent `AudioPlayer` and shared between all
     * {@link AudioFile} instances.
     */
    protected readonly audioCache: AudioFileCache;
    /**
     * Internal fetch implementation to use. This can be overridden with `AudioFileParams.fetch`.
     *
     * @default globalThis.fetch
     */
    protected readonly fetch: NonNullable<AudioFileParams['fetch']>;
    /**
     * If `true`, indicates that this {@link AudioFile} instance (or another instance within the same
     * `AudioPlayer`) has detected that the current browser session is allowing audio playback. Most
     * browsers these days block audio on initial page load until the user has interacted with the
     * page.
     */
    public readonly isAudioAllowed = false as boolean;
    /**
     * Indicates if the {@link AudioFile} has been destroyed. If it has, this file should not be
     * interacted with anymore. This is set by running {@link AudioFile.destroy}.
     */
    public readonly isDestroyed = false as boolean;
    public readonly gainNode: GainNode;
    public readonly sourceKey: string;

    constructor(private readonly params: AudioFileParams) {
        super();
        this.sourceKey = createAudioSourceKey(params);
        const chosenSource = ensureArray(params.sources).find((source) => {
            if (check.isString(source)) {
                return isFileSupported(source);
            } else {
                return isCodecSupported(source.codec);
            }
        });

        if (!chosenSource) {
            const error = new Error(
                `No valid audio source files found in: ${stringify(params.sources)}`,
            );
            this.dispatch(
                new AudioFileErrorEvent({
                    detail: error,
                }),
            );
            throw error;
        }

        this.urlOrBase64 = check.isString(chosenSource) ? chosenSource : chosenSource.url;

        this.audioContext = params.audioContext || params.outputNode?.context || new AudioContext();
        this.audioCache = params.audioCache || {};
        this.fetch = params.fetch || globalThis.fetch.bind(globalThis);

        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = clamp(params.volume ?? 1, {
            min: 0,
            max: 1,
        });
        this.gainNode.connect(params.outputNode || this.audioContext.destination);

        this.outputNode = setupEffects(
            this.audioContext,
            this.gainNode,
            params.createEffects,
        ).outputNode;
    }

    /**
     * Load the audio file so it's ready to play. This will automatically be called on the first
     * {@link AudioFile.play} call, but doing so will introduce latency to the first play.
     */
    public load(): ReturnType<typeof this.loadAudioBuffer> {
        if (this.loadPromise) {
            return this.loadPromise;
        } else {
            this.loadPromise = this.loadAudioBuffer();
            return this.loadPromise;
        }
    }

    /**
     * Play the audio file. If the audio file has not been loaded yet, it will be loaded before
     * playing. If audio playing is disabled (which these days is often the case until the user
     * interacts with the page), the file will not play. This resolves when the audio file has
     * finished playing.
     *
     * @returns Whether or not the audio file was actually played. The audio file will not be played
     *   if audio is currently disabled.
     */
    public async play(): Promise<boolean> {
        const audioBuffer = await this.load();
        if (!audioBuffer) {
            const error = new Error('Attempted to play unloaded audio.');
            this.dispatch(
                new AudioFileErrorEvent({
                    detail: error,
                }),
            );
            throw error;
        }
        if (!this.isAudioAllowed) {
            makeWritable(this).isAudioAllowed = await isPlayingEnabled(this.audioContext);
            if (this.isAudioAllowed as boolean) {
                this.dispatch(new PlayingEnabledEvent());
            } else {
                /**
                 * If playing is still blocked, don't play anything (to prevent the audio output
                 * from getting filled up with tons of overlapping plays).
                 */
                return false;
            }
        }

        const deferredPlayPromise = new DeferredPromise<boolean>();

        const bufferSource = this.audioContext.createBufferSource();
        bufferSource.buffer = audioBuffer;

        bufferSource.connect(this.outputNode);

        bufferSource.addEventListener('ended', () => {
            deferredPlayPromise.resolve(true);
            this.dispatch(new AudioFilePlayEndEvent());
        });
        this.dispatch(new AudioFilePlayStartEvent());
        bufferSource.start();

        return deferredPlayPromise.promise;
    }

    /** Destroys this audio file entirely; it cannot be used anymore. */
    public override async destroy() {
        if (this.isDestroyed) {
            /** Already destroyed. */
            return;
        }
        makeWritable(this).isDestroyed = true;
        super.destroy();

        const cacheEntry = await this.audioCache[this.urlOrBase64];
        if (cacheEntry) {
            cacheEntry.using.delete(this);
            if (!cacheEntry.using.size) {
                delete this.audioCache[this.urlOrBase64];
            }
        }

        this.outputNode.disconnect();
        (this as AnyObject).audioCache = {};
        this.loadPromise = undefined;

        delete (this as AnyObject).outputNode;
        delete (this as AnyObject).audioCache;
    }

    /**
     * Load the audio file's `AudioBuffer` through one of the following:
     *
     * - Retrieving it from the cache (if it exists) using {@link AudioFile.urlOrBase64}
     * - Parsing the base64 encoded source string (if the source string is encoded base64)
     * - Fetching the file URL from the internet
     *
     * If a cache entry for this file does not already exist, this will create one.
     */
    protected async loadAudioBuffer(): Promise<AudioBuffer> {
        try {
            const cacheEntry = this.audioCache[this.urlOrBase64];
            if (cacheEntry) {
                const resolvedCacheEntry = await cacheEntry;
                resolvedCacheEntry.using.add(this);
                return resolvedCacheEntry.buffer;
            }
            const deferredCacheEntryPromise = new DeferredPromise<
                Awaited<Values<AudioFileCache>>
            >();
            /**
             * We have to set the cache entry before we do anything async so other audio files
             * loaded at the same time with the same url see the cache entry.
             */
            this.audioCache[this.urlOrBase64] = deferredCacheEntryPromise.promise;

            const arrayBuffer = /^data:[^;]+;base64,/.test(this.urlOrBase64)
                ? this.loadBase64()
                : await this.loadFromUrl();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            deferredCacheEntryPromise.resolve({
                using: new Set([this]),
                buffer: audioBuffer,
            });

            this.dispatch(new AudioFileLoadEvent());

            return audioBuffer;
        } catch (caught) {
            const error = ensureError(caught);
            this.dispatch(
                new AudioFileErrorEvent({
                    detail: error,
                }),
            );
            throw error;
        }
    }
    /** Load the audio file's `ArrayBuffer` from its base64 encoded source string. */
    protected loadBase64(): ArrayBuffer {
        const data = atob(
            assertWrap.isDefined(this.urlOrBase64.split(',')[1], 'Invalid base64 audio string/'),
        );
        const dataView = new Uint8Array(data.length);
        for (let i = 0; i < data.length; ++i) {
            dataView[i] = assertWrap.isDefined(
                data.codePointAt(i),
                `Invalid base64 audio string at ${i}.`,
            );
        }

        return dataView.buffer;
    }

    /** Load the audio file's `ArrayBuffer` from its source URL. */
    protected async loadFromUrl() {
        return await (await this.fetch(this.urlOrBase64)).arrayBuffer();
    }
}
