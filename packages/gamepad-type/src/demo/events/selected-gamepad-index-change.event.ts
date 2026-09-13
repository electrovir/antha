import {defineTypedCustomEvent} from 'element-vir';

export const SelectedGamepadIndexChange = defineTypedCustomEvent<number>()(
    'selected-gamepad-index-change',
);
