import {wrapInTry} from '@augment-vir/common';
import {nodeResolvePlugin} from '@web/dev-server';
import {type Plugin} from '@web/dev-server-core';
import {esbuildPlugin} from '@web/dev-server-esbuild';
import {runTests as runTestRunner} from '@web/test-runner-core/test-helpers';
import {playwrightLauncher} from '@web/test-runner-playwright';
import {join} from 'node:path';
import {repoDirPath, testFilesDirPath} from './repo-paths.mock.js';

/** @returns Whether the tests passed or not */
export async function runTests(options: {
    /** An array of file paths relative to the `test-files` directory. */
    files: ReadonlyArray<string>;
    plugins?: ReadonlyArray<Plugin>;
    rootDir?: string;
}): Promise<boolean> {
    const rootDir: string = options.rootDir || repoDirPath;

    const result = await wrapInTry(
        () => {
            return runTestRunner({
                rootDir,
                files: options.files.map((file) => join(testFilesDirPath, file)),
                coverage: false,
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
                    nodeResolvePlugin(repoDirPath),
                ],
            });
        },
        {
            fallbackValue: undefined,
        },
    );
    await result?.runner.stop();
    return !!result;
}
