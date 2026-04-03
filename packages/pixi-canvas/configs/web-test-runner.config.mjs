import {defineConfig} from '@virmator/test/configs/web-test-runner.config.base.mjs';
import {dirname} from 'path';
import {fileURLToPath, pathToFileURL} from 'url';
import {pixiPlugin} from 'web-test-runner-plugin-pixi';
import {testPorts} from '../../../configs/test-ports.mjs';

const baseConfig = defineConfig({
    coveragePercent: 100,
    packageRootDirPath: dirname(dirname(fileURLToPath(import.meta.url))),
    extraScreenshotOptions: {},
});

/** @type {import('@web/test-runner').TestRunnerConfig} */
const webTestRunnerConfig = {
    ...baseConfig,
    plugins: [
        pixiPlugin(),
        ...baseConfig.plugins,
    ],
    port: testPorts['pixi-canvas'],
};

export default webTestRunnerConfig;

/** Log the full config if this file file is run directly as a script, for debugging. */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    console.info(JSON.stringify(webTestRunnerConfig, null, 4));
}
