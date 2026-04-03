import {AnthaEngine} from '@antha/engine';
import {createAnthaReadRawInputMod} from '@antha/input';
import {createAnthaPixiFpsMod} from '@antha/pixi-canvas';
import {createUtcFullDate} from 'date-vir';
import {type AnthaDemo} from '../demo.js';

export const rawInputsDebugDemo: AnthaDemo = {
    demoName: 'Raw Inputs Debug',
    demoPathId: 'raw-inputs-debug',
    demoSortDate: createUtcFullDate('2026-04-03'),
    engine() {
        return new AnthaEngine({
            mods: [
                createAnthaPixiFpsMod({
                    hideFps: true,
                }),
                createAnthaReadRawInputMod({
                    debugRawInputs: true,
                }),
            ],
        });
    },
};
