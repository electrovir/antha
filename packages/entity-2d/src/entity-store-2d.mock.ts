import {AssetLoader} from '@antha/asset';
import {createMockPixi} from '@antha/graphics-2d';
import {createAnthaEntity2dSuite} from './antha-entity-2d.mod.js';
import {type EntityHitboxSystem} from './entity-hitbox-system.js';
import {EntityStore2d} from './entity-store-2d.js';

export function createTestSuite() {
    return createAnthaEntity2dSuite({});
}

export function createTestStore(
    _suiteForEntityDefinitions: ReturnType<typeof createTestSuite>,
    options?: {
        assetLoader?: AssetLoader;
        customHitboxSystem?: EntityHitboxSystem;
    },
) {
    return new EntityStore2d({
        pixi: createMockPixi(),
        state: {},
        assetLoader: options?.assetLoader || new AssetLoader(),
        customHitboxSystem: options?.customHitboxSystem,
    });
}
