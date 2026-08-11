import {defineConfig} from '@virmator/frontend/configs/vite.config.base.js';
import {join, resolve} from 'node:path';

export default defineConfig(
    {
        forGitHubPages: true,
        packageDirPath: resolve(import.meta.dirname, '..'),
    },
    (baseConfig, basePaths) => {
        return {
            ...baseConfig,
            build: {
                ...baseConfig.build,
                outDir: join(basePaths.cwd, 'dist'),
            },
        };
    },
);
