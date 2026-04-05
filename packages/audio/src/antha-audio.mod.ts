import {defineAnthaMod} from '@antha/engine';
import {type PartialWithUndefined} from '@augment-vir/common';
import {AudioPlayer, type AudioPlayerOptions} from './audio-player.js';

/**
 * State for {@link createAnthaAudioMod}.
 *
 * @category Internal
 */
export type AnthaAudioState = {
    audioPlayer: AudioPlayer;
};

/**
 * Options for {@link createAnthaAudioMod}.
 *
 * @category Internal
 */
export type AnthaAudioModOptions = PartialWithUndefined<AudioPlayerOptions>;

/**
 * A pre-built mod for playing audio files.
 *
 * @category Pre-Built Mods
 */
export function createAnthaAudioMod(audioPlayerOptions: Readonly<AnthaAudioModOptions> = {}) {
    return defineAnthaMod<AnthaAudioState>({
        modName: 'antha-audio',
        async cleanup({state}) {
            await state.audioPlayer?.destroy();
        },
        execute({state}) {
            if (!state.audioPlayer) {
                state.audioPlayer = new AudioPlayer(audioPlayerOptions);
            }
        },
    });
}

/**
 * The mod created by {@link createAnthaAudioMod}.
 *
 * @category Internal
 */
export type AnthaAudioMod = ReturnType<typeof createAnthaAudioMod>;
