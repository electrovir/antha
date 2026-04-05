import {AnthaEngine} from '@antha/engine';
import {createAnthaPixiFpsMod} from '@antha/graphics-2d';
import {createAnthaReadRawInputMod} from '@antha/input';
import {createUtcFullDate} from 'date-vir';
import {type AnthaDemo} from '../demo.js';

export const rawInputsDemo: AnthaDemo = {
    demoName: 'Raw Inputs',
    demoPathId: 'raw-inputs',
    demoSortDate: createUtcFullDate('2026-04-03T10:00:00'),
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
