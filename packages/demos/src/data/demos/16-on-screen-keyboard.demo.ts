import {AnthaEngine, defineAnthaMod, SkipExecution} from '@antha/engine';
import {
    AnthaKeyboard,
    createAnthaInputBindingsMod,
    createAnthaMenuNavMod,
    createAnthaReadRawInputMod,
    defaultMenuNavBindings,
    type AnthaInputBindingsModState,
    type MenuNavBinding,
    type MenuNavModState,
    type NavController,
} from '@antha/input';
import {createUtcFullDate} from 'date-vir';
import {defineElement, html} from 'element-vir';
import {type AnthaDemo} from '../demo.js';

type OnScreenKeyboardDemoModState = AnthaInputBindingsModState<MenuNavBinding> & MenuNavModState;

const Demo16OnScreenKeyboard = defineElement<{
    navController: NavController;
}>()({
    tagName: 'demo-16-on-screen-keyboard',
    render({inputs}) {
        return html`
            <${AnthaKeyboard.assign({
                navController: inputs.navController,
            })}></${AnthaKeyboard}>
        `;
    },
});

const onScreenKeyboardDemoMod = defineAnthaMod<OnScreenKeyboardDemoModState>({
    modName: 'on-screen-keyboard-demo',
    execute({state}) {
        if (!state.navController) {
            return SkipExecution;
        }

        return html`
            <${Demo16OnScreenKeyboard.assign({
                navController: state.navController,
            })}></${Demo16OnScreenKeyboard}>
        `;
    },
});

export const onScreenKeyboardDemo: AnthaDemo = {
    demoName: 'On Screen Keyboard',
    demoPathId: 'on-screen-keyboard',
    demoSortDate: createUtcFullDate('2026-06-13'),
    engine() {
        return new AnthaEngine<OnScreenKeyboardDemoModState>({
            initState: {
                bindingAssignments: {
                    1: defaultMenuNavBindings,
                },
                isInMenu: true,
            },
            mods: [
                createAnthaReadRawInputMod(),
                createAnthaInputBindingsMod<MenuNavBinding>(),
                createAnthaMenuNavMod({}),
                onScreenKeyboardDemoMod,
            ],
        });
    },
};
