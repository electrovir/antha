import {defineAnthaMod} from '@antha/engine';
import {log, type PartialWithUndefined} from '@augment-vir/common';
import {type AnthaAudioState} from './antha-audio.mod.js';
import {type AudioSetupParams} from './audio-player.js';

/**
 * State for {@link createAnthaBackgroundAudioMod}.
 *
 * @category Internal
 */
export type AnthaBackgroundAudioState = AnthaAudioState &
    PartialWithUndefined<{
        currentBackgroundAudio: Readonly<AudioSetupParams>;
    }>;

/**
 * A mod that keeps track of a single background audio (music) file being played, and pauses the
 * previous background audio when it gets switched. Control by setting
 * state.currentBackgroundAudio.
 *
 * The background audio loops: it is played again each time it finishes. If the browser blocks
 * playback until a user interaction, playback is retried once the audio context is running.
 *
 * @category Pre-Built Mods
 */
export function createAnthaBackgroundAudioMod() {
    let lastPlayingBackgroundAudio: undefined | Readonly<AudioSetupParams>;
    /**
     * Defined while `lastPlayingBackgroundAudio` should keep playing. Cleared if playback throws so
     * a broken file isn't retried forever.
     */
    let pendingPlayback:
        | {
              isBlocked: boolean;
              isInFlight: boolean;
          }
        | undefined;

    return defineAnthaMod<AnthaBackgroundAudioState>({
        modName: 'antha-background-audio-playback',
        execute({state}) {
            if (!state.audioPlayer) {
                return;
            }

            if (lastPlayingBackgroundAudio !== state.currentBackgroundAudio) {
                if (lastPlayingBackgroundAudio) {
                    state.audioPlayer.stopFile(lastPlayingBackgroundAudio);
                }

                lastPlayingBackgroundAudio = state.currentBackgroundAudio;
                pendingPlayback = state.currentBackgroundAudio
                    ? {
                          isBlocked: false,
                          isInFlight: false,
                      }
                    : undefined;
            }

            if (
                !lastPlayingBackgroundAudio ||
                !pendingPlayback ||
                pendingPlayback.isInFlight ||
                (pendingPlayback.isBlocked && state.audioPlayer.audioContext.state !== 'running')
            ) {
                return;
            }

            const playback = pendingPlayback;
            playback.isInFlight = true;

            void state.audioPlayer
                .play(lastPlayingBackgroundAudio)
                /** `play` resolves once the audio finishes, so the next execute replays it. */
                .then((didPlay) => {
                    playback.isBlocked = !didPlay;
                })
                .catch((error: unknown) => {
                    log.error(error);

                    if (pendingPlayback === playback) {
                        pendingPlayback = undefined;
                    }
                })
                .finally(() => {
                    playback.isInFlight = false;
                });
        },
    });
}

/**
 * The mod returned / created by {@link createAnthaBackgroundAudioMod}.
 *
 * @category Internal
 */
export type AnthaBackgroundAudioMod = ReturnType<typeof createAnthaBackgroundAudioMod>;
