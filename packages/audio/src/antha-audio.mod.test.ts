import {AnthaEngine} from '@antha/engine';
import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {createAnthaAudioMod, type AnthaAudioState} from './antha-audio.mod.js';
import {AudioPlayer} from './audio-player.js';

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
