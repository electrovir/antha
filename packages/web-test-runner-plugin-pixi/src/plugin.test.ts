import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {pixiPlugin, PixiPlugin} from './plugin.js';
import {monoRepoDirPath, testFilesDirPath} from './repo-paths.mock.js';
import {runTests} from './run-tests.mock.js';

describe(PixiPlugin.name, () => {
    it('is required to fix pixi.js imports', async () => {
        assert.isFalse(
            await runTests({
                files: [
                    'static-pixi.test.ts',
                ],
            }),
        );
    });
    it('handles pixi.js imports', async () => {
        assert.isTrue(
            await runTests({
                files: [
                    'dynamic-pixi.test.ts',
                    'static-pixi.test.ts',
                ],
                plugins: [
                    pixiPlugin(),
                ],
                rootDir: monoRepoDirPath,
            }),
        );
    });
    it('handles pixi.js imports outside of the root', async () => {
        assert.isTrue(
            await runTests({
                files: [
                    'dynamic-pixi.test.ts',
                    'static-pixi.test.ts',
                ],
                plugins: [
                    pixiPlugin(),
                ],
                rootDir: testFilesDirPath,
            }),
        );
    });
    it('fails if the pixiPath has not been set', () => {
        const plugin = new PixiPlugin();

        assert.throws(
            () => {
                return plugin.resolveImport({
                    source: 'pixi.js',
                });
            },
            {
                matchMessage: 'pixiPath not set',
            },
        );
        plugin.resolveImport({
            source: 'something-else',
        });
    });
});
