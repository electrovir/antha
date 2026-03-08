import {type PartialWithUndefined} from '@augment-vir/common';
import {defineAnthaMod} from 'antha';
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
 * A pre-built mod for playing audio files.
 *
 * @category Pre-Built Mods
 */
export function createAnthaAudioMod(
    audioPlayerOptions?: Readonly<PartialWithUndefined<AudioPlayerOptions>> | undefined,
) {
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
