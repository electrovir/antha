import {defineConfig} from '@virmator/frontend/configs/vite.config.base.js';
import {join, resolve} from 'node:path';

export default defineConfig(
    {
        forGitHubPages: true,
        packageDirPath: resolve(import.meta.dirname, '..'),
    },
    (baseConfig) => {
        return {
            ...baseConfig,
            base: process.env.CI ? join(baseConfig.base || '', 'demo') : baseConfig.base,
        };
    },
);
