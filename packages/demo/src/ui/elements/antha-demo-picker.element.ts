import {toSimpleDatePartString, toTimestamp} from 'date-vir';
import {css, defineElement, html} from 'element-vir';
import {ExternalLink24Icon, noNativeSpacing, ViraIcon, ViraLink} from 'vira';
import {allDemos} from '../../data/all-demos.js';
import {demoPathTree, type DemoRouter} from '../../data/demo-router.js';

export const AnthaDemoPicker = defineElement<{
    router: Readonly<DemoRouter>;
}>()({
    tagName: 'antha-demo-picker',
    styles: css`
        :host {
            display: flex;
            flex-direction: column;
            padding: 32px;
            gap: 32px;
            font-family: sans-serif;
        }

        ol {
            ${noNativeSpacing}
            padding-left: 1em;
            display: flex;
            flex-direction: column;
        }

        ${ViraLink} {
            > span {
                display: flex;
                align-items: center;
                gap: 4px;
            }

            ${ViraIcon} {
                margin-top: -2px;
                height: 20px;
                aspect-ratio: 1;
            }
        }
    `,
    render({inputs}) {
        const demos = allDemos.toSorted(
            (a, b) => toTimestamp(b.sortDate) - toTimestamp(a.sortDate),
        );

        if (!demos.length) {
            return html`
                Demos to be added soon!
            `;
        }

        const listTemplates = demos.map((demo) => {
            return html`
                <li>
                    <${ViraLink.assign({
                        route: {
                            route: {
                                paths: demoPathTree.paths.children[':demo-id'].fill(demo.demoPathId)
                                    .fullPaths,
                            },
                            router: inputs.router,
                        },
                    })}>
                        ${toSimpleDatePartString(demo.sortDate)}: ${demo.demoName}
                    </${ViraLink}>
                </li>
            `;
        });

        return html`
            <ol reversed>
                ${listTemplates}
            </ol>
            <${ViraLink.assign({
                link: {
                    url: 'https://github.com/electrovir/antha',
                    newTab: true,
                },
            })}>
                <span>
                    <span>GitHub</span>
                    <${ViraIcon.assign({
                        icon: ExternalLink24Icon,
                        fitContainer: true,
                    })}></${ViraIcon}>
                </span>
            </${ViraLink}>
        `;
    },
});
