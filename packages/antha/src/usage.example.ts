import {defineAnthaMod, type ModExecuteParams, SkipExecution} from '@antha/engine';
import {position2dParamsMap, position2dParamsShape} from '@antha/entity-2d';
import {Graphics} from '@antha/graphics-2d';
import {
    AnyGamepad,
    getDirectionalInputVector,
    InputDirection,
    PlayerPosition,
    type PlayersActiveBindings,
} from '@antha/input';
import {clamp} from '@augment-vir/common';
import {createDefaultAnthaEngine} from './default-engine.js';

enum PlayerAction {
    Up = 'up',
    Down = 'down',
    Left = 'left',
    Right = 'right',
}

const {defineEntity, engine, StateType} = createDefaultAnthaEngine<
    {
        player: PlayerEntity;
    },
    PlayerAction
>({
    bindingAssignments: {
        [PlayerPosition.One]: {
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
    },
});

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

    public override update({msSinceLastExecute}: Readonly<ModExecuteParams>) {
        const moveDiff = calculatePlayerMovement(msSinceLastExecute, this.state.activeBindings);

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

function calculatePlayerMovement(
    msSinceLastUpdate: number,
    activeBindings: Readonly<PlayersActiveBindings<PlayerAction>>,
) {
    const movement = getDirectionalInputVector({
        activeBindings: activeBindings[PlayerPosition.One],
        bindingNames: {
            down: PlayerAction.Down,
            left: PlayerAction.Left,
            right: PlayerAction.Right,
            up: PlayerAction.Up,
        },
    });

    if (!movement) {
        return undefined;
    }

    return {
        x: movement.x * msSinceLastUpdate * 0.4,
        y: movement.y * msSinceLastUpdate * 0.4,
    };
}

const myGame = defineAnthaMod<typeof StateType>({
    modName: 'my-game',
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

engine.currentMods.push(myGame);
engine.startLoop();
