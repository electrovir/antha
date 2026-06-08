import {getObjectTypedEntries} from '@augment-vir/common';
import {css, defineElement, html} from 'element-vir';
import {isGamepadDeviceKey} from 'input-device-handler';
import {type PlayersBindingAssignments} from './player-bindings.js';

/**
 * An element for debugging all given bindings for all players.
 *
 * @category Debug
 */
export const AnthaBindingAssignmentsDebug = defineElement<{
    bindingAssignments: PlayersBindingAssignments | undefined;
}>()({
    tagName: 'antha-binding-assignments',
    styles: css`
        :host {
            text-shadow:
                -1px -1px 0 white,
                1px -1px 0 white,
                -1px 1px 0 white,
                1px 1px 0 white;
        }
        h3,
        h4 {
            margin: 4px;
        }
    `,
    render({inputs}) {
        return getObjectTypedEntries(inputs.bindingAssignments || {}).map(
            ([
                playerPosition,
                bindingsMap,
            ]) => {
                const playerBindings = getObjectTypedEntries(bindingsMap).map(
                    ([
                        bindingName,
                        bindings,
                    ]) => {
                        const bindingsRows = bindings.map((binding) => {
                            const deviceKeyName = isGamepadDeviceKey(binding.deviceKey)
                                ? `gamepad ${binding.deviceKey}`
                                : binding.deviceKey;
                            return html`
                                <tr>
                                    <td>${deviceKeyName}:</td>
                                    <td>${binding.inputName}</td>
                                </tr>
                            `;
                        });

                        return html`
                            <section class="binding">
                                <h4>${bindingName}</h4>
                                <table><tbody>${bindingsRows}</tbody></table>
                            </section>
                        `;
                    },
                );

                return html`
                    <h3>Player ${playerPosition}</h3>
                    ${playerBindings}
                `;
            },
        );
    },
});
