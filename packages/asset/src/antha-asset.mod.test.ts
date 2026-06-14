import {AnthaEngine} from '@antha/engine';
import {assert, assertWrap, waitUntil} from '@augment-vir/assert';
import {describe, it, testWeb} from '@augment-vir/test';
import {html} from 'element-vir';
import {
    AnthaAssetLoadingScreen,
    type AnthaAssetModState,
    anthaAssetModName,
    createAnthaAssetMod,
    loadingScreenFadeMs,
} from './antha-asset.mod.js';

describe(createAnthaAssetMod.name, () => {
    it('creates a mod with the correct name', () => {
        const mod = createAnthaAssetMod();
        assert.strictEquals(mod.modName, anthaAssetModName);
    });

    it('initializes an AssetLoader on first execute', async () => {
        const mod = createAnthaAssetMod();
        const engine = new AnthaEngine<AnthaAssetModState>({
            mods: [mod],
        });

        await engine.runSingleTick();

        assert.isDefined(engine.state.assetLoader);
    });

    it('sets up a progress listener when hideLoadingScreen is false', async () => {
        const mod = createAnthaAssetMod();
        const engine = new AnthaEngine<AnthaAssetModState>({
            mods: [mod],
        });

        await engine.runSingleTick();

        /** Simulate loading by loading a mock asset. */
        await assertWrap.isDefined(engine.state.assetLoader).bulkLoadAssets([
            {
                name: 'test-asset',
                maxProgress: 1,
                load({incrementProgressCallback}) {
                    incrementProgressCallback();
                    return {
                        value: 'loaded',
                    };
                },
            },
        ]);

        await waitUntil.isFalse(() => {
            return engine.state.isShowingLoadingScreen ?? false;
        });
    });

    it('cleanup destroys the AssetLoader', async () => {
        const mod = createAnthaAssetMod();
        const engine = new AnthaEngine<AnthaAssetModState>({
            mods: [mod],
        });

        await engine.runSingleTick();

        assert.isDefined(engine.state.assetLoader);

        await engine.reset();

        assert.isFalse(engine.state.isShowingLoadingScreen || false);
    });

    it('renders loading screen template', async () => {
        const mod = createAnthaAssetMod();
        const engine = new AnthaEngine<AnthaAssetModState>({
            mods: [mod],
        });

        /**
         * Manually set the loading screen state to trigger rendering. This path only renders when
         * hideLoadingScreen is true (inverted logic in the source).
         */
        engine.state.loadingScreenState = {
            current: 0,
            total: 1,
            completedAt: undefined,
        };

        await engine.runSingleTick();

        const templates = engine.currentTemplateArray;
        assert.isLengthExactly(templates, 1);
        assert.isDefined(templates[0]);
    });

    it('renders completed loading screen with fade-out', async () => {
        const mod = createAnthaAssetMod();
        const engine = new AnthaEngine<AnthaAssetModState>({
            mods: [mod],
        });

        engine.state.loadingScreenState = {
            current: 1,
            total: 1,
            completedAt: 0,
        };

        await engine.runSingleTick();

        const templates = engine.currentTemplateArray;
        assert.isLengthExactly(templates, 1);
        assert.isDefined(templates[0]);
    });

    it('returns undefined when loading screen fade has completed', async () => {
        const mod = createAnthaAssetMod();
        const engine = new AnthaEngine<AnthaAssetModState>({
            mods: [mod],
        });

        /** Set completedAt far in the past so the fade has finished. */
        engine.state.loadingScreenState = {
            current: 1,
            total: 1,
            completedAt: -(loadingScreenFadeMs + 1000),
        };

        await engine.runSingleTick();

        const templates = engine.currentTemplateArray;
        assert.isLengthExactly(templates, 1);
        assert.isUndefined(templates[0]);
    });

    it('returns undefined when loadingScreenState is not set', async () => {
        const mod = createAnthaAssetMod({
            hideLoadingScreen: true,
        });
        const engine = new AnthaEngine<AnthaAssetModState>({
            mods: [mod],
        });

        await engine.runSingleTick();

        const templates = engine.currentTemplateArray;
        assert.isLengthExactly(templates, 1);
    });

    it('does not return a template when hideLoadingScreen is false', async () => {
        const mod = createAnthaAssetMod();
        const engine = new AnthaEngine<AnthaAssetModState>({
            mods: [mod],
        });

        await engine.runSingleTick();

        const templates = engine.currentTemplateArray;
        assert.isLengthExactly(templates, 1);
        assert.isUndefined(templates[0]);
    });

    it('renders zero progress when total is zero', async () => {
        const mod = createAnthaAssetMod();
        const engine = new AnthaEngine<AnthaAssetModState>({
            mods: [mod],
        });

        engine.state.loadingScreenState = {
            current: 0,
            total: 0,
            completedAt: undefined,
        };

        await engine.runSingleTick();

        const templates = engine.currentTemplateArray;
        assert.isLengthExactly(templates, 1);
        assert.isDefined(templates[0]);
    });
});

describe(AnthaAssetLoadingScreen.tagName, () => {
    it('renders loading screen element', async () => {
        const fixture = await testWeb.render(html`
            <${AnthaAssetLoadingScreen.assign({
                progressPercent: 50,
                dotCount: 2,
                completed: false,
                currentResourceName: undefined,
            })}></${AnthaAssetLoadingScreen}>
        `);

        assert.instanceOf(fixture, AnthaAssetLoadingScreen);
        testWeb.cleanupRender();
    });

    it('renders completed state', async () => {
        const fixture = await testWeb.render(html`
            <${AnthaAssetLoadingScreen.assign({
                progressPercent: 100,
                dotCount: 0,
                completed: true,
                currentResourceName: undefined,
            })}></${AnthaAssetLoadingScreen}>
        `);

        assert.instanceOf(fixture, AnthaAssetLoadingScreen);
        testWeb.cleanupRender();
    });
});
