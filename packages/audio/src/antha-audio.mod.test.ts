import {AnthaEngine} from '@antha/engine';
import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {createAnthaAudioMod, type AnthaAudioState} from './antha-audio.mod.js';
import {AudioPlayer} from './audio-player.js';

describe(createAnthaAudioMod.name, () => {
    it('initializes an AudioPlayer on state during execute', async () => {
        const mod = createAnthaAudioMod();
        const engine = new AnthaEngine({
            mods: [mod],
        });

        await engine.runSingleTick();

        const state = engine.state as Partial<AnthaAudioState>;

        assert.instanceOf(state.audioPlayer, AudioPlayer);
    });

    it('does not replace an existing AudioPlayer on subsequent ticks', async () => {
        const mod = createAnthaAudioMod();
        const engine = new AnthaEngine({
            mods: [mod],
        });

        await engine.runSingleTick();

        const firstPlayer = (engine.state as Partial<AnthaAudioState>).audioPlayer;

        await engine.runSingleTick();

        const secondPlayer = (engine.state as Partial<AnthaAudioState>).audioPlayer;

        assert.strictEquals(firstPlayer, secondPlayer);
    });

    it('passes options to AudioPlayer', async () => {
        const mod = createAnthaAudioMod({
            volume: 0.5,
        });
        const engine = new AnthaEngine({
            mods: [mod],
        });

        await engine.runSingleTick();

        const state = engine.state as Partial<AnthaAudioState>;

        assert.instanceOf(state.audioPlayer, AudioPlayer);
    });

    it('destroys the AudioPlayer on engine reset', async () => {
        const mod = createAnthaAudioMod();
        const engine = new AnthaEngine({
            mods: [mod],
        });

        await engine.runSingleTick();

        const player = (engine.state as Partial<AnthaAudioState>).audioPlayer;
        assert.isDefined(player);
        assert.isFalse((player as unknown as {isDestroyed: boolean}).isDestroyed);

        await engine.reset();

        assert.isTrue((player as unknown as {isDestroyed: boolean}).isDestroyed);
        assert.isUndefined((engine.state as Partial<AnthaAudioState>).audioPlayer);
    });
});
