# @antha/gamepad-type

Determine gamepad models, brands, and layouts based on the user operating system.

Detects the following per gamepad:

-   gamepad model
-   gamepad brand
-   gamepad input names

based on hardcoded, pre-collected data. You are also able to define new values for each in case any data is missing.

If you notice incorrect mappings, please [open an issue](https://github.com/electrovir/gamepad-type/issues/new). Every browser, browser version, operating system, and operating system version combination produces different values so it's impossible for me to single-handedly account for them all.

It is encouraged that you use the package [`input-device-handler`](https://www.npmjs.com/package/input-device-handler) in conjunction with this one, but it is not required.

-   [demo page](https://electrovir.github.io/gamepad-type) (allows submitting gamepad mapping fixes)
-   [full API docs](https://electrovir.github.io/gamepad-type/docs)
-   [GitHub repo](https://github.com/electrovir/gamepad-type) (please open issues for gamepad mapping updates)
-   [npm package](https://www.npmjs.com/package/gamepad-type)

# install

```sh
npm i @antha/gamepad-type
```

# usage

The primary exports of this package are the following:

-   [`findMatchingGamepadModel`](https://electrovir.github.io/gamepad-type/functions/findMatchingGamepadModel.html): given the system-level gamepad id, determines the gamepad's model and brand. Also includes a model description string. Allows custom model and brand map inputs to handle edge cases that this package doesn't cover. (If you find those edge cases, please [open a ticket in the GitHub repo](https://github.com/electrovir/gamepad-type/issues/new).)
-   [`findMatchingGamepadLayout`](https://electrovir.github.io/gamepad-type/functions/findMatchingGamepadLayout.html): given the system-level gamepad id, determines the gamepad's button and axe names (based on gamepad model and user operating system). Allows custom model and input map inputs to handle edge cases that this package doesn't cover. (If you find those edge cases, please [open a ticket in the GitHub repo](https://github.com/electrovir/gamepad-type/issues/new).)

## examples

-   `findMatchingGamepadModel`

    <!-- example-link: src/readme-examples/getting-model.example.ts -->

    ```TypeScript
    import {InputDeviceHandler} from 'input-device-handler';
    import {findMatchingGamepadModel} from '@antha/gamepad-type';

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
    ```

-   `findMatchingGamepadLayout`

    <!-- example-link: src/readme-examples/getting-layout.example.ts -->

    ```TypeScript
    import {InputDeviceHandler} from 'input-device-handler';
    import {findMatchingGamepadLayout} from '@antha/gamepad-type';

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
    ```

## predefined mappings

You can access all predefined mappings and values with the following exported values:

-   `PredefinedGamepadModel`: an enum of known gamepad models.
-   `PredefinedGamepadBrand`: an enum of known gamepad brands.
-   `predefinedGamepadModelDescriptions`: a map of `PredefinedGamepadModel` to description strings.
-   `defaultGamepadModelMap`: a map of known gamepad ids / names to their known gamepad models.
-   `defaultGamepadBrandMap`: a map of known gamepad models to their known gamepad brands.
-   `defaultGamepadLayouts`: an array of all known gamepad layouts.
