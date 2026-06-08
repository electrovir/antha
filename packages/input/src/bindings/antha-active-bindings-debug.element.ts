import {css, defineElement, html} from 'element-vir';
import {type PlayersActiveBindings} from './player-bindings.js';

/**
 * An element for debugging player bindings and active player inputs.
 *
 * @category Internal
 */
export const AnthaActiveBindingsDebug = defineElement<{
    activeBindings: PlayersActiveBindings | undefined;
}>()({
    tagName: 'antha-active-bindings-debug',
    styles: css`
        :host {
            display: flex;
            gap: 16px;
            flex-direction: column;
            text-shadow:
                -1px -1px 0 white,
                1px -1px 0 white,
                -1px 1px 0 white,
                1px 1px 0 white;
        }

        h2 {
            margin: 4px;
        }

        .no-bindings {
            opacity: 0.3;
            font-weight: bold;
        }
    `,
    render({inputs}) {
        const activeBindingTemplates = Object.entries(inputs.activeBindings || {}).map(
            ([
                bindingName,
                activeBinding,
            ]) => {
                return html`
                    <section class="binding">
                        <h3>${bindingName}</h3>
                        <pre>${JSON.stringify(activeBinding, null, 4)}</pre>
                    </section>
                `;
            },
        );

        const noBindings = !activeBindingTemplates.length;

        return html`
            <h2>Active Bindings</h2>
            ${noBindings
                ? html`
                      <p class="no-bindings">No active bindings.</p>
                  `
                : activeBindingTemplates}
        `;
    },
});
