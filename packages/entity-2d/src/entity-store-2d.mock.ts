import {AssetLoader} from '@antha/asset';
import {
    AnthaEngine,
    ModExecutionTriggerType,
    type ModExecuteParams,
    type ModInstanceId,
} from '@antha/engine';
import {createMockPixi} from '@antha/graphics-2d';
import {applyBrand} from '@augment-vir/common';
import {type createAnthaEntity2dSuite} from './antha-entity-2d.mod.js';

export function createTestStore(
    suite: ReturnType<typeof createAnthaEntity2dSuite>,
    options?: {
        assetLoader?: AssetLoader;
    },
) {
    return suite.createEntityStore({
        pixi: createMockPixi(),
        state: {},
        assetLoader: options?.assetLoader || new AssetLoader(),
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
