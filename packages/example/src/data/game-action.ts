import {MenuNavBinding} from '@antha/input';
import {type ClientId} from '@antha/multiplayer-core';
import {type Values} from '@augment-vir/common';
import {type SaveState} from './save-state.js';

export enum PlayerAction {
    PlayerLeft = 'player-left',
    PlayerRight = 'player-right',
    PlayerUp = 'player-up',
    PlayerDown = 'player-down',

    PlayerShoot = 'player-shoot',
}

export const GameInputAction = {
    ...MenuNavBinding,
    ...PlayerAction,
};
export type GameInputAction = Values<typeof GameInputAction>;

export enum GameActionType {
    PlayerAction = 'player-action',
    SyncState = 'sync-state',
    SpawnPlayer = 'spawn-player',
    DropPlayer = 'drop-player',
}

export type GameAction =
    | {
          type: GameActionType.PlayerAction;
          clientId: ClientId;
          action: PlayerAction;
      }
    | {
          type: GameActionType.SyncState;
          saveState: Readonly<SaveState>;
      }
    | {
          type: GameActionType.SpawnPlayer;
          clientId: ClientId;
      }
    | {
          type: GameActionType.DropPlayer;
          clientId: ClientId;
      };
