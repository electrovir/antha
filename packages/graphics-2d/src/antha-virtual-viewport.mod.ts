import {
    calculateVirtualViewport,
    type AnthaVirtualViewportOptions,
    type AnthaVirtualViewportState,
    type VirtualViewport,
    type VirtualViewportSize,
} from '@antha/asset';
import {defineAnthaMod} from '@antha/engine';
import {type AnthaGraphics2dModState} from './antha-graphics-2d.mod.js';

/**
 * Re-exported from {@link @antha/asset!VirtualViewport}.
 *
 * @category Internal
 */
export type {
    AnthaVirtualViewportOptions,
    AnthaVirtualViewportState,
    VirtualViewport,
    VirtualViewportSize,
} from '@antha/asset';

/**
 * State added by {@link createAnthaVirtualViewportMod}.
 *
 * @category Internal
 */
export type AnthaVirtualViewportModState = AnthaGraphics2dModState & AnthaVirtualViewportState;

/**
 * Maps a pointer position from canvas coordinates into a virtual viewport.
 *
 * @category Util
 */
export function calculateVirtualViewportPoint({
    canvasBounds,
    clientPoint,
    virtualViewport,
}: Readonly<{
    canvasBounds: Readonly<{
        height: number;
        left: number;
        top: number;
        width: number;
    }>;
    clientPoint: Readonly<{
        x: number;
        y: number;
    }>;
    virtualViewport: Readonly<VirtualViewportSize>;
}>) {
    if (!canvasBounds.width || !canvasBounds.height) {
        return undefined;
    }

    return {
        x: ((clientPoint.x - canvasBounds.left) / canvasBounds.width) * virtualViewport.width,
        y: ((clientPoint.y - canvasBounds.top) / canvasBounds.height) * virtualViewport.height,
    };
}

/**
 * Creates Pixi options that preserve visual density when a virtual viewport is scaled.
 *
 * @category Util
 */
export function createVirtualViewportPixiOptions() {
    return {
        autoDensity: true,
        resolution: globalThis.devicePixelRatio || 1,
    };
}

function hasSameVirtualViewport({
    previousVirtualViewport,
    virtualViewport,
}: Readonly<{
    previousVirtualViewport: VirtualViewport | undefined;
    virtualViewport: VirtualViewport;
}>) {
    return (
        previousVirtualViewport != undefined &&
        Math.abs(previousVirtualViewport.height - virtualViewport.height) < 0.01 &&
        Math.abs(previousVirtualViewport.scale - virtualViewport.scale) < 0.0001 &&
        previousVirtualViewport.width === virtualViewport.width
    );
}

function updateVirtualViewportHostElement({
    hostElement,
    isFixedViewport,
    screenSize,
    virtualViewport,
}: Readonly<{
    hostElement: HTMLElement;
    isFixedViewport: boolean;
    screenSize: Readonly<VirtualViewportSize>;
    virtualViewport: VirtualViewport;
}>) {
    hostElement.style.height = isFixedViewport
        ? `${virtualViewport.height}px`
        : `${100 / virtualViewport.scale}%`;
    hostElement.style.transform = getVirtualViewportHostTransform({
        isFixedViewport,
        screenSize,
        virtualViewport,
    });
    hostElement.style.transformOrigin = 'top left';
    hostElement.style.width = isFixedViewport
        ? `${virtualViewport.width}px`
        : `${100 / virtualViewport.scale}%`;
}

function getVirtualViewportHostTransform({
    isFixedViewport,
    screenSize,
    virtualViewport,
}: Readonly<{
    isFixedViewport: boolean;
    screenSize: Readonly<VirtualViewportSize>;
    virtualViewport: VirtualViewport;
}>) {
    const horizontalOffset = isFixedViewport
        ? (screenSize.width - virtualViewport.width * virtualViewport.scale) / 2
        : 0;
    const verticalOffset = isFixedViewport
        ? (screenSize.height - virtualViewport.height * virtualViewport.scale) / 2
        : 0;

    return isFixedViewport
        ? `translate(${horizontalOffset}px, ${verticalOffset}px) scale(${virtualViewport.scale})`
        : `scale(${virtualViewport.scale})`;
}

function getVirtualViewportScreenSize({
    hostElement,
    isFixedViewport,
}: Readonly<{
    hostElement: HTMLElement;
    isFixedViewport: boolean;
}>) {
    if (!isFixedViewport) {
        return hostElement.getBoundingClientRect();
    }

    const rootNode = hostElement.getRootNode();
    const viewportContainer =
        rootNode instanceof ShadowRoot ? rootNode.host : hostElement.parentElement || hostElement;

    return viewportContainer.getBoundingClientRect();
}

function resetVirtualViewportHostElement({
    hostElement,
}: Readonly<{
    hostElement: HTMLElement;
}>) {
    hostElement.style.removeProperty('height');
    hostElement.style.removeProperty('transform');
    hostElement.style.removeProperty('transform-origin');
    hostElement.style.removeProperty('width');
}

/**
 * A pre-built mod that scales an Antha UI and Pixi canvas to a logical viewport.
 *
 * @category Pre-Built Mods
 */
export function createAnthaVirtualViewportMod({
    virtualHeight,
    virtualWidth,
}: Readonly<AnthaVirtualViewportOptions>) {
    const isFixedViewport = !!virtualHeight && !!virtualWidth;

    return defineAnthaMod<AnthaVirtualViewportModState>({
        modName: 'antha-virtual-viewport',
        cleanup({hostElement, state}) {
            resetVirtualViewportHostElement({
                hostElement,
            });
            state.virtualViewport = undefined;
        },
        execute({hostElement, state}) {
            const screenSize = getVirtualViewportScreenSize({
                hostElement,
                isFixedViewport,
            });
            const virtualViewport = calculateVirtualViewport({
                screenSize,
                virtualHeight,
                virtualWidth,
            });

            if (!virtualViewport) {
                return;
            }

            const hasViewportChanged =
                !hasSameVirtualViewport({
                    previousVirtualViewport: state.virtualViewport,
                    virtualViewport,
                }) ||
                hostElement.style.transform !==
                    getVirtualViewportHostTransform({
                        isFixedViewport,
                        screenSize,
                        virtualViewport,
                    });

            if (hasViewportChanged) {
                updateVirtualViewportHostElement({
                    hostElement,
                    isFixedViewport,
                    screenSize,
                    virtualViewport,
                });
                state.virtualViewport = virtualViewport;
            }

            const pixiApplication = state.pixi?.pixiApplication;

            if (
                !pixiApplication ||
                (!hasViewportChanged &&
                    pixiApplication.renderer.resolution ===
                        (globalThis.devicePixelRatio || 1) * virtualViewport.scale &&
                    pixiApplication.stage.scale.x === 1 &&
                    pixiApplication.stage.scale.y === 1)
            ) {
                return;
            }

            pixiApplication.renderer.resolution =
                (globalThis.devicePixelRatio || 1) * virtualViewport.scale;
            pixiApplication.resize();
            pixiApplication.stage.scale.set(1);
        },
    });
}
