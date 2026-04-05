import {arrayToObject} from '@augment-vir/common';
import {type AnthaDemo} from './demo.js';
import {basicEngineDemo} from './demos/1-basic-engine.demo.js';
import {playerMovementDemo} from './demos/10-player-movement.demo.js';
import {stutterDetectionDemo} from './demos/11-stutter-detection.demo.js';
import {pixiCanvasDemo} from './demos/2-pixi-canvas.demo.js';
import {audioEngineDemo} from './demos/3-audio-engine.demo.js';
import {entitiesDemo} from './demos/4-entities.demo.js';
import {spriteMovementDemo} from './demos/5-sprite-movement.demo.js';
import {assetLoadingDemo} from './demos/6-asset-loading.demo.js';
import {entityAssetLoadingDemo} from './demos/7-entity-asset-loading.demo.js';
import {rawInputsDemo} from './demos/8-raw-inputs.demo.js';
import {inputBindingsDemo} from './demos/9-input-bindings.demo.js';

export const allDemos: AnthaDemo[] = [
    basicEngineDemo,
    pixiCanvasDemo,
    audioEngineDemo,
    entitiesDemo,
    spriteMovementDemo,
    assetLoadingDemo,
    entityAssetLoadingDemo,
    rawInputsDemo,
    inputBindingsDemo,
    playerMovementDemo,
    stutterDetectionDemo,
];

export const allDemosByPathKey = arrayToObject(allDemos, (demo) => {
    return {
        key: demo.demoPathId,
        value: demo,
    };
});
