import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {AudioFile} from './audio-file.js';
import {Codec} from './codecs.js';
import {shortMp3Base64, shortMp3FileUrl} from './files.mock.js';

describe(AudioFile.name, () => {
    it('fails to construct on invalid files', () => {
        assert.throws(
            () =>
                new AudioFile({
                    sources: ['derp.gif'],
                }),
        );
    });
    it('can be loaded multiple times', async () => {
        const file = new AudioFile({
            sources: [shortMp3FileUrl],
        });

        const firstLoadPromise = file.load();
        const secondLoadPromise = file.load();
        assert.strictEquals(
            await firstLoadPromise,
            await secondLoadPromise,
            'array buffers should be the same',
        );
        assert.strictEquals(firstLoadPromise, secondLoadPromise, 'promises should be the same');
    });
    it('can destroy itself multiple times', async () => {
        const file = new AudioFile({
            sources: [shortMp3FileUrl],
        });

        await file.destroy();
        await file.destroy();
    });
    it('allows overriding a source codec', () => {
        assert.throws(
            () =>
                new AudioFile({
                    sources: ['../www-static/powerUp3'],
                }),
        );

        assert.isDefined(
            new AudioFile({
                sources: [
                    {
                        url: '../www-static/powerUp3',
                        codec: Codec.mp3,
                    },
                ],
            }),
        );
    });
    it('can play a base64 file', async () => {
        const file = new AudioFile({
            sources: [shortMp3Base64],
        });

        await file.load();
        await file.play();
    });
    it('fails to play a destroyed file', async () => {
        const file = new AudioFile({
            sources: [shortMp3Base64],
        });

        await file.destroy();
        await assert.throws(() => file.play());
    });
    it('can auto load', async () => {
        const file = new AudioFile({
            sources: [shortMp3Base64],
        });

        await file.play();
    });
    it('errors on invalid file', async () => {
        const file = new AudioFile({
            sources: [
                './invalid.mp3',
            ],
        });

        await assert.throws(() => file.load());
    });
    it('can apply effects', () => {
        assert.isDefined(
            new AudioFile({
                sources: [
                    './invalid.mp3',
                ],
                createEffects(audioContext) {
                    const wave1 = audioContext.createWaveShaper();
                    const wave2 = audioContext.createWaveShaper();
                    wave1.curve = makeDistortionCurve(20);
                    wave2.curve = makeDistortionCurve(20);
                    return [
                        wave1,
                        wave2,
                    ];
                },
            }),
        );
    });
});

function makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
    const samples = 44_100;
    const curve = new Float32Array(samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < samples; i++) {
        const x = (i * 2) / samples - 1;
        curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
}
