# @antha/gamepad-type

Determine gamepad models, brands, and layouts based on the user operating system.

Detects the following per gamepad:

-   gamepad model
-   gamepad brand
-   gamepad input names

based on hardcoded, pre-collected data. You are also able to define new values for each in case any data is missing.

If you notice incorrect mappings, please enter updated information [on the demo page](https://antha-engine.github.io/gamepad/). Every browser, browser version, operating system, and operating system version combination produces different values so it's impossible for me to single-handedly account for them all.

It is encouraged that you use the package [`input-device-handler`](https://www.npmjs.com/package/input-device-handler) in conjunction with this one, but it is not required.

-   [demo page](https://antha-engine.github.io/gamepad/) (allows submitting gamepad mapping fixes)
-   [full API docs](https://electrovir.github.io/antha/docs)

# install

```sh
npm i @antha/gamepad-type
```

# usage

The primary exports of this package are the following:

-   [`findMatchingGamepadModel`](https://electrovir.github.io/antha/docs): given the system-level gamepad id, determines the gamepad's model and brand. Also includes a model description string. Allows custom model and brand map inputs to handle edge cases that this package doesn't cover. (If you find those edge cases, please either [open a ticket in the GitHub repo](https://github.com/electrovir/gamepad-type/issues/new) or submit your fixed data on [the demo page](https://antha-engine.github.io/gamepad/).)
-   [`findMatchingGamepadLayout`](https://electrovir.github.io/antha/docs): given the system-level gamepad id, determines the gamepad's button and axe names (based on gamepad model and user operating system). Allows custom model and input map inputs to handle edge cases that this package doesn't cover. (If you find those edge cases please either [open a ticket in the GitHub repo](https://github.com/electrovir/gamepad-type/issues/new) or submit your fixed data on [the demo page](https://antha-engine.github.io/gamepad/).)

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

-   `getGamepadInputIcons`

    <!-- example-link: src/readme-examples/getting-icons.example.ts -->

    ```TypeScript
    import {html} from 'element-vir';
    import {ViraIcon} from 'vira';
    import {findMatchingGamepadModel, getGamepadInputIcons, KnownInput} from '@antha/gamepad-type';

    const {gamepadBrand, gamepadModel} = findMatchingGamepadModel({
        gamepad: window.navigator.getGamepads()[0]?.id,
    });

    /** The first icon is the default. Empty when the gamepad lacks this input. */
    const [acceptIcon] = getGamepadInputIcons({
        gamepadBrand,
        gamepadModel,
        input: KnownInput.FaceAccept,
    });

    const template = html`
        <${ViraIcon.assign({
            icon: acceptIcon,
        })}></${ViraIcon}>
    `;
    ```

## icons

Every gamepad input in `KnownInput` has [Vira](https://www.npmjs.com/package/vira) icons for each supported gamepad, so you can show players the button they actually need to press. (This makes `element-vir` and `vira` peer dependencies.) The icons come from [Kenney Input Prompts](https://kenney.nl/assets/input-prompts) (CC0), restyled to stay readable on any background.

-   `getGamepadInputIcons`: given the gamepad model and brand from `findMatchingGamepadModel`, returns the icons for an input. Unknown models fall back to their brand's newest model, and unknown brands fall back to Xbox icons.
-   `getGamepadStickIcon`: same as `getGamepadInputIcons` but returns the single icon for one `InputDirection` of a stick axis, like left stick up.
-   `gamepadIconSetInputIcons`: every icon for each `GamepadIconSet` (Xbox, PlayStation, Nintendo Switch, Steam Deck, etc.), if you want to pick the icon set yourself.
-   `keyboardInputIcons` and `mouseInputIcons`: icons for the keyboard and mouse input names that `input-device-handler` creates.

## predefined mappings

You can access all predefined mappings and values with the following exported values:

-   `PredefinedGamepadModel`: an enum of known gamepad models.
-   `PredefinedGamepadBrand`: an enum of known gamepad brands.
-   `predefinedGamepadModelDescriptions`: a map of `PredefinedGamepadModel` to description strings.
-   `defaultGamepadModelMap`: a map of known gamepad ids / names to their known gamepad models.
-   `defaultGamepadBrandMap`: a map of known gamepad models to their known gamepad brands.
-   `defaultGamepadLayouts`: an array of all known gamepad layouts.
