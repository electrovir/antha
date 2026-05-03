import {defineConfig} from '@virmator/frontend/configs/vite.config.base.js';
import basicSsl from '@vitejs/plugin-basic-ssl';
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
            plugins: [
                ...(baseConfig.plugins || []),
                /**
                 * So that we can use web functionalities that require HTTPS, like crypto, over LAN
                 * connections.
                 */
                basicSsl(),
            ],
        };
    },
);
