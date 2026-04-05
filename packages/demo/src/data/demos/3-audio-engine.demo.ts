import {createAnthaAudioMod, type AnthaAudioState, type AudioSetupParams} from '@antha/audio';
import {AnthaEngine, SkipExecution, type AnthaMod} from '@antha/engine';
import {createAnthaPixiFpsMod} from '@antha/graphics-2d';
import {createUtcFullDate} from 'date-vir';
import {css, html, listen} from 'element-vir';
import {joinUrlPaths} from 'url-vir';
import {ViraButton} from 'vira';
import {githubPagesBasePathname, isOnGitHubPages} from '../demo-router.js';
import {type AnthaDemo} from '../demo.js';

function resolveAudioPath(fileName: string): string {
    if (isOnGitHubPages()) {
        return joinUrlPaths(githubPagesBasePathname, 'audio', fileName);
    } else {
        return joinUrlPaths('', 'audio', fileName);
    }
}

const audioFileNames: ReadonlyArray<{
    label: string;
    fileName: string;
}> = [
    {
        label: 'Back',
        fileName: 'back_004.mp3',
    },
    {
        label: 'Confirmation',
        fileName: 'confirmation_002.mp3',
    },
    {
        label: 'Power Up',
        fileName: 'powerUp3.mp3',
    },
];

const audioControlsMod: AnthaMod<AnthaAudioState> = {
    modName: 'demo-audio-controls',
    execute({state}) {
        if (!state.audioPlayer) {
            return SkipExecution;
        }

        const audioFiles: ReadonlyArray<{label: string} & AudioSetupParams> = audioFileNames.map(
            (config) => {
                return {
                    label: config.label,
                    sources: resolveAudioPath(config.fileName),
                };
            },
        );

        const buttonTemplates = audioFiles.map((audioFile) => {
            return html`
                <${ViraButton.assign({
                    text: `▶️ ${audioFile.label}`,
                })}
                    ${listen('click', async () => {
                        await state.audioPlayer?.play(audioFile);
                    })}
                ></${ViraButton}>
            `;
        });

        return html`
            <div
                style=${css`
                    position: absolute;
                    top: 50%;
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
    demoSortDate: createUtcFullDate('2026-03-01T00:00:00.000Z'),
    engine() {
        return new AnthaEngine({
            mods: [
                createAnthaAudioMod(),
                createAnthaPixiFpsMod({
                    hideFps: true,
                }),
                audioControlsMod,
            ],
        });
    },
};
