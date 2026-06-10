import {AnthaUi} from '@antha/engine';
import {css, defineElement, html} from 'element-vir';
import {createExampleGame} from '../../data/example-game-engine.js';

export const ExampleGame = defineElement()({
    tagName: 'example-game',
    state() {
        return {
            engine: createExampleGame(),
        };
    },
    styles: css`
        ${AnthaUi} {
            padding: 0;
        }
    `,
    render({state}) {
        return html`
            <${AnthaUi.assign({
                engine: state.engine,
            })}></${AnthaUi}>
        `;
    },
});
