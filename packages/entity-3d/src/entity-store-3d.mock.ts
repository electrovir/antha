import {AssetLoader} from '@antha/asset';
import {
    AnthaEngine,
    ModExecutionTriggerType,
    type ModExecuteParams,
    type ModInstanceId,
} from '@antha/engine';
import {View3D} from '@antha/graphics-3d';
import {applyBrand} from '@augment-vir/common';
import {type createAnthaEntity3dSuite} from './antha-entity-3d.mod.js';

export function createTestStore(suite: ReturnType<typeof createAnthaEntity3dSuite>) {
    return suite.createEntityStore({
        view3d: new View3D(),
        state: {},
        assetLoader: new AssetLoader(),
    });
}

const testEngine = new AnthaEngine();

export const emptyEntityUpdateParams = {
    currentTick: 0,
    engine: testEngine,
    executionTrigger: {
        type: ModExecutionTriggerType.Tick,
    },
    trigger: undefined,
    hostElement: document.createElement('div'),
    lastExecution: undefined,
    modInstanceId: applyBrand<ModInstanceId>('entity-test'),
    msSinceLastExecute: 0,
    state: testEngine.state,
    ticksSinceLastExecute: 0,
} satisfies ModExecuteParams;
