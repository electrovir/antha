import {type PartialWithUndefined} from '@augment-vir/common';
import {type SystemVersions} from './system-versions.js';

/**
 * A mapping of gamepad button and axe numbers to their names. Mappings depend on the current system
 * and gamepad model (so those are included as well).
 *
 * @category Types
 */
export type GamepadLayout = {
    /**
     * The list of supported gamepad models for this layout. These are _mapped_ model names, not the
     * raw device names or gamepad ids directly from the browser.
     */
    gamepadModels: string[];
    systemVersions: SystemVersions[];
    inputMappings: Record<string, string>;
    notes?:
        | PartialWithUndefined<{
              /**
               * A simple note with an explanation that does not significantly impact the gamepad's
               * performance.
               */
              info: string;
              /**
               * An important note that explains why the gamepad does not work or why it has has
               * major issues.
               */
              warning: string;
          }>
        | undefined;
};
