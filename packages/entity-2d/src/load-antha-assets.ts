import {
    defineAsset,
    type Asset,
    type AssetBulkLoaderLoadOptions,
    type AssetLoader,
} from '@antha/asset';
import {type AudioPlayer, type AudioSetupParams} from '@antha/audio';
import {getObjectTypedValues, type PartialWithUndefined} from '@augment-vir/common';
import {type Entity2dConstructor} from './entity.js';

/** Audio files and their player to include in {@link loadAnthaAssets}. */
export type AnthaAudioFilesToLoad = {
    audioPlayer: Pick<AudioPlayer, 'loadFiles'>;
    files: ReadonlyArray<Readonly<AudioSetupParams>>;
} & PartialWithUndefined<{
    /** Label shown for this audio load on the loading screen. */
    assetName: string;
    /** Whether audio files should load sequentially. */
    serial: boolean;
}>;

/** Inputs for {@link loadAnthaAssets}. */
export type LoadAnthaAssetsParams = {
    assetLoader: AssetLoader;
} & PartialWithUndefined<{
    /** Assets declared by these entity classes are loaded. */
    entities: ReadonlyArray<Entity2dConstructor>;
    /** Audio files to load through their audio player. */
    audio: AnthaAudioFilesToLoad;
    /** Additional assets to load. */
    assets: ReadonlyArray<Readonly<Asset>>;
}>;

function createAudioLoadAsset({
    assetName = 'Audio files',
    audioPlayer,
    files,
    serial,
}: Readonly<AnthaAudioFilesToLoad>) {
    return defineAsset({
        assetName,
        maxProgress: files.length,
        async load({incrementProgressCallback}) {
            await audioPlayer.loadFiles(files, {
                progressCallback() {
                    incrementProgressCallback();
                },
                serial: !!serial,
            });

            return {
                value: undefined,
            };
        },
    });
}

/**
 * Loads assets declared by entities, audio files, and any additional assets in one load session.
 *
 * @category Main
 */
export async function loadAnthaAssets(
    {assetLoader, assets, audio, entities}: Readonly<LoadAnthaAssetsParams>,
    options?: Readonly<AssetBulkLoaderLoadOptions> | undefined,
) {
    return await assetLoader.bulkLoadAssets(
        [
            ...(audio
                ? [
                      createAudioLoadAsset(audio),
                  ]
                : []),
            ...(assets || []),
            ...(entities || []).flatMap((entity) => {
                return getObjectTypedValues(entity.assets);
            }),
        ],
        options,
    );
}
