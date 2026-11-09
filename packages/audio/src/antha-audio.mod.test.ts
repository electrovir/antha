import {AnthaEngine} from '@antha/engine';
import {assert, assertWrap} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {createAnthaAudioMod, type AnthaAudioState} from './antha-audio.mod.js';
import {AudioPlayer} from './audio-player.js';
import {shortMp3FileUrl} from './files.mock.js';

enum TestAudioChannel {
    Effects = 'effects',
    Music = 'music',
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

    it('resumes audio on each input while it is not running, until the mod is cleaned up', async () => {
        const engine = new AnthaEngine<AnthaAudioState>({
            mods: [createAnthaAudioMod()],
        });

        await engine.runSingleTick();

        const audioPlayer = assertWrap.isDefined(engine.state.audioPlayer);
        const context = {
            state: 'suspended',
        };
        const resumeStates: string[] = [];
        Object.defineProperty(audioPlayer.audioContext, 'state', {
            configurable: true,
            get() {
                return context.state;
            },
        });
        audioPlayer.audioContext.resume = () => {
            resumeStates.push(context.state);
            context.state = 'running';

            return Promise.resolve();
        };

        globalThis.dispatchEvent(new Event('click'));
        globalThis.dispatchEvent(new Event('click'));
        /** Safari stops audio this way, such as during a phone call. */
        context.state = 'interrupted';
        globalThis.dispatchEvent(new Event('keydown'));
        context.state = 'suspended';
        await engine.reset();
        globalThis.dispatchEvent(new Event('click'));

        assert.deepEquals(resumeStates, [
            'suspended',
            'interrupted',
        ]);
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
        await audioPlayer.play({
            audioChannel: TestAudioChannel.Music,
            sources: [shortMp3FileUrl],
            volume: 0.5,
        });
        await engine.runSingleTick();

        const effectsAudioChannelNode = assertWrap.isDefined(
            audioPlayer.audioChannelNodes[TestAudioChannel.Effects],
        );
        const musicAudioChannelNode = assertWrap.isDefined(
            audioPlayer.audioChannelNodes[TestAudioChannel.Music],
        );

        assert.isApproximately(effectsAudioChannelNode.gain.value, 0.8, 0.00001);
        assert.deepEquals(
            {
                masterVolume: audioPlayer.gainNode.gain.value,
                musicVolume: musicAudioChannelNode.gain.value,
            },
            {
                masterVolume: 0.5,
                musicVolume: 1,
            },
        );

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

    it('resumes audio on a gamepad press only after the page had a click or key press', async () => {
        const engine = new AnthaEngine<AnthaAudioState>({
            mods: [createAnthaAudioMod()],
        });

        await engine.runSingleTick();

        const audioPlayer = assertWrap.isDefined(engine.state.audioPlayer);
        const fake = {
            contextState: 'suspended',
            hasBeenActive: false,
            isButtonPressed: false,
        };
        const resumeStates: string[] = [];
        Object.defineProperty(audioPlayer.audioContext, 'state', {
            configurable: true,
            get() {
                return fake.contextState;
            },
        });
        audioPlayer.audioContext.resume = () => {
            resumeStates.push(fake.contextState);
            fake.contextState = 'running';

            return Promise.resolve();
        };
        Object.defineProperty(globalThis.navigator, 'userActivation', {
            configurable: true,
            get() {
                return {
                    hasBeenActive: fake.hasBeenActive,
                };
            },
        });
        Object.defineProperty(globalThis.navigator, 'getGamepads', {
            configurable: true,
            value() {
                return [
                    null,
                    {
                        buttons: [
                            {
                                pressed: fake.isButtonPressed,
                            },
                        ],
                    },
                ];
            },
        });

        try {
            fake.isButtonPressed = true;
            await engine.runSingleTick();
            fake.hasBeenActive = true;
            fake.isButtonPressed = false;
            await engine.runSingleTick();
            fake.isButtonPressed = true;
            await engine.runSingleTick();
            await engine.runSingleTick();
        } finally {
            Reflect.deleteProperty(globalThis.navigator, 'userActivation');
            Reflect.deleteProperty(globalThis.navigator, 'getGamepads');
            await engine.reset();
        }

        assert.deepEquals(resumeStates, [
            'suspended',
        ]);
    });
});
