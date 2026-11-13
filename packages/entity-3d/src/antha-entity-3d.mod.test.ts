import {AssetLoader} from '@antha/asset';
import {type ModExecuteParams} from '@antha/engine';
import {View3D} from '@antha/graphics-3d';
import {assert, assertWrap} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {createAnthaEntity3dSuite, type AnthaEntity3dModState} from './antha-entity-3d.mod.js';
import {emptyEntityUpdateParams} from './entity-store-3d.mock.js';

async function runMod(
    suite: ReturnType<typeof createAnthaEntity3dSuite>,
    state: Partial<AnthaEntity3dModState>,
) {
    await assertWrap.isDefined(suite.updateEntitiesMod.execute)({
        ...emptyEntityUpdateParams,
        state,
    } satisfies ModExecuteParams<any> as ModExecuteParams<AnthaEntity3dModState>);
}

describe(createAnthaEntity3dSuite.name, () => {
    it('waits for the 3D view and asset loader before creating a store', async () => {
        const suite = createAnthaEntity3dSuite({
            physics: {
                stepDuration: {
                    milliseconds: 20,
                },
            },
        });
        const state: Partial<AnthaEntity3dModState> = {
            ...suite.updateEntitiesMod.initState,
            assetLoader: new AssetLoader(),
            graphics3d: {},
        };
        await runMod(suite, state);
        const storeWithoutView = state.entityStore;

        const view = new View3D();
        state.graphics3d = {
            view,
        };
        await runMod(suite, state);
        const entityStore = assertWrap.isDefined(state.entityStore);

        assert.deepEquals(
            {
                storeWithoutView,
                isUsingView: entityStore.view3d === view,
                stepDuration: entityStore.stepDuration,
            },
            {
                storeWithoutView: undefined,
                isUsingView: true,
                stepDuration: {
                    milliseconds: 20,
                },
            },
        );
        entityStore.destroy();
    });
});
