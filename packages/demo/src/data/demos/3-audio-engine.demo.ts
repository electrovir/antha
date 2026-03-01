import {createAnthaAudioMod, type AnthaAudioState, type AudioSetupParams} from '@antha/audio';
import {createPixiFpsMod} from '@antha/pixi-canvas';
import {AnthaEngine, SkipExecution, type AnthaMod} from 'antha';
import {createUtcFullDate} from 'date-vir';
import {css, html, listen} from 'element-vir';
import {ViraButton} from 'vira';
import {type AnthaDemo} from '../demo.js';

const audioFiles: ReadonlyArray<
    {
        label: string;
    } & AudioSetupParams
> = [
    {
        label: 'Back',
        sources: '/audio/back_004.mp3',
    },
    {
        label: 'Confirmation',
        sources: '/audio/confirmation_002.mp3',
    },
    {
        label: 'Power Up',
        sources: '/audio/powerUp3.mp3',
    },
];

const audioControlsMod: AnthaMod<AnthaAudioState> = {
    execute({state}) {
        if (!state.audioPlayer) {
            return SkipExecution;
        }

        const buttonTemplates = audioFiles.map((audioFile) => {
            return html`
                <${ViraButton.assign({
                    text: `▶️ ${audioFile.label}`,
                })}
                    ${listen('mousedown', async () => {
                        await state.audioPlayer?.play(audioFile);
                    })}
                ></${ViraButton}>
            `;
        });

        return html`
            <div
                style=${css`
                    position: absolute;
                    top: calc(50% + 30px);
                    left: 50%;
                    transform: translate(-50%, 0%);
                `}
            >
                ${buttonTemplates}
            </div>
        `;
    },
};

export const audioEngineDemo: AnthaDemo = {
    demoName: 'Audio Engine',
    demoPathId: 'audio',
    sortDate: createUtcFullDate('2026-03-01T00:00:00.000Z'),
    engine() {
        return new AnthaEngine({
            mods: [
                createAnthaAudioMod(),
                createPixiFpsMod({
                    showFps: false,
                }),
                audioControlsMod,
            ],
        });
    },
};
