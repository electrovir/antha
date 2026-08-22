import {AnthaEngine} from '@antha/engine';
import {assert, assertWrap} from '@augment-vir/assert';
import {wait} from '@augment-vir/common';
import {describe, it, testWeb} from '@augment-vir/test';
import {html} from 'element-vir';
import {
    AnthaAssetLoadingScreen,
    type AnthaAssetModState,
    anthaAssetModName,
    createAnthaAssetMod,
    defaultLoadingScreenFadeMs,
} from './antha-asset.mod.js';
import {type AssetLoadState} from './asset-loader.js';

describe(createAnthaAssetMod.name, () => {
    it('creates a mod with the correct name', () => {
        const mod = createAnthaAssetMod();
        assert.strictEquals(mod.modName, anthaAssetModName);
    });

    it('initializes an AssetLoader and its first load session on first execute', async () => {
        const mod = createAnthaAssetMod();
        const engine = new AnthaEngine<AnthaAssetModState>({
            mods: [mod],
        });

        await engine.runSingleTick();

        assert.isDefined(engine.state.assetLoader);
        assert.isDefined(engine.state.assetLoader.currentLoadSession);
    });

    it('exposes progress reported by its current load session', async () => {
        const mod = createAnthaAssetMod();
        const engine = new AnthaEngine<AnthaAssetModState>({
            mods: [mod],
        });

        await engine.runSingleTick();

        const assetLoader = assertWrap.isDefined(engine.state.assetLoader);
        assetLoader.currentLoadSession.reportProgress({
            current: 1,
            currentResourceName: 'test-asset',
            total: 2,
        });

        assert.deepEquals(assetLoader.loadState, {
            current: 1,
            total: 2,
            currentResourceName: 'test-asset',
            completedAt: undefined,
            isLoading: true,
        } satisfies AssetLoadState);
    });

    it('replaces the active load session without accepting stale progress', async () => {
        const mod = createAnthaAssetMod();
        const engine = new AnthaEngine<AnthaAssetModState>({
            mods: [mod],
        });

        await engine.runSingleTick();

        const assetLoader = assertWrap.isDefined(engine.state.assetLoader);
        const previousSession = assetLoader.currentLoadSession;
        previousSession.reportProgress({
            current: 1,
            currentResourceName: 'previous-asset',
            total: 1,
        });
        previousSession.complete();

        const loadSession = assetLoader.createLoadSession();

        const replacementSessionState = assetLoader.loadState;
        assert.deepEquals(replacementSessionState, {
            current: 0,
            currentResourceName: undefined,
            total: 0,
            completedAt: undefined,
            isLoading: true,
        } satisfies AssetLoadState);

        previousSession.reportProgress({
            current: 1,
            currentResourceName: 'stale-asset',
            total: 1,
        });

        const staleSessionState = assetLoader.loadState;
        assert.deepEquals(staleSessionState, {
            current: 0,
            currentResourceName: undefined,
            total: 0,
            completedAt: undefined,
            isLoading: true,
        } satisfies AssetLoadState);

        loadSession.reportProgress({
            current: 1,
            currentResourceName: 'new-asset',
            total: 2,
        });

        assert.deepEquals(assetLoader.loadState, {
            current: 1,
            currentResourceName: 'new-asset',
            total: 2,
            completedAt: undefined,
            isLoading: true,
        } satisfies AssetLoadState);
    });

    it('does not show a loading screen for asset loads without a session', async () => {
        const mod = createAnthaAssetMod();
        const engine = new AnthaEngine<AnthaAssetModState>({
            mods: [mod],
        });

        await engine.runSingleTick();

        await assertWrap.isDefined(engine.state.assetLoader).bulkLoadAssets([
            {
                name: 'unscoped-asset',
                maxProgress: 1,
                load({incrementProgressCallback}) {
                    incrementProgressCallback();
                    return {
                        value: 'loaded',
                    };
                },
            },
        ]);

        assert.isUndefined(assertWrap.isDefined(engine.state.assetLoader).loadState);
    });

    it('defers load completion until after the next render', async () => {
        const mod = createAnthaAssetMod();
        const engine = new AnthaEngine<AnthaAssetModState>({
            mods: [mod],
        });

        await engine.runSingleTick();

        const assetLoader = assertWrap.isDefined(engine.state.assetLoader);
        const loadSession = assetLoader.createLoadSession();
        loadSession.reportProgress({
            current: 1,
            currentResourceName: 'test-asset',
            total: 1,
        });
        loadSession.complete();

        await engine.runSingleTick();

        assert.deepEquals(assetLoader.loadState, {
            completedAt: undefined,
            current: 1,
            currentResourceName: 'test-asset',
            total: 1,
            isLoading: true,
        } satisfies AssetLoadState);

        await engine.runSingleTick();

        const completedLoadState = assertWrap.isDefined(assetLoader.loadState);
        assert.isDefined(completedLoadState.completedAt);
        assert.isFalse(completedLoadState.isLoading);
    });

    it('cleanup destroys the AssetLoader', async () => {
        const mod = createAnthaAssetMod();
        const engine = new AnthaEngine<AnthaAssetModState>({
            mods: [mod],
        });

        await engine.runSingleTick();

        const assetLoader = assertWrap.isDefined(engine.state.assetLoader);
        assetLoader.createLoadSession();

        await engine.reset();

        assert.isUndefined(assetLoader.loadState);
    });

    it('renders a load session', async () => {
        const mod = createAnthaAssetMod();
        const engine = new AnthaEngine<AnthaAssetModState>({
            mods: [mod],
        });

        await engine.runSingleTick();
        assertWrap.isDefined(engine.state.assetLoader).createLoadSession();
        await engine.runSingleTick();

        const templates = engine.currentTemplateArray;
        assert.isLengthExactly(templates, 1);
        assert.isDefined(templates[0]);
    });

    it('uses configured loading screen fade duration', async () => {
        const mod = createAnthaAssetMod({
            loadingScreenFadeMs: 0,
        });
        const engine = new AnthaEngine<AnthaAssetModState>({
            mods: [mod],
        });

        await engine.runSingleTick();
        const loadSession = assertWrap.isDefined(engine.state.assetLoader).createLoadSession();
        loadSession.complete();
        await engine.runSingleTick();
        await engine.runSingleTick();
        await wait({
            milliseconds: 10,
        });
        await engine.runSingleTick();

        assert.isUndefined(engine.currentTemplateArray[0]);
    });

    it('tracks a custom loading screen without rendering the default screen', async () => {
        const mod = createAnthaAssetMod({
            hideLoadingScreen: true,
        });
        const engine = new AnthaEngine<AnthaAssetModState>({
            mods: [mod],
        });

        await engine.runSingleTick();

        assertWrap.isDefined(engine.state.assetLoader).createLoadSession();
        await engine.runSingleTick();

        assert.deepEquals(assertWrap.isDefined(engine.state.assetLoader).loadState, {
            current: 0,
            currentResourceName: undefined,
            total: 0,
            completedAt: undefined,
            isLoading: true,
        } satisfies AssetLoadState);

        const templates = engine.currentTemplateArray;
        assert.isLengthExactly(templates, 1);
        assert.isUndefined(templates[0]);
    });

    it('does not render before a load session reports progress', async () => {
        const mod = createAnthaAssetMod();
        const engine = new AnthaEngine<AnthaAssetModState>({
            mods: [mod],
        });

        await engine.runSingleTick();

        const templates = engine.currentTemplateArray;
        assert.isLengthExactly(templates, 1);
        assert.isUndefined(templates[0]);
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
                loadingScreenFadeMs: defaultLoadingScreenFadeMs,
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
                loadingScreenFadeMs: defaultLoadingScreenFadeMs,
            })}></${AnthaAssetLoadingScreen}>
        `);

        assert.instanceOf(fixture, AnthaAssetLoadingScreen);
        testWeb.cleanupRender();
    });

    it('uses its configured fade duration', async () => {
        const fixture = await testWeb.render(html`
            <${AnthaAssetLoadingScreen.assign({
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
