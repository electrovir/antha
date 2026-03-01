import {arrayToObject} from '@augment-vir/common';
import {type AnthaDemo} from './demo.js';
import {basicEngineDemo} from './demos/1-basic-engine.demo.js';
import {pixiCanvasDemo} from './demos/2-pixi-canvas.demo.js';
import {audioEngineDemo} from './demos/3-audio-engine.demo.js';

export const allDemos: AnthaDemo[] = [
    basicEngineDemo,
    pixiCanvasDemo,
    audioEngineDemo,
];

export const allDemosByPathKey = arrayToObject(allDemos, (demo) => {
    return {
        key: demo.demoPathId,
        value: demo,
    };
});
