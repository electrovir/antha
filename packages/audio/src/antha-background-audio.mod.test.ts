import {AnthaEngine} from '@antha/engine';
import {assert} from '@augment-vir/assert';
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
    public readonly stoppedAudioKeys: string[] = [];

    public override play(params: Parameters<AudioPlayer['play']>[0]) {
        this.playedAudioKeys.push(createAudioSourceKey(params));

        return Promise.resolve(false);
    }

    public override stopFile(params: Readonly<AudioSetupParams>) {
        this.stoppedAudioKeys.push(createAudioSourceKey(params));
    }
}

describe(createAnthaBackgroundAudioMod.name, () => {
    it('stops the previous background audio before playing the next one', async () => {
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
                    stoppedAudioKeys: [createAudioSourceKey(firstBackgroundAudio)],
                },
            );
        } finally {
            await engine.reset();
            await audioPlayer.destroy();
        }
    });
});
