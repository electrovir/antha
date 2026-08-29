import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {InputDeviceKey} from 'input-device-handler';
import {checkValidShape} from 'object-shape-tester';
import {InputDirection} from '../raw-inputs/raw-input.js';
import {playersBindingAssignmentsShape} from './player-bindings.js';

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
