import {arrayToObject} from '@augment-vir/common';
import {type AnthaDemo} from './demo.js';
import {basicEngineDemo} from './demos/1-basic-engine.demo.js';
import {pixiCanvasDemo} from './demos/2-pixi-canvas.demo.js';
import {audioEngineDemo} from './demos/3-audio-engine.demo.js';
import {entitiesDemo} from './demos/4-entities.demo.js';
import {spritesDemo} from './demos/5-dynamic-sprite.demo.js';
import {assetLoadingDemo} from './demos/6-asset-loading.demo.js';
import {entityAssetLoadingDemo} from './demos/7-entity-asset-loading.demo.js';

export const allDemos: AnthaDemo[] = [
    basicEngineDemo,
    pixiCanvasDemo,
    audioEngineDemo,
    entitiesDemo,
    spritesDemo,
    assetLoadingDemo,
    entityAssetLoadingDemo,
];

export const allDemosByPathKey = arrayToObject(allDemos, (demo) => {
    return {
        key: demo.demoPathId,
        value: demo,
    };
});
