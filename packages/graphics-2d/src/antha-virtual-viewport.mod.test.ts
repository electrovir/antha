import {calculateVirtualViewport} from '@antha/asset';
import {AnthaEngine} from '@antha/engine';
import {assert, assertWrap} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {
    calculateVirtualViewportPoint,
    createAnthaVirtualViewportMod,
    createVirtualViewportPixiOptions,
    type AnthaVirtualViewportModState,
} from './antha-virtual-viewport.mod.js';
import {createMockPixi} from './mock-pixi.js';

function createHostElement({
    height,
    width,
}: Readonly<{
    height: number;
    width: number;
}>) {
    const hostElement = document.createElement('div');
    hostElement.getBoundingClientRect = () => {
        return new DOMRect(0, 0, width, height);
    };

    return hostElement;
}

describe(calculateVirtualViewport.name, () => {
    it('preserves width-constrained viewport dimensions at 1440p and 720p', () => {
        assert.deepEquals(
            [
                calculateVirtualViewport({
                    screenSize: {
                        height: 1440,
                        width: 2560,
                    },
                    virtualWidth: 2560,
                }),
                calculateVirtualViewport({
                    screenSize: {
                        height: 720,
                        width: 1280,
                    },
                    virtualWidth: 2560,
                }),
            ],
            [
                {
                    height: 1440,
                    scale: 1,
                    width: 2560,
                },
                {
                    height: 1440,
                    scale: 0.5,
                    width: 2560,
                },
            ],
        );
    });

    it('derives a width from a height-constrained viewport', () => {
        assert.deepEquals(
            calculateVirtualViewport({
                screenSize: {
                    height: 720,
                    width: 1280,
                },
                virtualHeight: 1440,
            }),
            {
                height: 1440,
                scale: 0.5,
                width: 2560,
            },
        );
    });

    it('keeps both fixed viewport dimensions while containing them', () => {
        assert.deepEquals(
            [
                calculateVirtualViewport({
                    screenSize: {
                        height: 900,
                        width: 1200,
                    },
                    virtualHeight: 1080,
                    virtualWidth: 1920,
                }),
                calculateVirtualViewport({
                    screenSize: {
                        height: 960,
                        width: 1920,
                    },
                    virtualHeight: 1080,
                    virtualWidth: 1920,
                }),
            ],
            [
                {
                    height: 1080,
                    scale: 0.625,
                    width: 1920,
                },
                {
                    height: 1080,
                    scale: 8 / 9,
                    width: 1920,
                },
            ],
        );
    });

    it('maps pointers into logical coordinates and waits for a canvas with width', () => {
        const virtualViewport = calculateVirtualViewport({
            screenSize: {
                height: 720,
                width: 1280,
            },
            virtualWidth: 2560,
        });

        assert.deepEquals(
            [
                calculateVirtualViewportPoint({
                    canvasBounds: {
                        height: 720,
                        left: 100,
                        top: 50,
                        width: 1280,
                    },
                    clientPoint: {
                        x: 740,
                        y: 410,
                    },
                    virtualViewport: assertWrap.isDefined(virtualViewport),
                }),
                calculateVirtualViewport({
                    screenSize: {
                        height: 0,
                        width: 0,
                    },
                    virtualWidth: 2560,
                }),
            ],
            [
                {
                    x: 1280,
                    y: 720,
                },
                undefined,
            ],
        );
    });

    it('waits for usable viewport and canvas dimensions', () => {
        assert.deepEquals(
            [
                calculateVirtualViewport({
                    screenSize: {
                        height: 720,
                        width: 1280,
                    },
                    virtualWidth: 0,
                }),
                calculateVirtualViewportPoint({
                    canvasBounds: {
                        height: 720,
                        left: 0,
                        top: 0,
                        width: 0,
                    },
                    clientPoint: {
                        x: 0,
                        y: 0,
                    },
                    virtualViewport: {
                        height: 720,
                        width: 1280,
                    },
                }),
                calculateVirtualViewportPoint({
                    canvasBounds: {
                        height: 0,
                        left: 0,
                        top: 0,
                        width: 1280,
                    },
                    clientPoint: {
                        x: 0,
                        y: 0,
                    },
                    virtualViewport: {
                        height: 720,
                        width: 1280,
                    },
                }),
            ],
            [
                undefined,
                undefined,
                undefined,
            ],
        );
    });

    it('creates Pixi options for the current pixel density', () => {
        assert.deepEquals(createVirtualViewportPixiOptions(), {
            autoDensity: true,
            resolution: globalThis.devicePixelRatio || 1,
        });
    });
});

