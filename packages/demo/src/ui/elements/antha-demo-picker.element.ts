import {toSimpleDatePartString, toTimestamp} from 'date-vir';
import {css, defineElement, html} from 'element-vir';
import {ViraLink} from 'vira';
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
            font-family: sans-serif;
        }

        ol {
            display: flex;
            flex-direction: column;
        }
    `,
    render({inputs}) {
        const demos = allDemos.toSorted(
            (a, b) => toTimestamp(a.sortDate) - toTimestamp(b.sortDate),
        );

        if (!demos.length) {
            return html`Demos to be added soon!`;
        }

        const listTemplates = demos.map((demo) => {
            return html`<li><${ViraLink.assign({
                route: {
                    route: {
                        paths: demoPathTree.paths.children[':demo-id'].fill(demo.demoPathId)
                            .fullPaths,
                    },
                    router: inputs.router,
                },
            })}>${toSimpleDatePartString(demo.sortDate)}: ${demo.demoName}</${ViraLink}></li>`;
        });

        return html`<ol>${listTemplates}</ol>`;
    },
});
