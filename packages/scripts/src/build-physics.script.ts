// cspell:words dndebug emsdk msimd msse

/**
 * Builds Box2D and Box3D into the single-file wasm modules that `@antha/entity-2d` and
 * `@antha/entity-3d` import, with SIMD and without threads. Needs `emcc` from the Emscripten SDK.
 */

import {awaitedForEach, log} from '@augment-vir/common';
import {runShellCommand} from '@augment-vir/node';
import {existsSync} from 'node:fs';
import {copyFile, mkdir, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {physicsCacheDirPath, physicsEngineDirPaths} from './file-paths.js';

const engines = [
    {
        name: 'box2d',
        repoUrl: 'https://github.com/erincatto/box2d.git',
        tag: 'v3.2.0',
        commit: '178495ba35695aefe9c321e569d2277f06db3b90',
        outputDirPath: physicsEngineDirPaths.box2d,
    },
    {
        name: 'box3d',
        repoUrl: 'https://github.com/erincatto/box3d.git',
        tag: 'v0.1.0',
        commit: '8441b4a06d6d09dcfb0b0f704df4d847d1437b92',
        outputDirPath: physicsEngineDirPaths.box3d,
    },
];

async function run({command, cwd}: Readonly<{command: string; cwd?: string | undefined}>) {
    const result = await runShellCommand(command, {
        cwd,
    });
    if (result.exitCode) {
        throw new Error(`'${command}' failed:\n${result.stderr || result.stdout}`);
    }
    return result.stdout.trim();
}

async function checkoutSource({repoUrl, tag, commit, name}: (typeof engines)[number]) {
    const sourceDirPath = join(physicsCacheDirPath, `${name}-${tag}`);
    if (!existsSync(sourceDirPath)) {
        await mkdir(physicsCacheDirPath, {
            recursive: true,
        });
        await run({
            command: `git clone --depth 1 --branch ${tag} ${repoUrl} ${sourceDirPath}`,
        });
    }
    const checkedOutCommit = await run({
        command: 'git rev-parse HEAD',
        cwd: sourceDirPath,
    });
    if (checkedOutCommit !== commit) {
        throw new Error(
            `${repoUrl} tag ${tag} is at ${checkedOutCommit}, not the expected ${commit}. Delete '${sourceDirPath}' to clone it again.`,
        );
    }
    return sourceDirPath;
}

async function buildEngine(engine: (typeof engines)[number]) {
    const sourceDirPath = await checkoutSource(engine);
    const sourceFilePaths = (await readdir(join(sourceDirPath, 'src')))
        .filter((fileName) => fileName.endsWith('.c'))
        .map((fileName) => join(sourceDirPath, 'src', fileName));

    await run({
        command: [
            'emcc',
            '-O3',
            /** The engines' timers use POSIX clock names that strict C17 hides. */
            '-std=gnu17',
            '-DNDEBUG',
            /** Their SIMD code is written for SSE2, which Emscripten translates to wasm SIMD. */
            '-msimd128',
            '-msse2',
            `-I${join(sourceDirPath, 'include')}`,
            `-I${join(sourceDirPath, 'src')}`,
            ...sourceFilePaths,
            join(engine.outputDirPath, 'bindings.c'),
            '-sMODULARIZE=1',
            '-sEXPORT_ES6=1',
            /** Embeds the wasm so that bundlers don't need to find and serve a separate file. */
            '-sSINGLE_FILE=1',
            '-sENVIRONMENT=web,worker',
            '-sALLOW_MEMORY_GROWTH=1',
            '-sFILESYSTEM=0',
            '-sEXPORTED_RUNTIME_METHODS=HEAPF32,HEAP32,HEAPU8',
            '--emit-tsd',
            join(engine.outputDirPath, `${engine.name}.d.mts`),
            '-o',
            join(engine.outputDirPath, `${engine.name}.mjs`),
        ].join(' '),
    });
    await copyFile(
        join(sourceDirPath, 'LICENSE'),
        join(engine.outputDirPath, `LICENSE-${engine.name}`),
    );
}

try {
    await run({
        command: 'emcc --version',
    });
} catch (error) {
    throw new Error(
        'emcc was not found. Install the Emscripten SDK (https://emscripten.org/docs/getting_started/downloads.html) and run its emsdk_env.sh first.',
        {
            cause: error,
        },
    );
}

await awaitedForEach(engines, buildEngine);

log.success(`Built ${engines.map((engine) => engine.name).join(' and ')}.`);
