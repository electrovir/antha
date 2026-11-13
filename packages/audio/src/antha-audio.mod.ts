import {defineAnthaMod} from '@antha/engine';
import {assertWrap, check} from '@augment-vir/assert';
import {
    getObjectTypedEntries,
    getObjectTypedValues,
    type EmptyFunction,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {getGamepads} from 'input-device-handler';
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
 * Resumes audio on each click or key press while it isn't playing: first when the browser allows
 * audio at all, then whenever the browser stops it again later. Gamepad presses are handled by
 * {@link resumeAudioOnGamepadPress}.
 *
 * @category Internal
 */
export function createAudioResumeListeners({
    audioPlayer,
}: Readonly<{
    audioPlayer: AudioPlayer;
}>) {
    function resumeAudio() {
        if (audioPlayer.audioContext.state !== 'running') {
            resumeAnthaAudioContext({
                audioPlayer,
            });
        }
    }

    const cleanupCallbacks = [
        listenToGlobal('click', resumeAudio, {
            capture: true,
        }),
        listenToGlobal('keydown', resumeAudio, {
            capture: true,
        }),
    ];

    return () => {
        cleanupCallbacks.forEach((cleanupCallback) => cleanupCallback());
    };
}

/**
 * Resumes audio while it isn't playing and a gamepad button is pressed. Browsers don't count a
 * gamepad press as user interaction, so this only works once the page has had a click or key
 * press.
 *
 * @category Internal
 */
export function resumeAudioOnGamepadPress({
    audioPlayer,
}: Readonly<{
    audioPlayer: AudioPlayer;
}>) {
    if (
        audioPlayer.audioContext.state !== 'running' &&
        globalThis.navigator.userActivation.hasBeenActive &&
        getObjectTypedValues(getGamepads()).some((gamepad) => {
            return gamepad.buttons.some((button) => button.pressed);
        })
    ) {
        resumeAnthaAudioContext({
            audioPlayer,
        });
    }
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

            if (!state.audioResumeListenersCleanup) {
                state.audioResumeListenersCleanup = createAudioResumeListeners({
                    audioPlayer: state.audioPlayer,
                });
            }

            resumeAudioOnGamepadPress({
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
