import {InputDeviceHandler} from 'input-device-handler';
import {findMatchingGamepadLayout} from '../index.js';

// using window.navigator directly
{
    const maybeLayout = findMatchingGamepadLayout({
        gamepad: window.navigator.getGamepads()[0]?.id,
    });

    maybeLayout?.inputMappings;
}

// using InputDeviceHandler
{
    const deviceHandler = new InputDeviceHandler();

    const maybeLayout = findMatchingGamepadLayout({
        gamepad: deviceHandler.readAllDevices()[0],
    });

    maybeLayout?.inputMappings;
}
