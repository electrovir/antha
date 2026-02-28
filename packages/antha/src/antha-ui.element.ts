import {type PartialWithUndefined} from '@augment-vir/common';
import {css, defineElement} from 'element-vir';
import {type AnthaEngine} from './antha.js';

/**
 * Options for {@link AnthaUi}.
 *
 * @category UI
 */
export type AnthaUiOptions = {
    /**
     * If set to `true`, the engine won't automatically be cleaned up when the {@link AnthaUi}
     * element is disconnected or destroyed.
     *
     * @default false
     */
    disableDisconnectReset: boolean;
    /**
     * If set to `true`, the engine won't automatically be started up when the {@link AnthaUi}
     * element is connected.
     *
     * @default false
     */
    disableConnectStart: boolean;
};

/**
 * A built-in element for easily rendering {@link AnthaEngine} templates to the browser.
 *
 * @category UI
 * @example
 *
 * ```ts
 * import {AnthaUi, AnthaEngine} from 'antha';
 *
 * const engine = new AnthaEngine();
 * ```
 */
export const AnthaUi = defineElement<{
    engine: AnthaEngine;
    options?: Readonly<PartialWithUndefined<AnthaUiOptions>>;
}>()({
    tagName: 'antha-ui',
    styles: css`
        :host {
            /* Because all of these styles are defined on the host, you can easily override them. */
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            height: 100dvh;
            gap: 16px;
            width: 100dvw;
            box-sizing: border-box;
            padding: 32px;
            font-family: sans-serif;
        }
    `,
    state() {
        return {
            engineObservable: undefined as undefined | AnthaEngine['observable'],
        };
    },
    cleanup({inputs, updateState}) {
        if (!inputs.options?.disableDisconnectReset) {
            inputs.engine.reset();
        }
        updateState({
            /** Remove the observable on cleanup to stop render updates. */
            engineObservable: undefined,
        });
    },
    render({state, updateState, inputs}) {
        if (state.engineObservable !== inputs.engine.observable) {
            /** Automatically swap out the observable if the engine changes. */
            updateState({
                engineObservable: inputs.engine.observable,
            });
            if (!inputs.options?.disableConnectStart) {
                inputs.engine.startLoop();
            }
        }

        return state.engineObservable?.value;
    },
});
