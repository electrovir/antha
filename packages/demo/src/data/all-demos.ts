import {arrayToObject} from '@augment-vir/common';
import {type AnthaDemo} from './demo.js';
import {basicEngineDemo} from './demos/basic-engine.demo.js';

export const allDemos: AnthaDemo[] = [
    basicEngineDemo,
];

export const allDemosByPathKey = arrayToObject(allDemos, (demo) => {
    return {
        key: demo.demoPathId,
        value: demo,
    };
});
