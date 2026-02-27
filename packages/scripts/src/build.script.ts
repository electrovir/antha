import {awaitedForEach, combineErrorMessages, log} from '@augment-vir/common';
import {runShellCommand} from '@augment-vir/node';
import {convertTemplateToString, html} from 'element-vir';
import {mkdirSync} from 'node:fs';
import {cp, mkdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {distDirPath, packageDirPaths} from './file-paths.js';

mkdirSync(distDirPath, {recursive: true});

const builds: {
    buildName: string;
    packageDirPath: string;
    buildCommand: string;
    buildOutputDirPath: string;
    finalOutputDirPath: string;
}[] = [
    {
        buildName: 'Antha docs',
        packageDirPath: packageDirPaths.antha,
        finalOutputDirPath: join(distDirPath, 'antha'),
        buildOutputDirPath: join(packageDirPaths.antha, 'dist'),
        buildCommand: 'docs',
    },
    {
        buildName: 'Demo',
        packageDirPath: packageDirPaths.demo,
        finalOutputDirPath: join(distDirPath, 'demo'),
        buildOutputDirPath: join(packageDirPaths.demo, 'dist'),
        buildCommand: 'build',
    },
];

async function createFinalHtml() {
    const links = builds
        .map((build) => {
            const relativePath = build.finalOutputDirPath.replace(distDirPath + '/', '');
            return `            <li><a href="./${relativePath}">${build.buildName}</a></li>`;
        })
        .join('\n');

    await writeFile(
        join(distDirPath, 'index.html'),
        convertTemplateToString(html`
            <!doctype html>
            <html lang="en">
                <head>
                    <meta charset="UTF-8" />
                    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                    <title>Antha</title>
                    <style>
                        body {
                            font-family: system-ui, sans-serif;
                            max-width: 600px;
                            margin: 0;
                            padding: 0 16px;
                        }
                        a {
                            color: #0969da;
                            text-decoration: none;
                        }
                        a:hover {
                            text-decoration: underline;
                        }
                        li {
                            margin: 8px 0;
                        }
                    </style>
                </head>
                <body>
                    <h1>Antha</h1>
                    <ul>
                        ${links}
                    </ul>
                </body>
            </html>
        `),
    );
}

async function runBuilds() {
    await rm(distDirPath, {
        force: true,
        recursive: true,
    });
    await mkdir(distDirPath, {
        recursive: true,
    });
    await awaitedForEach(builds, async (build) => {
        try {
            log.info(`Building '${build.buildName}'...`);
            await runShellCommand(`npm run ${build.buildCommand}`, {
                cwd: build.packageDirPath,
                hookUpToConsole: true,
                rejectOnError: true,
            });

            await rm(build.finalOutputDirPath, {
                force: true,
                recursive: true,
            });

            await cp(build.buildOutputDirPath, build.finalOutputDirPath, {
                recursive: true,
            });
            log.faint(`Finished building '${build.buildName}'.`);
        } catch (error) {
            log.error(combineErrorMessages(`Failed to build '${build.buildName}'.`, error));
        }
    });
    await createFinalHtml();
    log.success('Build complete.');
}

try {
    await runBuilds();
    process.exit(0);
} catch (error) {
    log.error(error);
    process.exit(1);
}
