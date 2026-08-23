import {awaitedForEach, combineErrorMessages, log} from '@augment-vir/common';
import {runShellCommand} from '@augment-vir/node';
import {convertTemplateToString, html} from 'element-vir';
import {mkdirSync} from 'node:fs';
import {cp, mkdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {distDirPath, packageDirPaths} from './file-paths.js';

mkdirSync(distDirPath, {
    recursive: true,
});

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
        finalOutputDirPath: join(distDirPath, 'docs'),
        buildOutputDirPath: join(packageDirPaths.antha, 'dist-docs'),
        buildCommand: 'docs',
    },
    {
        buildName: 'Demos',
        packageDirPath: packageDirPaths.demos,
        finalOutputDirPath: join(distDirPath, 'demo'),
        buildOutputDirPath: join(packageDirPaths.demos, 'dist'),
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

/**
 * GitHub Pages serves 404.html for any path that doesn't match a real file. This generates a smart
 * 404 page that detects which sub-app the URL belongs to (e.g. `/antha/demo/...` or
 * `/antha/docs/...`), fetches that sub-app's `index.html`, and replaces the document content while
 * preserving the full URL so the SPA router handles the route.
 */
async function create404Html() {
    const repoBase = '/antha';

    const subDirs = builds.map((build) => build.finalOutputDirPath.replace(distDirPath + '/', ''));

    await writeFile(
        join(distDirPath, '404.html'),
        convertTemplateToString(html`
            <!doctype html>
            <html lang="en">
                <head>
                    <meta charset="UTF-8" />
                    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                    <title>Redirecting...</title>
                    <script type="module">
                        const repoBase = ${JSON.stringify(repoBase)};
                        const knownSubDirs = ${JSON.stringify(subDirs)};
                        const path = window.location.pathname;

                        const prefix = path.startsWith(repoBase + '/')
                            ? path.slice(repoBase.length + 1)
                            : '';
                        const subDir = prefix.split('/')[0];

                        if (!subDir || !knownSubDirs.includes(subDir)) {
                            window.location.replace(repoBase + '/');
                        } else {
                            const indexUrl = repoBase + '/' + subDir + '/index.html';

                            try {
                                const response = await fetch(indexUrl);

                                if (!response.ok) {
                                    throw new Error(String(response.status));
                                }

                                const html = await response.text();

                                document.open();
                                document.write(html);
                                document.close();
                            } catch {
                                window.location.replace(repoBase + '/');
                            }
                        }
                    </script>
                </head>
                <body></body>
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
    await create404Html();

    log.success('Build complete.');
}

try {
    await runBuilds();
    process.exit(0);
} catch (error) {
    log.error(error);
    process.exit(1);
}
