import {defineTypedEvent} from 'element-vir';

export const SelectedGamepadIndexChange = defineTypedEvent<number>()(
    'selected-gamepad-index-change',
);
