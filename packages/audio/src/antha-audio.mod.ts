import {type PartialWithUndefined} from '@augment-vir/common';
import {defineAnthaMod} from 'antha';
import {AudioPlayer, type AudioPlayerOptions} from './audio-player.js';

export type AnthaAudioState = {
    audioPlayer: AudioPlayer;
};

export function createAnthaAudioMod(
    audioPlayerOptions?: Readonly<PartialWithUndefined<AudioPlayerOptions>> | undefined,
) {
    return defineAnthaMod<AnthaAudioState>({
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