describe(createAnthaVirtualViewportMod.name, () => {
    it('scales and resets its host element', async () => {
        const hostElement = createHostElement({
            height: 720,
            width: 1280,
        });
        const engine = new AnthaEngine<AnthaVirtualViewportModState>({
            hostElement,
            mods: [
                createAnthaVirtualViewportMod({
                    virtualWidth: 2560,
                }),
            ],
        });

        await engine.runSingleTick();

        assert.deepEquals(
            [
                engine.state.virtualViewport,
                hostElement.style.height,
                hostElement.style.transform,
                hostElement.style.width,
                hostElement.style.zoom,
            ],
            [
                {
                    height: 1440,
                    scale: 0.5,
                    width: 2560,
                },
                '100%',
                '',
                '100%',
                '0.5',
            ],
        );

        await engine.reset();

        assert.deepEquals(
            [
                engine.state.virtualViewport,
                hostElement.style.height,
                hostElement.style.transform,
                hostElement.style.width,
                hostElement.style.zoom,
            ],
            [
                undefined,
                '',
                '',
                '',
                '',
            ],
        );
    });

    it('centers a fixed virtual viewport within its container', async () => {
        const viewportContainer = document.createElement('div');
        viewportContainer.style.height = '960px';
        viewportContainer.style.overflow = 'hidden';
        viewportContainer.style.width = '1280px';
        const hostElement = document.createElement('div');
        viewportContainer.append(hostElement);
        document.body.append(viewportContainer);
        const engine = new AnthaEngine<AnthaVirtualViewportModState>({
            hostElement,
            mods: [
                createAnthaVirtualViewportMod({
                    virtualHeight: 1440,
                    virtualWidth: 2560,
                }),
            ],
        });

        try {
            await engine.runSingleTick();

            const containerBounds = viewportContainer.getBoundingClientRect();
            const hostBounds = hostElement.getBoundingClientRect();

            assert.deepEquals(
                {
                    height: hostBounds.height,
                    width: hostBounds.width,
                    x: hostBounds.x - containerBounds.x,
                    y: hostBounds.y - containerBounds.y,
                },
                {
                    height: 720,
                    width: 1280,
                    x: 0,
                    y: 120,
                },
            );

            await engine.reset();

            assert.deepEquals(
                {
                    height: hostElement.style.height,
                    transform: hostElement.style.transform,
                    width: hostElement.style.width,
                    zoom: hostElement.style.zoom,
                },
                {
                    height: '',
                    transform: '',
                    width: '',
                    zoom: '',
                },
            );
        } finally {
            viewportContainer.remove();
        }
    });

    it('uses a shadow-root host to size a fixed virtual viewport', async () => {
        const viewportContainer = createHostElement({
            height: 960,
            width: 1280,
        });
        const shadowRoot = viewportContainer.attachShadow({
            mode: 'open',
        });
        const hostElement = document.createElement('div');
        shadowRoot.append(hostElement);
        document.body.append(viewportContainer);
        const engine = new AnthaEngine<AnthaVirtualViewportModState>({
            hostElement,
            mods: [
                createAnthaVirtualViewportMod({
                    virtualHeight: 1440,
                    virtualWidth: 2560,
                }),
            ],
        });

        try {
            await engine.runSingleTick();

            assert.deepEquals(
                {
                    transform: hostElement.style.transform,
                    virtualViewport: engine.state.virtualViewport,
                },
                {
                    transform: 'translate(0px, 240px)',
                    virtualViewport: {
                        height: 1440,
                        scale: 0.5,
                        width: 2560,
                    },
                },
            );
        } finally {
            viewportContainer.remove();
        }
    });

    it('updates Pixi only when its virtual viewport needs synchronization', async () => {
        const hostElement = createHostElement({
            height: 720,
            width: 1280,
        });
        const pixiApplication = Object.assign(createMockPixi(), {
            renderer: {
                resolution: 1,
            },
            resize() {},
        });
        pixiApplication.stage.scale.set(2);
        const engine = new AnthaEngine<AnthaVirtualViewportModState>({
            hostElement,
            mods: [
                createAnthaVirtualViewportMod({
                    virtualWidth: 2560,
                }),
            ],
        });
        engine.state.pixi = {
            pixiApplication,
        };

        await engine.runSingleTick();

        assert.deepEquals(
            [
                pixiApplication.renderer.resolution,
                pixiApplication.stage.scale.x,
                pixiApplication.stage.scale.y,
            ],
            [
                (globalThis.devicePixelRatio || 1) * 0.5,
                1,
                1,
            ],
        );

        await engine.runSingleTick();

        pixiApplication.renderer.resolution = 0;

        await engine.runSingleTick();

        hostElement.style.zoom = '10';

        await engine.runSingleTick();

        assert.deepEquals(
            [
                pixiApplication.renderer.resolution,
                hostElement.style.zoom,
            ],
            [
                (globalThis.devicePixelRatio || 1) * 0.5,
                '0.5',
            ],
        );
    });

    it('does not resynchronize a scale that the browser rounds', async () => {
        const resizeCalls: undefined[] = [];
        const pixiApplication = Object.assign(createMockPixi(), {
            renderer: {
                resolution: 1,
            },
            resize() {
                resizeCalls.push(undefined);
            },
        });
        const engine = new AnthaEngine<AnthaVirtualViewportModState>({
            hostElement: createHostElement({
                height: 720,
                width: 1000,
            }),
            mods: [
                createAnthaVirtualViewportMod({
                    virtualWidth: 3000,
                }),
            ],
        });
        engine.state.pixi = {
            pixiApplication,
        };

        await engine.runSingleTick();
        await engine.runSingleTick();

        assert.isLengthExactly(resizeCalls, 1);
    });

    it('re-centers a fixed virtual viewport when only its container changes', async () => {
        const viewportContainer = document.createElement('div');
        viewportContainer.style.height = '960px';
        viewportContainer.style.width = '1280px';
        const hostElement = document.createElement('div');
        viewportContainer.append(hostElement);
        document.body.append(viewportContainer);
        const engine = new AnthaEngine<AnthaVirtualViewportModState>({
            hostElement,
            mods: [
                createAnthaVirtualViewportMod({
                    virtualHeight: 1440,
                    virtualWidth: 2560,
                }),
            ],
        });

        try {
            await engine.runSingleTick();
            viewportContainer.style.height = '1001px';
            await engine.runSingleTick();

            assert.strictEquals(hostElement.style.transform, 'translate(0px, 282px)');
        } finally {
            viewportContainer.remove();
        }
    });

    it('uses a pixel density of one when none is available', async () => {
        const devicePixelRatioDescriptor = Object.getOwnPropertyDescriptor(
            globalThis,
            'devicePixelRatio',
        );
        Object.defineProperty(globalThis, 'devicePixelRatio', {
            configurable: true,
            value: 0,
        });

        try {
            const pixiApplication = Object.assign(createMockPixi(), {
                renderer: {
                    resolution: 0,
                },
                resize() {},
            });
            const engine = new AnthaEngine<AnthaVirtualViewportModState>({
                hostElement: createHostElement({
                    height: 720,
                    width: 1280,
                }),
                mods: [
                    createAnthaVirtualViewportMod({
                        virtualWidth: 2560,
                    }),
                ],
            });
            engine.state.pixi = {
                pixiApplication,
            };

            await engine.runSingleTick();

            assert.deepEquals(
                [
                    createVirtualViewportPixiOptions(),
                    pixiApplication.renderer.resolution,
                ],
                [
                    {
                        autoDensity: true,
                        resolution: 1,
                    },
                    0.5,
                ],
            );

            await engine.runSingleTick();
        } finally {
            if (devicePixelRatioDescriptor) {
                Object.defineProperty(globalThis, 'devicePixelRatio', devicePixelRatioDescriptor);
            } else {
                Reflect.deleteProperty(globalThis, 'devicePixelRatio');
            }
        }
    });

    it('waits for a host element with width', async () => {
        const engine = new AnthaEngine<AnthaVirtualViewportModState>({
            hostElement: createHostElement({
                height: 720,
                width: 0,
            }),
            mods: [
                createAnthaVirtualViewportMod({
                    virtualWidth: 2560,
                }),
            ],
        });

        await engine.runSingleTick();

        assert.isUndefined(engine.state.virtualViewport);
    });
});
