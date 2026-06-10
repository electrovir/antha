import {createAnthaAssetMod} from '@antha/asset';
import {AnthaEngine, SkipExecution, defineAnthaMod} from '@antha/engine';
import {
    createAnthaEntityMod2d,
    position2dParamsMap,
    position2dParamsShape,
    type AnthaEntity2dModState,
    type EntityUpdateParams,
} from '@antha/entity-2d';
import {createAnthaFpsMod} from '@antha/fps';
import {createAnthaGraphics2dMod} from '@antha/graphics-2d';
import {
    AnyGamepad,
    InputDirection,
    createAnthaInputBindingsMod,
    createAnthaReadRawInputMod,
    type AnthaInputBindingsModState,
    type PlayersActiveBindings,
} from '@antha/input';
import {clamp, type Coords} from '@augment-vir/common';
import {createUtcFullDate} from 'date-vir';
import {Graphics} from 'pixi.js';
import {type AnthaDemo} from '../demo.js';

enum PlayerAction {
    Up = 'up',
    Down = 'down',
    Left = 'left',
    Right = 'right',
}

type PlayerMovementGameState = {
    player: PlayerEntity;
} & AnthaInputBindingsModState<PlayerAction>;

const {mod: entityStoreMod, defineEntity} = createAnthaEntityMod2d<PlayerMovementGameState>({});

const triangleSize = 20;

class PlayerEntity extends defineEntity({
    key: 'player',
    paramsShape: position2dParamsShape,
    paramsMap: position2dParamsMap,
    assets: {
        sprite: {
            maxProgress: 1,
            load({incrementProgressCallback}) {
                const triangle = new Graphics();
                triangle
                    .poly([
                        0,
                        -triangleSize,
                        -triangleSize * 0.7,
                        triangleSize,
                        triangleSize * 0.7,
                        triangleSize,
                    ])
                    .fill('#44ff44');

                incrementProgressCallback();

                return {
                    value: triangle,
                };
            },
        },
    },
}) {
    public async createView() {
        return {
            view: await this.getAsset.sprite(),
        };
    }

    public override update({msSinceLastUpdate}: Readonly<EntityUpdateParams>) {
        const moveDiff = calculatePlayerMovement(msSinceLastUpdate, this.state.activeBindings);

        if (moveDiff) {
            this.params.x += moveDiff.x;
            this.params.y += moveDiff.y;
        }

        this.params.x = clamp(this.params.x, {
            min: triangleSize * 0.7,
            max: this.pixi.screen.width - triangleSize * 0.7,
        });
        this.params.y = clamp(this.params.y, {
            min: triangleSize,
            max: this.pixi.screen.height - triangleSize,
        });
    }
}

/**
 * Set player X and Y movement based on which input was most recently triggered, and ensure that the
 * movement vector's magnitude remains constant.
 */
function calculatePlayerMovement(
    msSinceLastUpdate: number,
    activeBindings: Readonly<PlayersActiveBindings<PlayerAction>>,
) {
    const playerBindings = activeBindings['1'];

    if (!playerBindings) {
        return;
    }

    const upMovement = {
        value: playerBindings.up?.value || 0,
        durationMs: playerBindings.up?.holdDuration.milliseconds || Infinity,
    };
    const downMovement = {
        value: playerBindings.down?.value || 0,
        durationMs: playerBindings.down?.holdDuration.milliseconds || Infinity,
    };
    const leftMovement = {
        value: playerBindings.left?.value || 0,
        durationMs: playerBindings.left?.holdDuration.milliseconds || Infinity,
    };
    const rightMovement = {
        value: playerBindings.right?.value || 0,
        durationMs: playerBindings.right?.holdDuration.milliseconds || Infinity,
    };

    const movementY =
        upMovement.value && upMovement.durationMs < downMovement.durationMs
            ? -upMovement.value
            : downMovement.value && downMovement.durationMs < upMovement.durationMs
              ? downMovement.value
              : 0;

    const movementX =
        leftMovement.value && leftMovement.durationMs < rightMovement.durationMs
            ? -leftMovement.value
            : rightMovement.value && rightMovement.durationMs < leftMovement.durationMs
              ? rightMovement.value
              : 0;

    const movement: Coords = {
        x: movementX,
        y: movementY,
    };

    const magnitude = Math.hypot(movement.x, movement.y);

    if (magnitude > 0) {
        const normalized: Coords = {
            x: movement.x / magnitude,
            y: movement.y / magnitude,
        };
        return {
            x: normalized.x * msSinceLastUpdate * 0.4,
            y: normalized.y * msSinceLastUpdate * 0.4,
        };
    }

    return undefined;
}

