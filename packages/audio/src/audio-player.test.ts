import {assert, waitUntil} from '@augment-vir/assert';
import {describe, it, testWeb} from '@augment-vir/test';
import {html} from 'element-vir';
import {createAudioSourceKey, type AudioFile, type AudioFileCache} from './audio-file.js';
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

    await waitUntil.isTrue(() => isPlayingEnabled());
}

const shortMp3Params: AudioSetupParams = {
    sources: [shortMp3FileUrl],
};
const longerMp3Params: AudioSetupParams = {
    sources: [longerMp3FileUrl],
};

/** Access protected members for testing. */
function getInternals(player: AudioPlayer) {
    return player as unknown as {
        audioFiles: {[key: string]: AudioFile};
        audioCache: AudioFileCache;
        isDestroyed: boolean;
    };
}

describe(AudioPlayer.name, () => {
    it('rejects a missing file extension', async () => {
        await makePlayable();

        await assert.throws(() =>
            new AudioPlayer().play({
                sources: ['invalid'],
            }),
        );
    });
    it('allows a specified codec', () => {
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

        const internals = getInternals(player);
        const sourceKey = createAudioSourceKey(shortMp3Params);
        const audioFile = internals.audioFiles[sourceKey];
        assert.isDefined(audioFile);

        assert.isFalse(internals.isDestroyed);
        assert.isFalse(audioFile.isDestroyed);

        await player.destroy();

        assert.isTrue(internals.isDestroyed);
        assert.isTrue(audioFile.isDestroyed);
        assert.isEmpty(internals.audioFiles);
    });
    it('can be destroyed multiple times without error', async () => {
        const player = new AudioPlayer();

        await player.destroy();
        await player.destroy();
    });
    it('loads a real audio file', async () => {
        const player = new AudioPlayer();

        await player.loadFiles([longerMp3Params]);
    });
    it('loads a real audio file with serial option', async () => {
        const player = new AudioPlayer();

        await player.loadFiles([longerMp3Params], {
            serial: true,
        });
    });
    it('sets all isPlayingEnabled', async () => {
        const player = new AudioPlayer();
        const internals = getInternals(player);
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
        const audioFile = internals.audioFiles[shortSourceKey];
        const audioFile2 = internals.audioFiles[shortSourceKey2];
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

        const internals = getInternals(player);
        assert.isEmpty(internals.audioCache);

        await player.loadFiles([shortMp3Params]);

        assert.hasKey(internals.audioCache, shortMp3FileUrl);
        assert.isLengthExactly(Object.keys(internals.audioCache), 1);
    });
    it('loads and unloads multiple files', async () => {
        const player = new AudioPlayer();
        const internals = getInternals(player);
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

        assert.hasKeys(internals.audioCache, [
            shortMp3FileUrl,
        ]);
        assert.strictEquals((await internals.audioCache[shortMp3FileUrl]).using.size, 1);

        await player.loadFiles([longerMp3Params]);

        assert.hasKeys(
            internals.audioCache,
            [
                shortMp3FileUrl,
                longerMp3FileUrl,
            ],
            'short mp3 remains when still in use',
        );

        await player.unloadFiles([shortMp3Params]);

        assert.lacksKey(
            internals.audioCache,
            shortMp3FileUrl,
            'should unload the file when no longer in use',
        );
    });
});
