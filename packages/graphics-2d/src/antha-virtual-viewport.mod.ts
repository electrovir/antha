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

/**
 * CSS `zoom` is used rather than `transform: scale()` so the browser lays out and draws text at its
 * final size instead of scaling an already drawn layer, which blurs it.
 */
function createVirtualViewportHostStyles({
    isFixedViewport,
    screenSize,
    virtualViewport,
}: Readonly<{
    isFixedViewport: boolean;
    screenSize: Readonly<VirtualViewportSize>;
    virtualViewport: VirtualViewport;
}>) {
    /** Percentages aren't affected by `zoom`, but pixel lengths (including this translate) are. */
    const horizontalOffset = Math.round(
        (screenSize.width - virtualViewport.width * virtualViewport.scale) / 2,
    );
    const verticalOffset = Math.round(
        (screenSize.height - virtualViewport.height * virtualViewport.scale) / 2,
    );

    return {
        height: isFixedViewport ? `${virtualViewport.height}px` : '100%',
        transform: isFixedViewport
            ? `translate(${horizontalOffset / virtualViewport.scale}px, ${verticalOffset / virtualViewport.scale}px)`
            : '',
        width: isFixedViewport ? `${virtualViewport.width}px` : '100%',
        zoom: String(virtualViewport.scale),
    };
}

function readVirtualViewportHostStyles(hostElement: HTMLElement) {
    return [
        hostElement.style.height,
        hostElement.style.transform,
        hostElement.style.width,
        hostElement.style.zoom,
    ].join(';');
}

/**
 * The browser rounds style values when it stores them (a zoom of `1 / 3` reads back as
 * `'0.333333'`), so the host's styles can't be compared to freshly created ones. Instead, this
 * keeps the created styles alongside what the browser read back after applying them.
 */
const appliedHostStyles = new WeakMap<
    HTMLElement,
    {
        createdStyles: string;
        readStyles: string;
    }
>();

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
    hostElement.style.removeProperty('width');
    hostElement.style.removeProperty('zoom');
    appliedHostStyles.delete(hostElement);
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

            const hostStyles = createVirtualViewportHostStyles({
                isFixedViewport,
                screenSize,
                virtualViewport,
            });
            const hasViewportChanged =
                !hasSameVirtualViewport({
                    previousVirtualViewport: state.virtualViewport,
                    virtualViewport,
                }) ||
                appliedHostStyles.get(hostElement)?.createdStyles !== JSON.stringify(hostStyles) ||
                appliedHostStyles.get(hostElement)?.readStyles !==
                    readVirtualViewportHostStyles(hostElement);

            if (hasViewportChanged) {
                Object.assign(hostElement.style, hostStyles);
                appliedHostStyles.set(hostElement, {
                    createdStyles: JSON.stringify(hostStyles),
                    readStyles: readVirtualViewportHostStyles(hostElement),
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
