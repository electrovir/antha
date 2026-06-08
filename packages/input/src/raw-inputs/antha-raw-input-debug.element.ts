import {css, defineElement, html} from 'element-vir';
import {type AnthaReadRawInputModState} from './antha-read-raw-input.mod.js';

/**
 * An element for debugging raw inputs that displays all current inputs.
 *
 * @category Internal
 */
export const AnthaRawInputDebug = defineElement<{
    rawInputs: Readonly<AnthaReadRawInputModState['rawInputs']>;
}>()({
    tagName: 'antha-raw-input-debug',
    styles: css`
        :host {
            display: flex;
            gap: 16px;
            flex-wrap: wrap;
        }

        .device {
            min-width: 500px;
        }

        .no-inputs {
            opacity: 0.3;
            font-weight: bold;
        }
    `,
    render({inputs}) {
        return Object.entries(inputs.rawInputs).map(
            ([
                deviceKey,
                values,
            ]) => {
                const hasNoValues = Object.keys(values).length === 0;

                const valuesTemplate = hasNoValues
                    ? html`
                          <p class="no-inputs">No inputs</p>
                      `
                    : html`
                          <pre>${JSON.stringify(values, null, 4)}</pre>
                      `;

                return html`
                    <section class="device">
                        <b>${deviceKey}</b>
                        ${valuesTemplate}
                    </section>
                `;
            },
        );
    },
});
