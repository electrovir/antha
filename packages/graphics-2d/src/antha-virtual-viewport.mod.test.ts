import {AnthaEngine} from '@antha/engine';
import {assert, assertWrap} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {
    calculateVirtualViewport,
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
    it('uses the same logical dimensions at 1440p and 720p', () => {
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
                hostElement.style.transformOrigin.includes('top'),
                hostElement.style.transformOrigin.includes('left'),
                hostElement.style.width,
            ],
            [
                {
                    height: 1440,
                    scale: 0.5,
                    width: 2560,
                },
                '200%',
                'scale(0.5)',
                true,
                true,
                '200%',
            ],
        );

        await engine.reset();

        assert.deepEquals(
            [
                engine.state.virtualViewport,
                hostElement.style.height,
                hostElement.style.transform,
                hostElement.style.transformOrigin,
                hostElement.style.width,
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

        hostElement.style.transform = 'scale(10)';

        await engine.runSingleTick();

        assert.deepEquals(
            [
                pixiApplication.renderer.resolution,
                hostElement.style.transform,
            ],
            [
                (globalThis.devicePixelRatio || 1) * 0.5,
                'scale(0.5)',
            ],
        );
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
