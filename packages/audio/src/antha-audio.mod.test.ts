import {AnthaEngine} from '@antha/engine';
import {assert, assertWrap} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {createAnthaAudioMod, type AnthaAudioState} from './antha-audio.mod.js';
import {AudioPlayer} from './audio-player.js';
import {shortMp3FileUrl} from './files.mock.js';

enum TestAudioChannel {
    Effects = 'effects',
}

describe(createAnthaAudioMod.name, () => {
    it('initializes an AudioPlayer on state during execute', async () => {
        const mod = createAnthaAudioMod();
        const engine = new AnthaEngine<AnthaAudioState>({
            mods: [mod],
        });

        await engine.runSingleTick();

        assert.instanceOf(engine.state.audioPlayer, AudioPlayer);
    });

    it('does not replace an existing AudioPlayer on subsequent ticks', async () => {
        const mod = createAnthaAudioMod();
        const engine = new AnthaEngine<AnthaAudioState>({
            mods: [mod],
        });

        await engine.runSingleTick();

        const firstPlayer = engine.state.audioPlayer;

        await engine.runSingleTick();

        const secondPlayer = engine.state.audioPlayer;

        assert.strictEquals(firstPlayer, secondPlayer);
    });

    it('passes options to AudioPlayer', async () => {
        const mod = createAnthaAudioMod({
            volume: 0.5,
        });
        const engine = new AnthaEngine<AnthaAudioState>({
            mods: [mod],
        });

        await engine.runSingleTick();

        assert.instanceOf(engine.state.audioPlayer, AudioPlayer);
    });

    it('initializes audio channel volumes', async () => {
        const engine = new AnthaEngine<AnthaAudioState>({
            mods: [createAnthaAudioMod()],
        });

        await engine.runSingleTick();

        assert.deepEquals(engine.state.audioChannelVolume, {
            master: 1,
            channels: {},
        });

        await engine.reset();
    });

    it('applies master and channel volume to audio player nodes', async () => {
        const engine = new AnthaEngine<AnthaAudioState>({
            initState: {
                audioChannelVolume: {
                    master: 0.5,
                    channels: {
                        [TestAudioChannel.Effects]: 0.8,
                    },
                },
            },
            mods: [createAnthaAudioMod()],
        });

        await engine.runSingleTick();
        const audioPlayer = assertWrap.isDefined(engine.state.audioPlayer);
        await audioPlayer.loadFiles([
            {
                sources: [shortMp3FileUrl],
                volume: 0.5,
            },
        ]);
        await audioPlayer.play({
            audioChannel: TestAudioChannel.Effects,
            sources: [shortMp3FileUrl],
            volume: 0.5,
        });
        await engine.runSingleTick();

        const audioChannelNode = assertWrap.isDefined(
            audioPlayer.audioChannelNodes[TestAudioChannel.Effects],
        );

        assert.isApproximately(audioPlayer.gainNode.gain.value, 0.5, 0.00001);
        assert.isApproximately(audioChannelNode.gain.value, 0.8, 0.00001);

        await engine.reset();
    });

    it('destroys the AudioPlayer on engine reset', async () => {
        const mod = createAnthaAudioMod();
        const engine = new AnthaEngine<AnthaAudioState>({
            mods: [mod],
        });

        await engine.runSingleTick();

        const player = engine.state.audioPlayer;
        assert.isDefined(player);
        assert.isFalse(player.isDestroyed);

        await engine.reset();

        assert.isTrue(player.isDestroyed);
        assert.isUndefined(engine.state.audioPlayer);
    });
});
