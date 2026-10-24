import {html} from 'element-vir';
import {ViraIcon} from 'vira';
import {findMatchingGamepadModel, getGamepadInputIcons, KnownInput} from '../index.js';

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
