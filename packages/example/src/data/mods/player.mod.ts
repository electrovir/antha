import {defineAnthaMod, SkipExecution} from '@antha/engine';
import {type ActiveBindings} from '@antha/input';
import {clamp, type Coords} from '@augment-vir/common';
import {hangarBackgroundSize} from '../entities/hangar.entity.js';
import {PlayerShipEntity, playerShipSize} from '../entities/player-ship.entity.js';
import {PlayerAction} from '../game-action.js';
import {type FullExampleGameState} from '../game-state.js';
import {GameLocation, type SaveState} from '../save-state.js';

const localPlayerPosition = '1';
const playerSpeedPxPerMs = 0.9;
const hangarPlayerSpawnPosition = {
    x: 945,
    y: 190,
};

type SaveStatePlayer = {
    name: string;
    position: Coords;
};

export const playerMod = defineAnthaMod<FullExampleGameState>({
    modName: 'example-player',
    initState: {},
    async execute({state, msSinceLastExecute}) {
        const pixiApplication = state.pixi?.pixiApplication;

        if (!state.entityStore || !state.saveState || !pixiApplication) {
            return SkipExecution;
        }

        if (!state.playerEntities) {
            state.playerEntities = {};
        }

        const entityStore = state.entityStore;
        const playerEntities = state.playerEntities;
        const saveState = state.saveState;
        const playerClampBounds = calculatePlayerClampBounds({
            saveState,
            screenSize: pixiApplication.screen,
        });

        await Promise.all(
            getPlayerEntries(saveState.players).map(
                async ([
                    playerName,
                    player,
                ]) => {
                    if (isUnsetPosition(player.position)) {
                        player.position = calculatePlayerSpawnPosition({
                            saveState,
                            screenSize: pixiApplication.screen,
                        });
                    }

                    clampPlayerPosition({
                        position: player.position,
                        bounds: playerClampBounds,
                    });

                    if (!playerEntities[playerName]) {
                        playerEntities[playerName] = await entityStore.addEntity(
                            PlayerShipEntity,
                            toEntityPosition({
                                position: player.position,
                                screenHeight: pixiApplication.screen.height,
                            }),
                        );
                    }
                },
            ),
        );

        const currentPlayer = getPlayerRecord(saveState.players)[saveState.currentPlayerName];
        const moveDiff = currentPlayer
            ? calculatePlayerMovement({
                  activeBindings: state.activeBindings?.[localPlayerPosition],
                  msSinceLastExecute,
              })
            : undefined;

        if (currentPlayer && moveDiff) {
            currentPlayer.position.x += moveDiff.x;
            currentPlayer.position.y += moveDiff.y;
            clampPlayerPosition({
                position: currentPlayer.position,
                bounds: playerClampBounds,
            });
        }

        getPlayerEntries(saveState.players).forEach(
            ([
                playerName,
                player,
            ]) => {
                const playerEntity = playerEntities[playerName];

                if (playerEntity) {
                    const entityPosition = toEntityPosition({
                        position: player.position,
                        screenHeight: pixiApplication.screen.height,
                    });

                    playerEntity.params.x = entityPosition.x;
                    playerEntity.params.y = entityPosition.y;
                }
            },
        );

        return undefined;
    },
});

function getPlayerRecord(players: SaveState['players']): Record<string, SaveStatePlayer> {
    return players satisfies SaveState['players'] as unknown as Record<string, SaveStatePlayer>;
}

function getPlayerEntries(players: SaveState['players']): [
    string,
    SaveStatePlayer,
][] {
    return Object.entries(getPlayerRecord(players));
}

