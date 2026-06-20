import {nav, navAttribute, type NavController, NavValue} from 'device-navigation';
import {css, defineElement, html} from 'element-vir';
import {noNativeFormStyles} from 'vira';

export const GameButton = defineElement<{
    text: string;
    navController: NavController;
}>()({
    tagName: 'game-button',
    styles: css`
        button {
            ${noNativeFormStyles}
            background-color: lime;
        }

        ${navAttribute.css({
            navValue: NavValue.Focused,
        })} {
            background-color: yellow;
        }
    `,
    render({inputs}) {
        return html`
            <button ${nav(inputs.navController)}>${inputs.text}</button>
        `;
    },
});
