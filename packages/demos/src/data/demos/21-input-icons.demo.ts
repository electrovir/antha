import {
    fancyGamepadModelName,
    GamepadIconSet,
    gamepadIconSetInputIcons,
    gamepadIconSetStickIcons,
    getGamepadInputIcons,
    getGamepadStickIcon,
    InputDirection,
    keyboardInputIcons,
    KnownInput,
    mouseInputIcons,
    PredefinedGamepadModel,
    type GamepadStickInput,
} from '@antha/gamepad-type';
import * as commonIcons from '@antha/gamepad-type/src/icons/common-icons.js';
import {check} from '@augment-vir/assert';
import {getObjectTypedEntries, getObjectTypedValues} from '@augment-vir/common';
import {createUtcFullDate} from 'date-vir';
import {classMap, css, defineElement, html} from 'element-vir';
import {ViraIcon, type ViraIconSvg} from 'vira';
import {type AnthaDemo} from '../demo.js';

function renderIcons(icons: ReadonlyArray<ViraIconSvg>) {
    return html`
        <div class="icons">
            ${icons.map((icon) => {
                return html`
                    <${ViraIcon.assign({
                        icon,
                    })}
                        title=${icon.name}
                    ></${ViraIcon}>
                `;
            })}
        </div>
    `;
}

const stickRows = (
    [
        KnownInput.LeftStickX,
        KnownInput.LeftStickY,
        KnownInput.RightStickX,
        KnownInput.RightStickY,
    ] satisfies ReadonlyArray<GamepadStickInput>
).flatMap((input) => {
    return getObjectTypedValues(InputDirection).map((direction) => {
        return {
            input,
            direction,
        };
    });
});

function renderInputTable<Row>({
    rows,
    getRowLabel,
    columns,
}: Readonly<{
    rows: ReadonlyArray<Row>;
    getRowLabel: (row: Row) => string;
    columns: ReadonlyArray<
        Readonly<{
            label: string;
            getIcons: (row: Row) => ReadonlyArray<ViraIconSvg>;
        }>
    >;
}>) {
    return html`
        <div class="table-wrapper">
            <table>
                <thead>
                    <tr>
                        <th></th>
                        ${columns.map((column) => {
                            return html`
                                <th>${column.label}</th>
                            `;
                        })}
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row) => {
                        return html`
                            <tr>
                                <th>${getRowLabel(row)}</th>
                                ${columns.map((column) => {
                                    const icons = column.getIcons(row);

                                    return html`
                                        <td
                                            class=${classMap({
                                                common: icons.some((icon) => {
                                                    return check.isIn(
                                                        icon,
                                                        getObjectTypedValues(commonIcons),
                                                    );
                                                }),
                                            })}
                                        >
                                            ${renderIcons(icons)}
                                        </td>
                                    `;
                                })}
                            </tr>
                        `;
                    })}
                </tbody>
            </table>
        </div>
    `;
}

function renderInputNameGrid(inputIcons: Readonly<Record<string, ReadonlyArray<ViraIconSvg>>>) {
    return html`
        <div class="grid">
            ${getObjectTypedEntries(inputIcons).map(
                ([
                    inputName,
                    icons,
                ]) => {
                    return html`
                        <div class="card">
                            ${renderIcons(icons)}
                            <code>${inputName}</code>
                        </div>
                    `;
                },
            )}
        </div>
    `;
}

const DemoInputIcons = defineElement()({
    tagName: 'demo-input-icons',
    styles: css`
        :host {
            display: flex;
            flex-direction: column;
            gap: 16px;
            padding: 16px;
            height: 100%;
            overflow-y: auto;
            box-sizing: border-box;
        }

        .table-wrapper {
            flex-shrink: 0;
            max-width: 100%;
            overflow-x: auto;
        }

        table {
            border-collapse: collapse;

            & th,
            & td {
                padding: 4px 8px;
                border: 1px solid #888;
            }

            & thead th {
                position: sticky;
                top: 0;
                background-color: white;
            }

            & td.common {
                background-color: #f6f6f6;
            }

            & tbody th {
                text-align: left;
                font-family: monospace;
            }
        }

        .icons {
            display: flex;
            gap: 4px;
        }

        .grid {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }

        .card {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            padding: 8px;
            border: 1px solid #888;
            border-radius: 8px;
        }
    `,
    render() {
        return html`
            <h2>Gamepad models</h2>
            <p>
                The icons
                <code>getGamepadInputIcons</code>
                returns for each model.
            </p>
            ${renderInputTable({
                rows: getObjectTypedValues(KnownInput),
                getRowLabel(input) {
                    return input;
                },
                columns: getObjectTypedValues(PredefinedGamepadModel).map((model) => {
                    return {
                        label: fancyGamepadModelName[model],
                        getIcons(input: KnownInput) {
                            return getGamepadInputIcons({
                                gamepadModel: model,
                                gamepadBrand: undefined,
                                input,
                            });
                        },
                    };
                }),
            })}
            <h2>Gamepad model stick directions</h2>
            <p>
                The icons
                <code>getGamepadStickIcon</code>
                returns for each model.
            </p>
            ${renderInputTable({
                rows: stickRows,
                getRowLabel(row) {
                    return `${row.input} ${row.direction}`;
                },
                columns: getObjectTypedValues(PredefinedGamepadModel).map((model) => {
                    return {
                        label: fancyGamepadModelName[model],
                        getIcons(row: (typeof stickRows)[number]) {
                            const icon = getGamepadStickIcon({
                                gamepadModel: model,
                                gamepadBrand: undefined,
                                ...row,
                            });
                            return icon
                                ? [
                                      icon,
                                  ]
                                : [];
                        },
                    };
                }),
            })}
            <h2>Gamepad icon sets</h2>
            <p>
                Every icon in
                <code>gamepadIconSetInputIcons</code>
                , default first.
            </p>
            ${renderInputTable({
                rows: getObjectTypedValues(KnownInput),
                getRowLabel(input) {
                    return input;
                },
                columns: getObjectTypedValues(GamepadIconSet).map((iconSet) => {
                    return {
                        label: iconSet,
                        getIcons(input: KnownInput) {
                            return gamepadIconSetInputIcons[iconSet][input] || [];
                        },
                    };
                }),
            })}
            <h2>Gamepad icon set stick directions</h2>
            <p>
                Every icon in
                <code>gamepadIconSetStickIcons</code>
                .
            </p>
            ${renderInputTable({
                rows: stickRows,
                getRowLabel(row) {
                    return `${row.input} ${row.direction}`;
                },
                columns: getObjectTypedValues(GamepadIconSet).map((iconSet) => {
                    return {
                        label: iconSet,
                        getIcons(row: (typeof stickRows)[number]) {
                            const icon =
                                gamepadIconSetStickIcons[iconSet][row.input]?.[row.direction];
                            return icon
                                ? [
                                      icon,
                                  ]
                                : [];
                        },
                    };
                }),
            })}
            <h2>Keyboard</h2>
            ${renderInputNameGrid(keyboardInputIcons)}
            <h2>Mouse</h2>
            ${renderInputNameGrid(mouseInputIcons)}
        `;
    },
});

export const inputIconsDemo: AnthaDemo = {
    demoName: 'Input Icons',
    demoPathId: 'input-icons',
    demoSortDate: createUtcFullDate('2026-10-24'),
    element: DemoInputIcons,
};
