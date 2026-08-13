import {PromiseQueue, wrapInTry} from '@augment-vir/common';
import {nodeResolvePlugin} from '@web/dev-server';
import {type Plugin} from '@web/dev-server-core';
import {esbuildPlugin} from '@web/dev-server-esbuild';
import {runTests as runTestRunner} from '@web/test-runner-core/test-helpers';
import {playwrightLauncher} from '@web/test-runner-playwright';
import {join} from 'node:path';
import {packageDirPath, testFilesDirPath} from './repo-paths.mock.js';

const testRunnerQueue = new PromiseQueue();

/** @returns Whether the tests passed or not */
export async function runTests(options: {
    /** An array of file paths relative to the `test-files` directory. */
    files: ReadonlyArray<string>;
    plugins?: ReadonlyArray<Plugin>;
    rootDir?: string;
}): Promise<boolean> {
    const rootDir: string = options.rootDir || packageDirPath;

    const result = await testRunnerQueue.add(() => {
        return wrapInTry(
            () => {
                return runTestRunner(
                    {
                        rootDir,
                        files: options.files.map((file) => join(testFilesDirPath, file)),
                        coverage: false,
                        concurrency: 1,
                        browserStartTimeout: 120_000,
                        browsers: [
                            playwrightLauncher({
                                product: 'webkit',
                            }),
                        ],
                        plugins: [
                            ...(options.plugins || []),
                            esbuildPlugin({
                                ts: true,
                            }),
                            nodeResolvePlugin(packageDirPath),
                        ],
                    },
                    undefined,
                    {
                        allowFailure: true,
                    },
                );
            },
            {
                fallbackValue: undefined,
            },
        );
    });
    if (!result) {
        return false;
    }

    await result.runner.stop();
    await Promise.all(
        result.runner.browsers.map(async (browser) => {
            await browser.stop?.();
        }),
    );
    return result.runner.passed;
}
