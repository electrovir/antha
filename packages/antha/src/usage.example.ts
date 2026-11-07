import {defineAnthaMod, SkipExecution} from '@antha/engine';
import {BodyType} from '@antha/entity-2d';
import {Graphics} from '@antha/graphics-2d';
import {
    AnyGamepad,
    getDirectionalInputVector,
    InputDirection,
    type PlayersActiveBindings,
} from '@antha/input';
import {LocalPlayerPosition} from '@antha/util';
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
        [LocalPlayerPosition.One]: {
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
    physics: {
        type: BodyType.Kinematic,
    },
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
    public override async createView() {
        return {
            view: await this.getAsset.sprite(),
        };
    }

    public override update() {
        this.physics.setVelocity(calculatePlayerVelocity(this.state.activeBindings));

        const position = this.physics.getPosition();
        const clampedPosition = {
            x: clamp(position.x, {
                min: triangleSize * 0.7,
                max: this.pixi.screen.width - triangleSize * 0.7,
            }),
            y: clamp(position.y, {
                min: triangleSize,
                max: this.pixi.screen.height - triangleSize,
            }),
        };

        if (clampedPosition.x !== position.x || clampedPosition.y !== position.y) {
            this.physics.setPosition(clampedPosition);
        }
    }
}

/** Pixels per second. */
const playerSpeed = 400;

function calculatePlayerVelocity(activeBindings: Readonly<PlayersActiveBindings<PlayerAction>>) {
    const movement = getDirectionalInputVector({
        activeBindings: activeBindings[LocalPlayerPosition.One],
        bindingNames: {
            down: PlayerAction.Down,
            left: PlayerAction.Left,
            right: PlayerAction.Right,
            up: PlayerAction.Up,
        },
    });

    return {
        x: (movement?.x ?? 0) * playerSpeed,
        y: (movement?.y ?? 0) * playerSpeed,
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
                position: {
                    x: state.pixi.pixiApplication.screen.width / 2,
                    y: state.pixi.pixiApplication.screen.height / 2,
                },
            });
        }

        return undefined;
    },
});

engine.currentMods.push(myGame);
engine.startLoop();
