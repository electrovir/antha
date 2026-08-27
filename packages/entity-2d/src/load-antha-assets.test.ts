import {AssetLoader} from '@antha/asset';
import {type AudioPlayer, type AudioSetupParams} from '@antha/audio';
import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {createAnthaEntityMod2d} from './antha-entity.mod.js';
import {loadAnthaAssets} from './load-antha-assets.js';

describe(loadAnthaAssets.name, () => {
    it('loads entity assets, audio files, and additional assets', async () => {
        const loadedResourceNames: string[] = [];
        const assetLoader = new AssetLoader();
        const {defineLogicEntity} = createAnthaEntityMod2d({});

        class AssetEntity extends defineLogicEntity({
            key: 'AssetEntity',
            paramsShape: undefined,
            assets: {
                entityAsset: {
                    maxProgress: 1,
                    load({incrementProgressCallback}) {
                        loadedResourceNames.push('entity');
                        incrementProgressCallback();
                        return {
                            value: undefined,
                        };
                    },
                },
            },
        }) {
            public override update(): void {}
        }

        const audioFiles = [
            {
                sources: 'audio-file',
            },
        ] satisfies ReadonlyArray<Readonly<AudioSetupParams>>;
        const audioPlayer = {
            async loadFiles(files, options = {}) {
                loadedResourceNames.push(options.serial ? 'audio serial' : 'audio parallel');
                await options.progressCallback?.({
                    finished: true,
                    loaded: files.length,
                    total: files.length,
                });
                return [];
            },
        } satisfies Pick<AudioPlayer, 'loadFiles'>;

        await loadAnthaAssets({
            assetLoader,
            assets: [
                {
                    assetName: 'Additional asset',
                    maxProgress: 1,
                    load({incrementProgressCallback}) {
                        loadedResourceNames.push('additional');
                        incrementProgressCallback();
                        return {
                            value: undefined,
                        };
                    },
                },
            ],
            audio: {
                audioPlayer,
                files: audioFiles,
                serial: true,
            },
            entities: [AssetEntity],
        });

        assert.deepEquals(loadedResourceNames.toSorted(), [
            'additional',
            'audio serial',
            'entity',
        ]);
    });

    it('loads no assets when optional inputs are omitted', async () => {
        const loadedAssets = await loadAnthaAssets({
            assetLoader: new AssetLoader(),
        });

        assert.deepEquals(loadedAssets, []);
    });
});
