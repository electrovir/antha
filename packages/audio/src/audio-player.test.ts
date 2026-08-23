import {assert, assertWrap, waitUntil} from '@augment-vir/assert';
import {DeferredPromise, wait} from '@augment-vir/common';
import {describe, it, testWeb} from '@augment-vir/test';
import {html} from 'element-vir';
import {AudioFilePlayStartEvent, createAudioSourceKey} from './audio-file.js';
import {
    AudioPlayer,
    type AudioLoadProgressCallbackParams,
    type AudioSetupParams,
} from './audio-player.js';
import {Codec} from './codecs.js';
import {isPlayingEnabled} from './detect-play.js';
import {longerMp3FileUrl, shortMp3FileUrl} from './files.mock.js';

export async function makePlayable() {
    const fixture = await testWeb.render(html`
        <button></button>
    `);
    await testWeb.click(fixture);

    /** Reuse a single context: a fresh one per poll starts suspended again in Firefox. */
    const audioContext = new AudioContext();
    await waitUntil.isTrue(() => isPlayingEnabled(audioContext));
}

const shortMp3Params: AudioSetupParams = {
    sources: [shortMp3FileUrl],
};
const longerMp3Params: AudioSetupParams = {
    sources: [longerMp3FileUrl],
};

describe(AudioPlayer.name, () => {
    it('rejects a missing file extension', async () => {
        await makePlayable();

        await assert.throws(() => {
            return new AudioPlayer().play({
                sources: ['invalid'],
            });
        });
    });
    it('allows a specified codec', async () => {
        await makePlayable();
        assert.isDefined(
            new AudioPlayer().play({
                sources: [
                    {
                        url: 'invalid',
                        codec: Codec.mp3,
                    },
                ],
            }),
        );
    });
    it('destroys all files', async () => {
        const player = new AudioPlayer();
        await player.loadFiles([shortMp3Params]);

        const sourceKey = createAudioSourceKey(shortMp3Params);
        const audioFile = player.audioFiles[sourceKey];
        assert.isDefined(audioFile);

        assert.isFalse(player.isDestroyed);
        assert.isFalse(audioFile.isDestroyed);

        await player.destroy();

        assert.isTrue(player.isDestroyed);
        assert.isTrue(audioFile.isDestroyed);
        assert.isEmpty(player.audioFiles);
    });
    it('can be destroyed multiple times without error', async () => {
        const player = new AudioPlayer();

        await player.destroy();
        await player.destroy();

        assert.isTrue(player.isDestroyed);
    });
    it('loads a real audio file', async () => {
        const player = new AudioPlayer();

        await player.loadFiles([longerMp3Params]);

        assert.isLengthExactly(Object.keys(player.audioFiles), 1);
    });
    it('loads a real audio file with serial option', async () => {
        const player = new AudioPlayer();

        await player.loadFiles([longerMp3Params], {
            serial: true,
        });

        assert.isLengthExactly(Object.keys(player.audioFiles), 1);
    });
    it('sets all isPlayingEnabled', async () => {
        const player = new AudioPlayer();
        const shortSourceKey = createAudioSourceKey(shortMp3Params);
        const shortMp3Params2: AudioSetupParams = {
            sources: [shortMp3FileUrl],
            volume: 0.5,
        };
        const shortSourceKey2 = createAudioSourceKey(shortMp3Params2);

        await player.loadFiles([
            shortMp3Params,
            shortMp3Params2,
        ]);
        const audioFile = player.audioFiles[shortSourceKey];
        const audioFile2 = player.audioFiles[shortSourceKey2];
        assert.isDefined(audioFile);
        assert.isDefined(audioFile2);

        await player.play(shortMp3Params);

        await makePlayable();

        await player.play(shortMp3Params);

        await waitUntil.isTrue(async () => {
            await player.play(shortMp3Params);

            return audioFile.isAudioAllowed && audioFile2.isAudioAllowed;
        });
    });
    it('loads all files', async () => {
        const player = new AudioPlayer();

        assert.isEmpty(player.audioCache);

        await player.loadFiles([shortMp3Params]);

        assert.hasKey(player.audioCache, shortMp3FileUrl);
        assert.isLengthExactly(Object.keys(player.audioCache), 1);
    });
    it('stops files without unloading them', async () => {
        const player = new AudioPlayer();
        const quieterLongerMp3Params: AudioSetupParams = {
            ...longerMp3Params,
            volume: 0.5,
        };
        const firstSourceKey = createAudioSourceKey(longerMp3Params);
        const secondSourceKey = createAudioSourceKey(quieterLongerMp3Params);

        try {
            await player.loadFiles([
                longerMp3Params,
                quieterLongerMp3Params,
            ]);
            await makePlayable();

            const firstAudioFile = assertWrap.isDefined(player.audioFiles[firstSourceKey]);
            const firstPlaybackStarted = new DeferredPromise<void>();
            firstAudioFile.listen(
                new AudioFilePlayStartEvent(),
                () => {
                    firstPlaybackStarted.resolve();
                },
                {
                    once: true,
                },
            );
            const firstPlayback = player.play(longerMp3Params);

            await firstPlaybackStarted.promise;
            player.stopFile(longerMp3Params);

            assert.isTrue(
                await Promise.race([
                    firstPlayback,
                    wait({
                        milliseconds: 100,
                    }).then(() => false),
                ]),
            );

            const secondAudioFile = assertWrap.isDefined(player.audioFiles[secondSourceKey]);
            const secondPlaybackStarted = new DeferredPromise<void>();
            secondAudioFile.listen(
                new AudioFilePlayStartEvent(),
                () => {
                    secondPlaybackStarted.resolve();
                },
                {
                    once: true,
                },
            );
            const secondPlayback = player.play(quieterLongerMp3Params);

            await secondPlaybackStarted.promise;
            player.stopFiles([
                quieterLongerMp3Params,
            ]);

            assert.isTrue(
                await Promise.race([
                    secondPlayback,
                    wait({
                        milliseconds: 100,
                    }).then(() => false),
                ]),
            );

            const thirdPlaybackStarted = new DeferredPromise<void>();
            firstAudioFile.listen(
                new AudioFilePlayStartEvent(),
                () => {
                    thirdPlaybackStarted.resolve();
                },
                {
                    once: true,
                },
            );
            const thirdPlayback = player.play(longerMp3Params);

            await thirdPlaybackStarted.promise;
            player.stopAllFiles();

            assert.isTrue(
                await Promise.race([
                    thirdPlayback,
                    wait({
                        milliseconds: 100,
                    }).then(() => false),
                ]),
            );
            assert.hasKeys(player.audioFiles, [
                firstSourceKey,
                secondSourceKey,
            ]);
            assert.hasKey(player.audioCache, longerMp3FileUrl);
            assert.isFalse(firstAudioFile.isDestroyed);
            assert.isFalse(secondAudioFile.isDestroyed);
        } finally {
            await player.destroy();
        }
    });
    it('loads and unloads multiple files', async () => {
        const player = new AudioPlayer();
        const progressResults: AudioLoadProgressCallbackParams[] = [];

        await player.loadFiles(
            [
                shortMp3Params,
            ],
            {
                serial: true,
                progressCallback(progress) {
                    progressResults.push(progress);
                },
            },
        );

        assert.deepEquals(progressResults, [
            {
                finished: true,
                loaded: 1,
                total: 1,
            },
        ]);

        assert.hasKeys(player.audioCache, [
            shortMp3FileUrl,
        ]);
        assert.strictEquals((await player.audioCache[shortMp3FileUrl]).using.size, 1);

        await player.loadFiles([longerMp3Params]);

        assert.hasKeys(
            player.audioCache,
            [
                shortMp3FileUrl,
                longerMp3FileUrl,
            ],
            'short mp3 remains when still in use',
        );

        await player.unloadFiles([shortMp3Params]);

        assert.lacksKey(
            player.audioCache,
            shortMp3FileUrl,
            'should unload the file when no longer in use',
        );
    });
});
