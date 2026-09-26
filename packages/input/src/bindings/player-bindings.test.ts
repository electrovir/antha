import {LocalPlayerPosition} from '@antha/util';
import {assert} from '@augment-vir/assert';
import {selectFrom} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {InputDeviceKey} from 'input-device-handler';
import {checkValidShape} from 'object-shape-tester';
import {InputDirection} from '../raw-inputs/raw-input.js';
import {
    filterToAllowedActions,
    markBindingActed,
    playersBindingAssignmentsShape,
} from './player-bindings.js';

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
                    [LocalPlayerPosition.One]: {
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
                    [LocalPlayerPosition.One]: {
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
                    [LocalPlayerPosition.One]: {
                        jump: [testBindingAssignment],
                        unsupportedAction: [testBindingAssignment],
                    },
                },
            }),
            {
                [LocalPlayerPosition.One]: {
                    jump: [testBindingAssignment],
                },
            },
        );
    });
});

describe(markBindingActed.name, () => {
    it('marks an unused press as acted upon at its current hold duration', () => {
        const activeBinding = {
            actCount: 0,
            holdDuration: {
                milliseconds: 40,
            },
            lastActDuration: {
                milliseconds: 0,
            },
            rawInputs: [],
            value: 1,
        };

        markBindingActed(activeBinding);

        assert.deepEquals(
            selectFrom(activeBinding, {
                actCount: true,
                lastActDuration: true,
            }),
            {
                actCount: 1,
                lastActDuration: {
                    milliseconds: 40,
                },
            },
        );
    });

    it('leaves an already acted upon press alone', () => {
        const activeBinding = {
            actCount: 3,
            holdDuration: {
                milliseconds: 400,
            },
            lastActDuration: {
                milliseconds: 300,
            },
            rawInputs: [],
            value: 1,
        };

        markBindingActed(activeBinding);

        assert.deepEquals(
            selectFrom(activeBinding, {
                actCount: true,
                lastActDuration: true,
            }),
            {
                actCount: 3,
                lastActDuration: {
                    milliseconds: 300,
                },
            },
        );
    });
});
