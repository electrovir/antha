import {assert} from '@augment-vir/assert';
import {describe, it, testWeb} from '@augment-vir/test';
import {html} from 'element-vir';
import {VirDemo} from './vir-demo.element.js';

describe(VirDemo.tagName, () => {
    it('renders', async () => {
        const instance = await testWeb.render(html`
            <${VirDemo}></${VirDemo}>
        `);

        assert.instanceOf(instance, VirDemo);
    });
});
