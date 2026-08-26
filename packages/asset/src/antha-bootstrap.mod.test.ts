import {AnthaEngine, defineAnthaMod, emptyAnthaLogger} from '@antha/engine';
import {assert, assertWrap} from '@augment-vir/assert';
import {DeferredPromise, wait, type AnyObject} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {createAnthaAssetMod, type AnthaAssetModState} from './antha-asset.mod.js';
import {createAnthaBootstrapMod, type AnthaBootstrapModState} from './antha-bootstrap.mod.js';

describe(createAnthaBootstrapMod.name, () => {
    it('loads code through the loading session and installs returned mods', async () => {
        const moduleLoad = new DeferredPromise<{value: string}>();
        let bootstrappedModule: {value: string} | undefined;
        let executedLoadedMod = false;
        const loadedMod = defineAnthaMod<AnyObject>({
            modName: 'loaded-mod',
            execute() {
                executedLoadedMod = true;
            },
        });
        const bootstrapMod = createAnthaBootstrapMod<{value: string}>({
            bootstrap({module}) {
                bootstrappedModule = module;

                return {
                    mods: [loadedMod],
                };
            },
            loadModule() {
                return moduleLoad.promise;
            },
        });
        const engine = new AnthaEngine<AnthaAssetModState & AnthaBootstrapModState>({
            mods: [
                createAnthaAssetMod(),
                bootstrapMod,
            ],
        });

        await engine.runSingleTick();

        assert.deepEquals(assertWrap.isDefined(engine.state.assetLoader).loadState, {
            completedAt: undefined,
            current: 0,
            currentResourceName: 'Game code',
            isLoading: true,
            total: 1,
        });
        moduleLoad.resolve({
            value: 'loaded-game-code',
        });
        await wait({
            milliseconds: 0,
        });

        assert.strictEquals(bootstrappedModule?.value, 'loaded-game-code');
        assert.isTrue(engine.currentMods.includes(loadedMod));

        await engine.runSingleTick();

        assert.isTrue(executedLoadedMod);
    });

    it('completes the loading session and logs when module loading fails', async () => {
        const loggedErrors: unknown[] = [];
        const bootstrapMod = createAnthaBootstrapMod({
            bootstrap() {
                throw new Error('Bootstrap should not execute.');
            },
            loadModule() {
                throw new Error('Module loading failed.');
            },
        });
        const engine = new AnthaEngine<AnthaAssetModState & AnthaBootstrapModState>({
            engineOptions: {
                logger: {
                    ...emptyAnthaLogger,
                    error(message) {
                        loggedErrors.push(message);
                    },
                },
            },
            mods: [
                createAnthaAssetMod(),
                bootstrapMod,
            ],
        });

        await engine.runSingleTick();
        await wait({
            milliseconds: 0,
        });

        assert.isLengthExactly(loggedErrors, 1);
        assert.instanceOf(loggedErrors[0], Error);
        assert.strictEquals(
            loggedErrors[0].message,
            'Failed to bootstrap game: Module loading failed.',
        );
    });
});
