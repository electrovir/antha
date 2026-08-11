import {type GamepadDevice} from 'input-device-handler';
import {findMatchingGamepadModel} from './find-matches.js';
import {type GamepadLayout} from './gamepad-layout.js';
import {type GamepadModelMap} from './gamepad-model.js';
import {getSystemVersions} from './system-versions.js';

/**
 * Creates an empty layout as a starting point for building a new one. Includes the correct system
 * versions already.
 *
 * @category Util
 */
export function createEmptyGamepadLayout(
    gamepad: Readonly<Pick<GamepadDevice, 'deviceName'>>,
    gamepadModelMap?: GamepadModelMap | undefined,
): GamepadLayout {
    const {gamepadModel} = findMatchingGamepadModel({
        gamepad: gamepad.deviceName,
        gamepadModelMap,
    });

    return {
        inputMappings: {},
        gamepadModels: gamepadModel ? [gamepadModel] : [],
        systemVersions: [getSystemVersions()],
        notes: undefined,
    };
}
