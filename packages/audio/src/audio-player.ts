import {
    awaitedBlockingMap,
    clamp,
    makeWritable,
    type AnyObject,
    type MaybePromise,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {ListenTarget} from 'typed-event-target';
import {
    AudioFile,
    createAudioSourceKey,
    PlayingEnabledEvent,
    setupEffects,
    type AllAudioFileEvents,
    type AudioFileCache,
    type AudioFileParams,
} from './audio-file.js';

/**
 * Params for {@link AudioLoadProgressCallback}
 *
 * @category Internal
 */
export type AudioLoadProgressCallbackParams = {
    total: number;
    loaded: number;
    finished: boolean;
};

/**
 * Progress callback used by `load` in {@link AudioPlayer} when loading multiple files.
 *
 * @category Internal
 */
export type AudioLoadProgressCallback = (
    params: AudioLoadProgressCallbackParams,
) => MaybePromise<void>;

/**
 * Options for {@link AudioPlayer}.
 *
 * @category Internal
 */
export type AudioPlayerOptions = Pick<AudioFileParams, 'fetch' | 'volume' | 'createEffects'>;

/**
 * Inputs for playing audio.
 *
 * @category Internal
 */
export type AudioSetupParams = Readonly<
    Pick<AudioFileParams, 'sources' | 'volume' | 'fetch' | 'createEffects'>
>;

/**
 * An audio manager which handles keeping track of, loading, and playing multiple audio files.
 *
 * @category Main
 */
export class AudioPlayer extends ListenTarget<AllAudioFileEvents> {
    public readonly audioFiles: {[SourceKey in string]: AudioFile} = {};
    public readonly audioContext = new AudioContext();
    public readonly audioCache: AudioFileCache = {};
    public readonly isDestroyed = false as boolean;
    public readonly outputNode: AudioNode;
    /**
     * If `true`, indicates that an internal {@link AudioFile} instance has detected that the current
     * browser session is allowing audio playback. Most browsers these days block audio on initial
     * page load until the user has interacted with the page.
     */
    public readonly isAudioAllowed = false as boolean;
    /** Controls volume for all audio files. Modify `gain.value` on this to change playback volume. */
    public readonly gainNode: GainNode;

    constructor(
        protected readonly options: Readonly<PartialWithUndefined<AudioPlayerOptions>> = {},
    ) {
        super();
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = clamp(options.volume ?? 1, {
            min: 0,
            max: 1,
        });
        this.gainNode.connect(this.audioContext.destination);

        this.outputNode = setupEffects(
            this.audioContext,
            this.gainNode,
            options.createEffects,
        ).outputNode;
    }

    /** Play an audio file. */
    public async play(params: Readonly<AudioSetupParams>): Promise<boolean> {
        return this.setupAudioFile(params).play();
    }

    /** Create a new {@link AudioFile} instance at the given `key` and set it up. */
    protected setupAudioFile(params: Readonly<AudioSetupParams>) {
        const sourceKey = createAudioSourceKey(params);
        const existingAudioFile = this.audioFiles[sourceKey];
        if (existingAudioFile) {
            return existingAudioFile;
        }

        const audioFile = new AudioFile({
            fetch: this.options.fetch,
            ...params,
            audioCache: this.audioCache,
            audioContext: this.audioContext,
            outputNode: this.outputNode,
        });

        this.audioFiles[sourceKey] = audioFile;

        audioFile.listenToAll((event) => {
            if (event instanceof PlayingEnabledEvent && !this.isAudioAllowed) {
                /** If any audio file detects that playing is enabled, notify all audio files. */
                makeWritable(this).isAudioAllowed = true;
                Object.values(this.audioFiles).forEach((audioFile) => {
                    makeWritable(audioFile).isAudioAllowed = true;
                });
            }

            /** Pass all child audio events. */
            this.dispatch(event);
        });

        return audioFile;
    }

    /** Unloads all the attached files. */
    public async unloadFiles(files: ReadonlyArray<Readonly<AudioSetupParams>>) {
        await Promise.all(
            files.map(async (file) => {
                const sourceKey = createAudioSourceKey(file);
                await this.audioFiles[sourceKey]?.destroy();
                delete this.audioFiles[sourceKey];
            }),
        );
    }

    /** Load a batch of audio files. */
    public async loadFiles(
        files: ReadonlyArray<Readonly<AudioSetupParams>>,
        options: Readonly<
            PartialWithUndefined<{
                progressCallback: AudioLoadProgressCallback;
                /**
                 * If `true`, all loading is handled in serial instead of parallel.
                 *
                 * @default false
                 */
                serial: boolean;
            }>
        > = {},
    ): Promise<AudioFile[]> {
        let loadedCount = 0;

        const setupFile = async (file: AudioSetupParams) => {
            const audioFile = this.setupAudioFile(file);

            await audioFile.load();

            if (options.progressCallback) {
                loadedCount++;
                void options.progressCallback({
                    finished: loadedCount >= files.length,
                    loaded: loadedCount,
                    total: files.length,
                });
            }
            return audioFile;
        };

        if (options.serial) {
            return await awaitedBlockingMap(files, setupFile);
        } else {
            return await Promise.all(files.map(setupFile));
        }
    }

    /** Destroy and cleanup this {@link AudioPlayer} and all child {@link AudioFile} instances. */
    public override async destroy() {
        if (this.isDestroyed) {
            return;
        }
        super.destroy();
        await Promise.all(
            Object.values(this.audioFiles).map(async (audioFile) => {
                delete this.audioFiles[audioFile.sourceKey];
                await audioFile.destroy();
                delete this.audioCache[audioFile.sourceKey];
            }),
        );
        await this.audioContext.close();
        (this as AnyObject).isDestroyed = true;
    }
}
