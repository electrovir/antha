import {type GamepadLayout, type PredefinedGamepadModel} from '../index.js';

export type GamepadOverrides = Readonly<{
    gamepadTypes: Readonly<{[deviceName: string]: PredefinedGamepadModel}>;
    gamepadLayouts: ReadonlyArray<Readonly<GamepadLayout>>;
}>;
