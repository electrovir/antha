import {assert, assertWrap, waitUntil} from '@augment-vir/assert';
import {describe, it, testWeb} from '@augment-vir/test';
import {html} from 'element-vir';
import {
    AnthaAssetLoadingScreen,
    defaultLoadingScreenFadeMs,
} from './antha-asset-loading-screen.element.js';

const defaultLoadingScreenInputs = {
    hostElement: document.createElement('div'),
    options: {},
};

describe(AnthaAssetLoadingScreen.tagName, () => {
    it('renders loading screen element', async () => {
        const fixture = await testWeb.render(html`
            <${AnthaAssetLoadingScreen.assign({
                ...defaultLoadingScreenInputs,
                progressPercent: 50,
                dotCount: 2,
                completed: false,
                currentResourceName: undefined,
                loadingScreenFadeMs: defaultLoadingScreenFadeMs,
            })}></${AnthaAssetLoadingScreen}>
        `);

        assert.instanceOf(fixture, AnthaAssetLoadingScreen);
        testWeb.cleanupRender();
    });

    it('renders completed state', async () => {
        const fixture = await testWeb.render(html`
            <${AnthaAssetLoadingScreen.assign({
                ...defaultLoadingScreenInputs,
                progressPercent: 100,
                dotCount: 0,
                completed: true,
                currentResourceName: undefined,
                loadingScreenFadeMs: defaultLoadingScreenFadeMs,
            })}></${AnthaAssetLoadingScreen}>
        `);

        assert.instanceOf(fixture, AnthaAssetLoadingScreen);
        testWeb.cleanupRender();
    });

    it('updates its scale when the host element resizes', async () => {
        const hostElement = document.createElement('div');
        hostElement.style.height = '1080px';
        hostElement.style.width = '1920px';
        document.body.append(hostElement);

        try {
            const fixture = await testWeb.render(html`
                <${AnthaAssetLoadingScreen.assign({
                    hostElement,
                    options: {
                        virtualHeight: 1080,
                        virtualWidth: 3840,
                    },
                    progressPercent: 50,
                    dotCount: 2,
                    completed: false,
                    currentResourceName: undefined,
                    loadingScreenFadeMs: defaultLoadingScreenFadeMs,
                })}></${AnthaAssetLoadingScreen}>
            `);
            const loadingScreen = assertWrap.instanceOf(fixture, AnthaAssetLoadingScreen);

            await waitUntil(() => loadingScreen.style.transform === 'scale(0.5)');
            hostElement.style.width = '3840px';
            await waitUntil(() => loadingScreen.style.transform === 'scale(1)');

            assert.deepEquals(
                {
                    height: loadingScreen.style.height,
                    transform: loadingScreen.style.transform,
                    width: loadingScreen.style.width,
                },
                {
                    height: '100%',
                    transform: 'scale(1)',
                    width: '100%',
                },
            );
        } finally {
            hostElement.remove();
            testWeb.cleanupRender();
        }
    });

    it('uses its configured fade duration', async () => {
        const fixture = await testWeb.render(html`
            <${AnthaAssetLoadingScreen.assign({
                ...defaultLoadingScreenInputs,
                progressPercent: 100,
                dotCount: 0,
                completed: true,
                currentResourceName: undefined,
                loadingScreenFadeMs: 200,
            })}></${AnthaAssetLoadingScreen}>
        `);

        assert.strictEquals(globalThis.getComputedStyle(fixture).transitionDuration, '0.2s');
        testWeb.cleanupRender();
    });
});