const bindingAssignments: Readonly<AnthaInputBindingsModState<PlayerAction>['bindingAssignments']> =
    {
        1: {
            [PlayerAction.Up]: [
                {
                    deviceKey: AnyGamepad,
                    direction: InputDirection.Positive,
                    inputName: 'd-pad-up',
                },
                {
                    deviceKey: 'keyboard',
                    direction: InputDirection.Positive,
                    inputName: 'button-KeyW',
                },
                {
                    deviceKey: 'keyboard',
                    direction: InputDirection.Positive,
                    inputName: 'button-KeyI',
                },
                {
                    deviceKey: 'keyboard',
                    direction: InputDirection.Positive,
                    inputName: 'button-ArrowUp',
                },
            ],
            [PlayerAction.Down]: [
                {
                    deviceKey: AnyGamepad,
                    direction: InputDirection.Positive,
                    inputName: 'd-pad-down',
                },
                {
                    deviceKey: 'keyboard',
                    direction: InputDirection.Positive,
                    inputName: 'button-KeyS',
                },
                {
                    deviceKey: 'keyboard',
                    direction: InputDirection.Positive,
                    inputName: 'button-KeyK',
                },
                {
                    deviceKey: 'keyboard',
                    direction: InputDirection.Positive,
                    inputName: 'button-ArrowDown',
                },
            ],
            [PlayerAction.Left]: [
                {
                    deviceKey: AnyGamepad,
                    direction: InputDirection.Positive,
                    inputName: 'd-pad-left',
                },
                {
                    deviceKey: 'keyboard',
                    direction: InputDirection.Positive,
                    inputName: 'button-KeyA',
                },
                {
                    deviceKey: 'keyboard',
                    direction: InputDirection.Positive,
                    inputName: 'button-KeyJ',
                },
                {
                    deviceKey: 'keyboard',
                    direction: InputDirection.Positive,
                    inputName: 'button-ArrowLeft',
                },
            ],
            [PlayerAction.Right]: [
                {
                    deviceKey: AnyGamepad,
                    direction: InputDirection.Positive,
                    inputName: 'd-pad-right',
                },
                {
                    deviceKey: 'keyboard',
                    direction: InputDirection.Positive,
                    inputName: 'button-KeyD',
                },
                {
                    deviceKey: 'keyboard',
                    direction: InputDirection.Positive,
                    inputName: 'button-KeyL',
                },
                {
                    deviceKey: 'keyboard',
                    direction: InputDirection.Positive,
                    inputName: 'button-ArrowRight',
                },
            ],
        },
    };

type PlayerMovementState = AnthaEntity2dModState<PlayerMovementGameState> &
    AnthaInputBindingsModState<PlayerAction>;

const playerMovementMod = defineAnthaMod<PlayerMovementState>({
    modName: 'demo-player-movement',
    async execute({state}) {
        if (!state.entityStore || !state.pixi?.pixiApplication) {
            return SkipExecution;
        }
        if (!state.player) {
            state.player = await state.entityStore.addEntity(PlayerEntity, {
                x: state.pixi.pixiApplication.screen.width / 2,
                y: state.pixi.pixiApplication.screen.height / 2,
            });
        }

        return undefined;
    },
});

export const playerMovementDemo: AnthaDemo = {
    demoName: 'Player Movement',
    demoPathId: 'player-movement',
    demoSortDate: createUtcFullDate('2026-04-04'),
    engine() {
        return new AnthaEngine({
            initState: {
                bindingAssignments,
            } satisfies Partial<AnthaInputBindingsModState<PlayerAction>>,
            mods: [
                createAnthaGraphics2dMod({
                    dynamicCanvasSize: true,
                }),
                createAnthaFpsMod(),
                createAnthaAssetMod(),
                entityStoreMod,
                createAnthaReadRawInputMod(),
                createAnthaInputBindingsMod<PlayerAction>(),
                playerMovementMod,
            ],
        });
    },
};
