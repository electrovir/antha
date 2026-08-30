import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {InputDeviceKey} from 'input-device-handler';
import {checkValidShape} from 'object-shape-tester';
import {InputDirection} from '../raw-inputs/raw-input.js';
import {filterToAllowedActions, playersBindingAssignmentsShape} from './player-bindings.js';

const testBindingAssignment = {
    deviceKey: InputDeviceKey.Keyboard,
    direction: InputDirection.Positive,
    inputName: 'button-Space',
};

describe('playersBindingAssignmentsShape', () => {
    it('accepts valid assignments', () => {
        assert.isTrue(
            checkValidShape(
                {
                    '1': {
                        jump: [
                            {
                                deviceKey: InputDeviceKey.Keyboard,
                                direction: InputDirection.Positive,
                                inputName: 'button-Space',
                            },
                        ],
                    },
                },
                playersBindingAssignmentsShape,
            ),
        );
    });

    it('rejects invalid assignments', () => {
        assert.isFalse(
            checkValidShape(
                {
                    '1': {
                        customAction: [
                            {
                                deviceKey: InputDeviceKey.Keyboard,
                                direction: InputDirection.Positive,
                                inputName: '',
                            },
                        ],
                    },
                },
                playersBindingAssignmentsShape,
            ),
        );
    });
});

describe(filterToAllowedActions.name, () => {
    it('removes assignments for unsupported binding names', () => {
        assert.deepEquals(
            filterToAllowedActions({
                allowedBindingNames: [
                    'jump',
                ],
                bindingAssignments: {
                    '1': {
                        jump: [testBindingAssignment],
                        unsupportedAction: [testBindingAssignment],
                    },
                },
            }),
            {
                '1': {
                    jump: [testBindingAssignment],
                },
            },
        );
    });
});