function calculatePlayerMovement({
    activeBindings,
    msSinceLastExecute,
}: Readonly<{
    activeBindings: ActiveBindings<PlayerAction> | undefined;
    msSinceLastExecute: number;
}>): Coords | undefined {
    const upMovement = {
        value: activeBindings?.[PlayerAction.PlayerUp]?.value || 0,
        durationMs: activeBindings?.[PlayerAction.PlayerUp]?.holdDuration.milliseconds || Infinity,
    };
    const downMovement = {
        value: activeBindings?.[PlayerAction.PlayerDown]?.value || 0,
        durationMs:
            activeBindings?.[PlayerAction.PlayerDown]?.holdDuration.milliseconds || Infinity,
    };
    const leftMovement = {
        value: activeBindings?.[PlayerAction.PlayerLeft]?.value || 0,
        durationMs:
            activeBindings?.[PlayerAction.PlayerLeft]?.holdDuration.milliseconds || Infinity,
    };
    const rightMovement = {
        value: activeBindings?.[PlayerAction.PlayerRight]?.value || 0,
        durationMs:
            activeBindings?.[PlayerAction.PlayerRight]?.holdDuration.milliseconds || Infinity,
    };

    const movementY =
        upMovement.value && upMovement.durationMs < downMovement.durationMs
            ? upMovement.value
            : downMovement.value && downMovement.durationMs < upMovement.durationMs
              ? -downMovement.value
              : 0;

    const movementX =
        leftMovement.value && leftMovement.durationMs < rightMovement.durationMs
            ? -leftMovement.value
            : rightMovement.value && rightMovement.durationMs < leftMovement.durationMs
              ? rightMovement.value
              : 0;

    const magnitude = Math.hypot(movementX, movementY);

    if (!magnitude) {
        return undefined;
    }

    return {
        x: (movementX / magnitude) * msSinceLastExecute * playerSpeedPxPerMs,
        y: (movementY / magnitude) * msSinceLastExecute * playerSpeedPxPerMs,
    };
}

function clampPlayerPosition({
    position,
    bounds,
}: Readonly<{
    position: Coords;
    bounds: Readonly<PlayerClampBounds>;
}>): void {
    position.x = clamp(position.x, {
        min: bounds.left + playerShipSize,
        max: bounds.right - playerShipSize,
    });
    position.y = clamp(position.y, {
        min: bounds.bottom + playerShipSize,
        max: bounds.top - playerShipSize,
    });
}

type PlayerClampBounds = {
    left: number;
    right: number;
    bottom: number;
    top: number;
};

type LocationPlayerParams = Readonly<{
    screenSize: Readonly<{
        width: number;
        height: number;
    }>;
}>;

const spawnPositionByLocation: Record<GameLocation, (params: LocationPlayerParams) => Coords> = {
    [GameLocation.Hangar]({screenSize}) {
        const hangarBounds = calculateHangarPlayerClampBounds({
            screenSize,
        });
        const scale = Math.min(
            screenSize.width / hangarBackgroundSize.width,
            screenSize.height / hangarBackgroundSize.height,
        );

        return {
            x: hangarBounds.left + hangarPlayerSpawnPosition.x * scale,
            y: hangarBounds.bottom + hangarPlayerSpawnPosition.y * scale,
        };
    },
};

const clampBoundsByLocation: Record<
    GameLocation,
    (params: LocationPlayerParams) => PlayerClampBounds
> = {
    [GameLocation.Hangar]: calculateHangarPlayerClampBounds,
};

function isUnsetPosition(position: Readonly<Coords>): boolean {
    return !position.x && !position.y;
}

function calculatePlayerSpawnPosition({
    saveState,
    screenSize,
}: Readonly<{
    saveState: Readonly<SaveState>;
    screenSize: Readonly<{
        width: number;
        height: number;
    }>;
}>): Coords {
    return spawnPositionByLocation[saveState.location]({
        screenSize,
    });
}

function calculatePlayerClampBounds({
    saveState,
    screenSize,
}: Readonly<{
    saveState: Readonly<SaveState>;
    screenSize: Readonly<{
        width: number;
        height: number;
    }>;
}>): PlayerClampBounds {
    return clampBoundsByLocation[saveState.location]({
        screenSize,
    });
}

function calculateHangarPlayerClampBounds({screenSize}: LocationPlayerParams): PlayerClampBounds {
    const scale = Math.min(
        screenSize.width / hangarBackgroundSize.width,
        screenSize.height / hangarBackgroundSize.height,
    );
    const scaledWidth = hangarBackgroundSize.width * scale;
    const scaledHeight = hangarBackgroundSize.height * scale;
    const left = (screenSize.width - scaledWidth) / 2;
    const bottom = (screenSize.height - scaledHeight) / 2;

    return {
        left,
        right: left + scaledWidth,
        bottom,
        top: bottom + scaledHeight,
    };
}

function toEntityPosition({
    position,
    screenHeight,
}: Readonly<{
    position: Readonly<Coords>;
    screenHeight: number;
}>): Coords {
    return {
        x: position.x,
        y: screenHeight - position.y,
    };
}
