import {defineAnthaMod} from '@antha/engine';
import {assertWrap, check} from '@augment-vir/assert';
import {
    getObjectTypedEntries,
    type EmptyFunction,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {listenToGlobal} from 'typed-event-target';
import {AudioPlayer, type AudioPlayerOptions} from './audio-player.js';

/**
 * State for {@link createAnthaAudioMod}.
 *
 * @category Internal
 */
export type AnthaAudioState = {
    audioPlayer: AudioPlayer;
} & PartialWithUndefined<{
    audioResumeListenersCleanup: EmptyFunction;
    audioChannelVolume: {
        master: number;
    } & PartialWithUndefined<{
        channels: Record<string, number>;
    }>;
}>;

/**
 * Options for {@link createAnthaAudioMod}.
 *
 * @category Internal
 */
export type AnthaAudioModOptions = PartialWithUndefined<AudioPlayerOptions>;

/**
 * Resumes audio after a browser-recognized user interaction.
 *
 * @category Internal
 */
export function resumeAnthaAudioContext({
    audioPlayer,
}: Readonly<{
    audioPlayer: AudioPlayer | undefined;
}>) {
    void audioPlayer?.audioContext.resume().catch(() => {});
}

/**
 * Attempts to resume audio when it becomes allowed due to the user inputs.
 *
 * @category Internal
 */
export function createAudioResumeListeners({
    audioPlayer,
}: Readonly<{
    audioPlayer: AudioPlayer;
}>) {
    let cleanup: EmptyFunction | undefined;

    function resumeAudio() {
        resumeAnthaAudioContext({
            audioPlayer,
        });
        cleanup?.();
        cleanup = undefined;
    }

    const cleanupCallbacks = [
        listenToGlobal('click', resumeAudio, {
            capture: true,
        }),
        listenToGlobal('keydown', resumeAudio, {
            capture: true,
        }),
    ];
    cleanup = () => {
        cleanupCallbacks.forEach((cleanupCallback) => cleanupCallback());
    };

    return cleanup;
}

function syncChannelVolumes(state: Partial<AnthaAudioState>) {
    if (!state.audioChannelVolume) {
        state.audioChannelVolume = {
            master: 1,
            channels: {},
        };
    }

    const audioPlayer = assertWrap.isDefined(state.audioPlayer);
    const audioChannelVolume = state.audioChannelVolume;

    if (
        !check.isApproximately(audioPlayer.gainNode.gain.value, audioChannelVolume.master, 0.00001)
    ) {
        audioPlayer.gainNode.gain.value = audioChannelVolume.master;
    }

    getObjectTypedEntries(audioPlayer.audioChannelNodes).forEach(
        ([
            audioChannel,
            audioChannelNode,
        ]) => {
            const volume = audioChannelVolume.channels?.[audioChannel] ?? 1;

            if (!check.isApproximately(audioChannelNode.gain.value, volume, 0.00001)) {
                audioChannelNode.gain.value = volume;
            }
        },
    );
}

/**
 * A pre-built mod for playing audio files.
 *
 * @category Pre-Built Mods
 */
export function createAnthaAudioMod(audioPlayerOptions: Readonly<AnthaAudioModOptions> = {}) {
    return defineAnthaMod<AnthaAudioState>({
        modName: 'antha-audio',
        async cleanup({state}) {
            state.audioResumeListenersCleanup?.();
            state.audioResumeListenersCleanup = undefined;
            await state.audioPlayer?.destroy();
        },
        execute({state}) {
            if (!state.audioPlayer) {
                state.audioPlayer = new AudioPlayer(audioPlayerOptions);
            }

            syncChannelVolumes(state);

            if (state.audioResumeListenersCleanup) {
                return;
            }

            state.audioResumeListenersCleanup = createAudioResumeListeners({
                audioPlayer: state.audioPlayer,
            });
        },
    });
}

/**
 * The mod created by {@link createAnthaAudioMod}.
 *
 * @category Internal
 */
export type AnthaAudioMod = ReturnType<typeof createAnthaAudioMod>;
