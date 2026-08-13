import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {createEmptyGamepadLayout} from './create.js';
import {PredefinedGamepadModel} from './gamepad-model.js';

describe(createEmptyGamepadLayout.name, () => {
    it('creates a layout with the matching gamepad model', () => {
        const layout = createEmptyGamepadLayout({
            deviceName: 'Pro Controller Extended Gamepad',
        });

        assert.deepEquals(layout.gamepadModels, [PredefinedGamepadModel.SwitchPro]);
        assert.deepEquals(layout.inputMappings, {});
        assert.isLengthExactly(layout.systemVersions, 1);
        assert.isUndefined(layout.notes);
    });

    it('creates a layout without a model for an unknown gamepad', () => {
        const layout = createEmptyGamepadLayout({
            deviceName: 'unknown gamepad',
        });

        assert.deepEquals(layout.gamepadModels, []);
        assert.deepEquals(layout.inputMappings, {});
        assert.isLengthExactly(layout.systemVersions, 1);
        assert.isUndefined(layout.notes);
    });
});
