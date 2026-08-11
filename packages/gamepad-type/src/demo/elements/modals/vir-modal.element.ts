import {css, defineElement, html, listen} from 'element-vir';
import {CloseX24Icon, ViraIcon, noNativeFormStyles, noNativeSpacing} from 'vira';
import {ModalClose} from '../../events/modal-close.event.js';

export const VirModal = defineElement<{modalTitle: string}>()({
    tagName: 'vir-modal',
    styles: css`
        .background {
            display: flex;
            justify-content: center;
            align-items: center;
            position: fixed;
            top: 0;
            left: 0;
            z-index: 9999;
            width: 100vw;
            height: 100vh;
            background-color: rgba(0, 0, 0, 0.8);
        }

        .modal-wrapper {
            background-color: white;
            border: 4px solid #ddd;
            border-radius: 16px;
            padding: 0 0 32px 16px;
        }

        h1 {
            ${noNativeSpacing};
            font-size: 1.8em;
            margin-top: 8px;
            margin-bottom: 16px;
            flex-grow: 1;
        }

        .slot-wrapper {
            margin: 0 32px 16px 16px;
        }

        .close-x {
            ${noNativeFormStyles};
            padding: 2px;
            font-family: monospace;
            color: #aaa;
            cursor: pointer;
            transition: 100ms;
        }

        .close-x:hover {
            color: black;
        }

        header {
            display: flex;
            align-items: flex-start;
        }
    `,
    render({inputs, dispatch}) {
        return html`
            <div
                class="background"
                ${listen('mousedown', (event) => {
                    if (event.target === event.currentTarget) {
                        dispatch(new ModalClose());
                    }
                })}
            >
                <div class="modal-wrapper">
                    <header>
                        <h1>${inputs.modalTitle}</h1>
                        <button
                            class="close-x"
                            ${listen('click', () => {
                                dispatch(new ModalClose());
                            })}
                        >
                            <${ViraIcon.assign({
                                icon: CloseX24Icon,
                            })}></${ViraIcon}>
                        </button>
                    </header>
                    <div class="slot-wrapper">
                        <slot></slot>
                    </div>
                </div>
            </div>
        `;
    },
});
