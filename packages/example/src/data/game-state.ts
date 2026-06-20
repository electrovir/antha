import {type AnthaAssetModState} from '@antha/asset';
import {type AnthaEntity2dModState} from '@antha/entity-2d';
import {type AnthaInputBindingsModState} from '@antha/input';
import {type HangarEntity} from './entities/hangar.entity.js';
import {type PlayerShipEntity} from './entities/player-ship.entity.js';
import {type GameInputAction} from './game-action.js';
import {type ExamplePauseMenuModState} from './mods/pause-menu.mod.js';
import {type ExampleSaveStateStore} from './mods/save-state.mod.js';
import {type SaveState} from './save-state.js';

export type FullExampleGameState = AnthaEntity2dModState<
    {
        saveState: SaveState;
        loadPromise: Promise<any> | undefined;
        saveStateStore: ExampleSaveStateStore;
        hangarEntity: undefined | HangarEntity;
        playerEntities: Record<string, PlayerShipEntity>;
    } & AnthaAssetModState &
        ExamplePauseMenuModState &
        AnthaInputBindingsModState<GameInputAction>
>;
