import {InputDeviceHandler} from 'input-device-handler';
import {findMatchingGamepadModel} from '../index.js';

// using window.navigator directly
{
    const {gamepadBrand, gamepadModel, gamepadModelDescription} = findMatchingGamepadModel({
        gamepad: window.navigator.getGamepads()[0]?.id,
    });
}

// using InputDeviceHandler
{
    const deviceHandler = new InputDeviceHandler();

    const {gamepadBrand, gamepadModel, gamepadModelDescription} = findMatchingGamepadModel({
        gamepad: deviceHandler.readAllDevices()[0],
    });
}
