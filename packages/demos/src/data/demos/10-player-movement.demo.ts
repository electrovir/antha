import {createAnthaAssetMod} from '@antha/asset';
import {AnthaEngine, SkipExecution, defineAnthaMod, type ModExecuteParams} from '@antha/engine';
import {
    createAnthaEntity2dSuite,
    position2dParamsMap,
    position2dParamsShape,
    type AnthaEntity2dModState,
} from '@antha/entity-2d';
import {createAnthaFpsMod} from '@antha/fps';
import {createAnthaGraphics2dMod} from '@antha/graphics-2d';
import {
    AnyGamepad,
    InputDirection,
    createAnthaInputBindingsMod,
    createAnthaReadRawInputMod,
    getDirectionalInputVector,
    type AnthaInputBindingsModState,
} from '@antha/input';
import {clamp} from '@augment-vir/common';
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

const {defineEntity, updateEntitiesMod} = createAnthaEntity2dSuite<PlayerMovementGameState>({});

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
        const movement = getDirectionalInputVector({
            activeBindings: this.state.activeBindings['1'],
            bindingNames: {
                down: PlayerAction.Down,
                left: PlayerAction.Left,
                right: PlayerAction.Right,
                up: PlayerAction.Up,
            },
        });

        if (movement) {
            this.params.x += movement.x * msSinceLastExecute * 0.4;
            this.params.y += movement.y * msSinceLastExecute * 0.4;
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
            mods: [
                createAnthaGraphics2dMod(),
                createAnthaFpsMod(),
                createAnthaAssetMod(),
                updateEntitiesMod,
                createAnthaReadRawInputMod(),
                createAnthaInputBindingsMod<PlayerAction>({
                    bindingAssignments,
                }),
                playerMovementMod,
            ],
        });
    },
};
