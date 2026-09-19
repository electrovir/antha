import {defineAnthaMod} from '@antha/engine';
import {log, type PartialWithUndefined} from '@augment-vir/common';
import {type AnthaAudioState} from './antha-audio.mod.js';
import {type AudioSetupParams} from './audio-player.js';

export type AnthaBackgroundAudioState = AnthaAudioState &
    PartialWithUndefined<{
        currentBackgroundAudio: Readonly<AudioSetupParams>;
    }>;

/**
 * A mod that keeps track of a single background audio (music) file being played, and pauses the
 * previous background audio when it gets switched. Control by setting
 * state.currentBackgroundAudio.
 *
 * @category Pre-Built Mods
 */
export function createAnthaBackgroundAudioMod() {
    let lastPlayingBackgroundAudio: undefined | Readonly<AudioSetupParams>;

    return defineAnthaMod<AnthaBackgroundAudioState>({
        modName: 'antha-background-audio-playback',
        execute({state}) {
            if (!state.audioPlayer) {
                return;
            } else if (lastPlayingBackgroundAudio !== state.currentBackgroundAudio) {
                if (lastPlayingBackgroundAudio) {
                    state.audioPlayer.stopFile(lastPlayingBackgroundAudio);
                }

                if (state.currentBackgroundAudio) {
                    void state.audioPlayer
                        .play(state.currentBackgroundAudio)
                        .catch((error: unknown) => {
                            log.error(error);
                        });
                }

                lastPlayingBackgroundAudio = state.currentBackgroundAudio;
            }
        },
    });
}

/**
 * The mod returned / created by {@link createAnthaBackgroundAudioMod}.
 *
 * @category Internal
 */
export type AnthaBackgroundAudioMod = ReturnType<typeof createAnthaBackgroundAudioMod>;
