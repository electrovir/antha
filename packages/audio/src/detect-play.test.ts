import {assert, waitUntil} from '@augment-vir/assert';
import {describe, it, testWeb} from '@augment-vir/test';
import {html} from 'element-vir';
import {isPlayingEnabled} from './detect-play.js';

describe(isPlayingEnabled.name, () => {
    it('detects enabled audio', async () => {
        const audioContext = new AudioContext();

        assert.isFalse(await isPlayingEnabled(audioContext));
        const fixture = await testWeb.render(html`
            <button></button>
        `);
        await testWeb.click(fixture);

        await waitUntil.isTrue(() => isPlayingEnabled(audioContext));
    });
});
