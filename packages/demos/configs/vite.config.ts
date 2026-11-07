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
            /** The threaded Box2D build in `box2d3-wasm` starts its threads from ES module workers. */
            worker: {
                ...baseConfig.worker,
                format: 'es',
                /**
                 * WebKit loads a worker's chunk imports without the cross-origin isolation service
                 * worker, so they lack its headers and get blocked.
                 */
                rolldownOptions: {
                    output: {
                        codeSplitting: false,
                    },
                },
            },
            plugins: [
                ...(baseConfig.plugins || []),
                {
                    name: 'cross-origin-isolation-headers',
                    configureServer(server) {
                        /**
                         * Vite drops `server.headers` from its 304 responses, and WebKit then
                         * blocks Box2D's thread workers on reload. Setting them before Vite runs
                         * keeps them on every response.
                         */
                        server.middlewares.use((request, response, next) => {
                            response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
                            response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
                            next();
                        });
                    },
                },
            ],
        };
    },
);
