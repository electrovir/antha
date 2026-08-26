# @antha/asset

A pre-built [Antha game engine](https://www.npmjs.com/package/@antha/engine) mod for defining, caching, and cleaning up game assets.

## Install

```sh
npm i @antha/asset
```

## Usage

<!-- example-link: src/readme-examples/loading-asset.example.ts -->

```TypeScript
import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {
    type AnthaAssetModState,
    type AssetLoader,
    createAnthaAssetMod,
    defineAsset,
} from '@antha/asset';

type GameState = AnthaAssetModState & {
    hasLoadedTitle: boolean;
};

const titleAsset = defineAsset({
    assetName: 'title',
    maxProgress: 1,
    load({incrementProgressCallback}) {
        incrementProgressCallback();

        return {
            value: 'Antha',
        };
    },
});

async function loadTitleAsset({
    assetLoader,
}: Readonly<{
    assetLoader: AssetLoader;
}>) {
    const loadSession = assetLoader.createLoadSession();

    await assetLoader.bulkLoadAssets(
        [
            titleAsset,
        ],
        {
            loadSession,
        },
    );
    loadSession.complete();
}

const engine = new AnthaEngine<GameState>({
    initState: {
        hasLoadedTitle: false,
    },
    mods: [
        createAnthaAssetMod(),
        defineAnthaMod<GameState>({
            modName: 'game-logic',
            execute({state}) {
                if (state.assetLoader && !state.hasLoadedTitle) {
                    state.hasLoadedTitle = true;
                    void loadTitleAsset({
                        assetLoader: state.assetLoader,
                    });
                }
            },
        }),
    ],
});

engine.startLoop();
```
