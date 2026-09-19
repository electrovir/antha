import {assertWrap} from '@augment-vir/assert';
import {
    type Dimensions,
    type PartialWithUndefined,
    type RequireAtLeastOne,
} from '@augment-vir/common';

/**
 * The logical dimensions and scale of a virtual viewport.
 *
 * @category Internal
 */
export type VirtualViewport = Dimensions & {
    scale: number;
};

/**
 * The dimensions of a virtual viewport without its scale.
 *
 * @category Internal
 */
export type VirtualViewportSize = Pick<VirtualViewport, 'height' | 'width'>;

/**
 * State shared by mods that use a virtual viewport.
 *
 * @category Internal
 */
export type AnthaVirtualViewportState = {
    virtualViewport: VirtualViewport | undefined;
};

/**
 * Logical viewport configuration.
 *
 * @category Internal
 */
export type AnthaVirtualViewportOptions = RequireAtLeastOne<{
    virtualHeight: number;
    virtualWidth: number;
}>;

/**
 * Calculates the logical viewport for a physical screen size.
 *
 * @category Internal
 */
export function calculateVirtualViewport({
    screenSize,
    virtualHeight,
    virtualWidth,
}: Readonly<
    PartialWithUndefined<AnthaVirtualViewportOptions> & {
        screenSize: Readonly<VirtualViewportSize>;
    }
>) {
    if (
        !screenSize.height ||
        !screenSize.width ||
        virtualHeight === 0 ||
        virtualWidth === 0 ||
        (virtualHeight == undefined && virtualWidth == undefined)
    ) {
        return undefined;
    } else if (virtualHeight == undefined) {
        const definedVirtualWidth = assertWrap.isDefined(virtualWidth);
        const scale = screenSize.width / definedVirtualWidth;

        return {
            height: screenSize.height / scale,
            scale,
            width: definedVirtualWidth,
        };
    } else if (virtualWidth == undefined) {
        const scale = screenSize.height / virtualHeight;

        return {
            height: virtualHeight,
            scale,
            width: screenSize.width / scale,
        };
    } else {
        const scale = Math.min(screenSize.height / virtualHeight, screenSize.width / virtualWidth);

        return {
            height: virtualHeight,
            scale,
            width: virtualWidth,
        };
    }
}
