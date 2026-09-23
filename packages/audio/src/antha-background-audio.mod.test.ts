import {AnthaEngine} from '@antha/engine';
import {assert, waitUntil} from '@augment-vir/assert';
import {DeferredPromise} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {
    createAnthaBackgroundAudioMod,
    type AnthaBackgroundAudioState,
} from './antha-background-audio.mod.js';
import {createAudioSourceKey} from './audio-file.js';
import {AudioPlayer, type AudioSetupParams} from './audio-player.js';
import {shortMp3FileUrl} from './files.mock.js';

const firstBackgroundAudio: AudioSetupParams = {
    sources: [shortMp3FileUrl],
};
const secondBackgroundAudio: AudioSetupParams = {
    sources: [shortMp3FileUrl],
    volume: 0.5,
};

class TestAudioPlayer extends AudioPlayer {
    public readonly playedAudioKeys: string[] = [];
    public rejectPlayForTest = false as boolean;
    public allowPlayForTest = false as boolean;
    public readonly stoppedAudioKeys: string[] = [];
    protected currentPlayback: DeferredPromise<boolean> | undefined;

    public override play(params: Parameters<AudioPlayer['play']>[0]) {
        this.playedAudioKeys.push(createAudioSourceKey(params));

        if (this.rejectPlayForTest) {
            return Promise.reject(new Error('Expected background audio failure.'));
        } else if (!this.allowPlayForTest) {
            return Promise.resolve(false);
        }

        this.currentPlayback = new DeferredPromise<boolean>();

        return this.currentPlayback.promise;
    }

    public finishPlaybackForTest() {
        this.currentPlayback?.resolve(true);
    }

    public override stopFile(params: Readonly<AudioSetupParams>) {
        this.stoppedAudioKeys.push(createAudioSourceKey(params));
    }
}

describe(createAnthaBackgroundAudioMod.name, () => {
    it('does nothing before an audio player is installed', async () => {
        const engine = new AnthaEngine<AnthaBackgroundAudioState>({
            mods: [createAnthaBackgroundAudioMod()],
        });

        await engine.runSingleTick();

        assert.deepEquals(engine.state, {});
    });

    it('stops replaced and cleared background audio', async () => {
        const audioPlayer = new TestAudioPlayer();
        const engine = new AnthaEngine<AnthaBackgroundAudioState>({
            initState: {
                currentBackgroundAudio: firstBackgroundAudio,
                audioPlayer,
            },
            mods: [createAnthaBackgroundAudioMod()],
        });

        try {
            await engine.runSingleTick();
            engine.state.currentBackgroundAudio = secondBackgroundAudio;
            await engine.runSingleTick();
            engine.state.currentBackgroundAudio = undefined;
            await engine.runSingleTick();

            assert.deepEquals(
                {
                    playedAudioKeys: audioPlayer.playedAudioKeys,
                    stoppedAudioKeys: audioPlayer.stoppedAudioKeys,
                },
                {
                    playedAudioKeys: [
                        createAudioSourceKey(firstBackgroundAudio),
                        createAudioSourceKey(secondBackgroundAudio),
                    ],
                    stoppedAudioKeys: [
                        createAudioSourceKey(firstBackgroundAudio),
                        createAudioSourceKey(secondBackgroundAudio),
                    ],
                },
            );
        } finally {
            await engine.reset();
            await audioPlayer.destroy();
        }
    });

    it('retries blocked background audio once the audio context is running', async () => {
        const audioPlayer = new TestAudioPlayer();
        const engine = new AnthaEngine<AnthaBackgroundAudioState>({
            initState: {
                currentBackgroundAudio: firstBackgroundAudio,
                audioPlayer,
            },
            mods: [createAnthaBackgroundAudioMod()],
        });

        function setAudioContextState(audioContextState: AudioContextState) {
            Object.defineProperty(audioPlayer.audioContext, 'state', {
                configurable: true,
                value: audioContextState,
            });
        }

        try {
            setAudioContextState('suspended');
            await engine.runSingleTick();
            await engine.runSingleTick();
            const blockedPlayCount = audioPlayer.playedAudioKeys.length;

            setAudioContextState('running');
            audioPlayer.allowPlayForTest = true;
            await engine.runSingleTick();
            await engine.runSingleTick();
            await engine.runSingleTick();

            assert.deepEquals(
                {
                    blockedPlayCount,
                    totalPlayCount: audioPlayer.playedAudioKeys.length,
                },
                {
                    blockedPlayCount: 1,
                    totalPlayCount: 2,
                },
            );
        } finally {
            await engine.reset();
            await audioPlayer.destroy();
        }
    });

    it('replays background audio after it finishes', async () => {
        const audioPlayer = new TestAudioPlayer();
        audioPlayer.allowPlayForTest = true;
        const engine = new AnthaEngine<AnthaBackgroundAudioState>({
            initState: {
                currentBackgroundAudio: firstBackgroundAudio,
                audioPlayer,
            },
            mods: [createAnthaBackgroundAudioMod()],
        });

        try {
            await engine.runSingleTick();
            await engine.runSingleTick();
            const playCountWhilePlaying = audioPlayer.playedAudioKeys.length;

            audioPlayer.finishPlaybackForTest();
            await waitUntil.isTrue(async () => {
                await engine.runSingleTick();

                return audioPlayer.playedAudioKeys.length === 2;
            });

            assert.deepEquals(
                {
                    playCountWhilePlaying,
                    playedAudioKeys: audioPlayer.playedAudioKeys,
                },
                {
                    playCountWhilePlaying: 1,
                    playedAudioKeys: [
                        createAudioSourceKey(firstBackgroundAudio),
                        createAudioSourceKey(firstBackgroundAudio),
                    ],
                },
            );
        } finally {
            await engine.reset();
            await audioPlayer.destroy();
        }
    });

    it('logs failed background audio playback', async () => {
        const audioPlayer = new TestAudioPlayer();
        audioPlayer.rejectPlayForTest = true;
        const engine = new AnthaEngine<AnthaBackgroundAudioState>({
            initState: {
                currentBackgroundAudio: firstBackgroundAudio,
                audioPlayer,
            },
            mods: [createAnthaBackgroundAudioMod()],
        });
        const errors: unknown[][] = [];
        const originalError = console.error;
        console.error = (...args: unknown[]) => errors.push(args);

        try {
            await engine.runSingleTick();
            await waitUntil.isTrue(() => errors.length === 1);

            assert.isLengthExactly(errors, 1);
        } finally {
            console.error = originalError;
            await engine.reset();
            await audioPlayer.destroy();
        }
    });
});
