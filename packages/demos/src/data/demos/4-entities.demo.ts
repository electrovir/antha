import {createAnthaAssetMod} from '@antha/asset';
/* eslint-disable sonarjs/pseudo-random */
import {AnthaEngine, SkipExecution, type AnthaMod} from '@antha/engine';
import {
    BodyType,
    createAnthaEntity2dSuite,
    EntityEvent,
    ShapeType,
    type AnthaEntity2dModState,
    type BaseEntity2d,
    type EntityStore2d,
    type ViewCreation2d,
} from '@antha/entity-2d';
import {createAnthaFpsMod} from '@antha/fps';
import {createAnthaGraphics2dMod} from '@antha/graphics-2d';
import {assert, assertWrap} from '@augment-vir/assert';
import {clamp, executeCount, randomInteger} from '@augment-vir/common';
import {createUtcFullDate} from 'date-vir';
import {css, html, listen} from 'element-vir';
import {defineShape} from 'object-shape-tester';
import {Graphics} from 'pixi.js';
import {ViraButton, ViraColorVariant} from 'vira';
import {type AnthaDemo} from '../demo.js';

/** Multiplier for all game speeds. >1 = faster, <1 = slower. */
const gameSpeed = 2;
const baselineFrameMs = 1000 / 60;

function calculateGameTickDelta(msSinceLastUpdate: number): number {
    return (msSinceLastUpdate / baselineFrameMs) * gameSpeed;
}

/** Multiply a speed in pixels per baseline frame by this to get pixels per second. */
const baselineFramesPerSecond = (1000 / baselineFrameMs) * gameSpeed;

/** Moves a coordinate that left the screen to the opposite edge. */
function wrapCoordinate({
    value,
    size,
    max,
}: Readonly<{
    value: number;
    size: number;
    max: number;
}>) {
    if (value < -size) {
        return max + size;
    } else if (value > max + size) {
        return -size;
    } else {
        return value;
    }
}

type AsteroidsGameState = {
    score: number;
    gameOver: boolean;
    spawnTickCounter: number;
    totalTicks: number;
    listenersInitialized: boolean;
};

class PlayerDeathEvent extends EntityEvent<void> {}
class AsteroidHitEvent extends EntityEvent<{score: number}> {}

const {defineEntity, updateEntitiesMod} = createAnthaEntity2dSuite<AsteroidsGameState>({});

class AsteroidEntity extends defineEntity({
    key: 'Asteroid',
    paramsShape: defineShape({
        size: 30,
    }),
    physics(params) {
        return {
            type: BodyType.Dynamic,
            shapes: [
                {
                    type: ShapeType.Circle,
                    radius: params.size,
                },
            ],
        };
    },
}) {
    public static readonly minAsteroidSize = 7;
    public static readonly initialSpawnInterval = 120;
    public static readonly minSpawnInterval = 20;
    public static readonly spawnAccelerationRate = 0.02;

    public override createView(): ViewCreation2d {
        const graphic = new Graphics();
        graphic.circle(0, 0, this.params.size).fill('#888888');

        return {
            view: graphic,
        };
    }

    public override update() {
        const position = this.physics.getPosition();
        const wrappedPosition = {
            x: wrapCoordinate({
                value: position.x,
                size: this.params.size,
                max: this.pixi.screen.width,
            }),
            y: wrapCoordinate({
                value: position.y,
                size: this.params.size,
                max: this.pixi.screen.height,
            }),
        };

        if (wrappedPosition.x !== position.x || wrappedPosition.y !== position.y) {
            this.physics.setPosition(wrappedPosition);
        }
    }

    public override async contactStart(otherEntity: BaseEntity2d): Promise<void> {
        /** Two bullets can hit the same asteroid in one step. */
        if (otherEntity instanceof PlayerBulletEntity && !this.isDestroyed) {
            const scoreValue = Math.floor(100 / this.params.size);

            this.dispatch(
                new AsteroidHitEvent({
                    entityInstance: this,
                    data: {
                        score: scoreValue,
                    },
                }),
            );

            const halfSize = Math.floor(this.params.size / 3);

            if (halfSize >= AsteroidEntity.minAsteroidSize) {
                const position = this.physics.getPosition();
                const velocity = this.physics.getVelocity();

                await this.addEntity(AsteroidEntity, {
                    params: {
                        size: halfSize,
                    },
                    position,
                    velocity: {
                        x: velocity.y + (Math.random() - 0.5) * baselineFramesPerSecond,
                        y: -velocity.x + (Math.random() - 0.5) * baselineFramesPerSecond,
                    },
                });
                await this.addEntity(AsteroidEntity, {
                    params: {
                        size: halfSize,
                    },
                    position,
                    velocity: {
                        x: -velocity.y + (Math.random() - 0.5) * baselineFramesPerSecond,
                        y: velocity.x + (Math.random() - 0.5) * baselineFramesPerSecond,
                    },
                });
            }

            otherEntity.destroy();
            this.destroy();
        }
    }
}

const bulletRadius = 3;

class PlayerBulletEntity extends defineEntity({
    key: 'PlayerBullet',
    physics: {
        type: BodyType.Dynamic,
        shapes: [
            {
                type: ShapeType.Circle,
                radius: bulletRadius,
            },
        ],
    },
    touches: [
        AsteroidEntity,
    ],
}) {
    /** Pixels per second. */
    public static readonly bulletSpeed = 8 * baselineFramesPerSecond;

    public override createView(): ViewCreation2d {
        const graphic = new Graphics();
        graphic.circle(0, 0, bulletRadius).fill('#ffffff');

        return {
            view: graphic,
        };
    }

    public override update() {
        if (!this.isInBounds()) {
            this.destroy();
        }
    }
}

const playerSize = 14;

class PlayerEntity extends defineEntity({
    key: 'Player',
    physics: {
        type: BodyType.Kinematic,
        shapes: [
            {
                type: ShapeType.Circle,
                radius: playerSize * 0.8,
            },
        ],
    },
    touches: [
        AsteroidEntity,
    ],
}) {
    /** Pixels per second. */
    public static readonly playerSpeed = 2 * baselineFramesPerSecond;
    public static readonly playerShootInterval = 30;
    public static readonly maxTurnRate = 0.05;
    public static readonly borderMargin = 40;
    public static readonly stopDistance = 100;
    protected shootCooldown = 0;

    /**
     * Solve for the time t at which a bullet fired from the player can intercept a moving target.
     * Returns the smallest positive root, or undefined if no intercept is possible.
     */
    protected static computeInterceptTime({
        deltaX,
        deltaY,
        targetVelocityX,
        targetVelocityY,
        bulletSpeed,
    }: Readonly<{
        deltaX: number;
        deltaY: number;
        targetVelocityX: number;
        targetVelocityY: number;
        bulletSpeed: number;
    }>): number | undefined {
        const a = targetVelocityX ** 2 + targetVelocityY ** 2 - bulletSpeed ** 2;
        const b = 2 * (deltaX * targetVelocityX + deltaY * targetVelocityY);
        const c = deltaX ** 2 + deltaY ** 2;

        const discriminant = b ** 2 - 4 * a * c;

        if (discriminant < 0) {
            return undefined;
        }

        const sqrtD = Math.sqrt(discriminant);

        /** Near-zero `a` means asteroid and bullet speeds are nearly equal; degenerate to linear. */
        if (Math.abs(a) < 1e-10) {
            const t = -c / b;
            return t > 0 ? t : undefined;
        }

        const t1 = (-b - sqrtD) / (2 * a);
        const t2 = (-b + sqrtD) / (2 * a);

        const candidates = [
            t1,
            t2,
        ].filter((t) => {
            return t > 0;
        });

        return candidates.length > 0 ? Math.min(...candidates) : undefined;
    }

    public override createView(): ViewCreation2d {
        const graphic = new Graphics();
        graphic
            .poly([
                playerSize,
                0,
                -playerSize,
                -playerSize * 0.7,
                -playerSize,
                playerSize * 0.7,
            ])
            .fill('#44ff44');

        return {
            view: graphic,
        };
    }

    public override async update(): Promise<void> {
        const gameTickDelta = calculateGameTickDelta(this.entityStore.stepDuration.milliseconds);

        this.shootCooldown += gameTickDelta;

        const {width: screenWidth, height: screenHeight} = this.pixi.screen;
        const position = this.physics.getPosition();
        const direction = this.physics.getRotation();

        const closestAsteroid = Array.from(this.entityStore.getEntities(AsteroidEntity))
            .map((asteroid) => {
                const asteroidPosition = asteroid.physics.getPosition();

                return {
                    asteroid,
                    position: asteroidPosition,
                    distance: Math.hypot(
                        asteroidPosition.x - position.x,
                        asteroidPosition.y - position.y,
                    ),
                };
            })
            .filter((entry) => {
                return (
                    entry.position.x > PlayerEntity.borderMargin &&
                    entry.position.x < screenWidth - PlayerEntity.borderMargin &&
                    entry.position.y > PlayerEntity.borderMargin &&
                    entry.position.y < screenHeight - PlayerEntity.borderMargin
                );
            })
            .reduce<
                | {
                      asteroid: AsteroidEntity;
                      position: {x: number; y: number};
                      distance: number;
                  }
                | undefined
            >((closest, entry) => {
                return !closest || entry.distance < closest.distance ? entry : closest;
            }, undefined);

        if (!closestAsteroid) {
            this.physics.setVelocity({
                x: 0,
                y: 0,
            });
            this.physics.setAngularVelocity(0);
            return;
        }

        const deltaX = closestAsteroid.position.x - position.x;
        const deltaY = closestAsteroid.position.y - position.y;
        const asteroidVelocity = closestAsteroid.asteroid.physics.getVelocity();

        /** Predict where the asteroid will be when a bullet could reach it. */
        const interceptTime = PlayerEntity.computeInterceptTime({
            deltaX,
            deltaY,
            targetVelocityX: asteroidVelocity.x,
            targetVelocityY: asteroidVelocity.y,
            bulletSpeed: PlayerBulletEntity.bulletSpeed,
        });

        const targetAngle =
            interceptTime == undefined
                ? Math.atan2(deltaY, deltaX)
                : Math.atan2(
                      deltaY + asteroidVelocity.y * interceptTime,
                      deltaX + asteroidVelocity.x * interceptTime,
                  );

        /** Compute shortest signed angle difference, wrapping around ±π. */
        const angleDiff = Math.atan2(
            Math.sin(targetAngle - direction),
            Math.cos(targetAngle - direction),
        );

        const maxTurn = PlayerEntity.maxTurnRate * gameTickDelta;
        const turn = clamp(angleDiff, {
            min: -maxTurn,
            max: maxTurn,
        });
        this.physics.setAngularVelocity(turn / (this.entityStore.stepDuration.milliseconds / 1000));

        /** Move forward normally, or retreat when too close to an asteroid. */
        const heading = direction + turn;
        const moveSpeed =
            closestAsteroid.distance > PlayerEntity.stopDistance
                ? PlayerEntity.playerSpeed
                : -PlayerEntity.playerSpeed;
        this.physics.setVelocity({
            x: Math.cos(heading) * moveSpeed,
            y: Math.sin(heading) * moveSpeed,
        });

        if (this.shootCooldown >= PlayerEntity.playerShootInterval) {
            this.shootCooldown = 0;
            const muzzleDistance = playerSize + bulletRadius + 2;
            await this.addEntity(PlayerBulletEntity, {
                position: {
                    x: position.x + Math.cos(heading) * muzzleDistance,
                    y: position.y + Math.sin(heading) * muzzleDistance,
                },
                velocity: {
                    x: Math.cos(heading) * PlayerBulletEntity.bulletSpeed,
                    y: Math.sin(heading) * PlayerBulletEntity.bulletSpeed,
                },
            });
        }
    }

    public override contactStart(otherEntity: BaseEntity2d): void {
        if (otherEntity instanceof AsteroidEntity && !this.isDestroyed) {
            this.dispatch(
                new PlayerDeathEvent({
                    entityInstance: this,
                }),
            );
            this.destroy();
        }
    }
}

type AsteroidsState = AnthaEntity2dModState<AsteroidsGameState>;

async function spawnAsteroidFromEdge(
    entityStore: EntityStore2d<Partial<AsteroidsState>>,
): Promise<void> {
    const edgeIndex = randomInteger({
        min: 0,
        max: 3,
    });
    const size = randomInteger({
        min: 20,
        max: 50,
    });
    const speed = 0.5 + Math.random() * 1.5;
    const {width: screenWidth, height: screenHeight} = entityStore.pixi.screen;

    const edgeSpawners: Record<
        number,
        () => {x: number; y: number; directionX: number; directionY: number}
    > = {
        /** Top edge. */
        0() {
            return {
                x: randomInteger({
                    min: 0,
                    max: screenWidth,
                }),
                y: -size,
                directionX: (Math.random() - 0.5) * speed * 2,
                directionY: Math.random() * speed + 0.2,
            };
        },
        /** Right edge. */
        1() {
            return {
                x: screenWidth + size,
                y: randomInteger({
                    min: 0,
                    max: screenHeight,
                }),
                directionX: -(Math.random() * speed + 0.2),
                directionY: (Math.random() - 0.5) * speed * 2,
            };
        },
        /** Bottom edge. */
        2() {
            return {
                x: randomInteger({
                    min: 0,
                    max: screenWidth,
                }),
                y: screenHeight + size,
                directionX: (Math.random() - 0.5) * speed * 2,
                directionY: -(Math.random() * speed + 0.2),
            };
        },
        /** Left edge. */
        3() {
            return {
                x: -size,
                y: randomInteger({
                    min: 0,
                    max: screenHeight,
                }),
                directionX: Math.random() * speed + 0.2,
                directionY: (Math.random() - 0.5) * speed * 2,
            };
        },
    };

    const spawn = assertWrap.isDefined(
        edgeSpawners[edgeIndex],
        `Failed to spawn asteroid on edge ${edgeIndex}`,
    )();

    await entityStore.addEntity(AsteroidEntity, {
        params: {
            size,
        },
        position: {
            x: spawn.x,
            y: spawn.y,
        },
        velocity: {
            x: spawn.directionX * baselineFramesPerSecond,
            y: spawn.directionY * baselineFramesPerSecond,
        },
    });
}

const asteroidsGameMod: AnthaMod<AsteroidsState> = {
    modName: 'asteroids-game',
    async execute({state, engine, msSinceLastExecute}) {
        /** Save off for type guarding purposes. */
        const entityStore = state.entityStore;
        if (!entityStore) {
            return SkipExecution;
        }

        if (state.score == undefined) {
            state.score = 0;
            state.gameOver = false;
            state.spawnTickCounter = 0;
            state.totalTicks = 0;

            await entityStore.addEntity(PlayerEntity, {
                position: {
                    x: entityStore.pixi.screen.width / 2,
                    y: entityStore.pixi.screen.height / 2,
                },
            });

            /** Spawn initial asteroids. */
            await executeCount(5, async () => {
                await spawnAsteroidFromEdge(entityStore);
            });
        }

        /** Set up event listeners once, separate from per-game init. */
        if (!state.listenersInitialized) {
            state.listenersInitialized = true;

            entityStore.listenTarget.listen(AsteroidHitEvent, (event) => {
                assert.tsType(event.detail.data).equals<{
                    score: number;
                }>();
                state.score = (state.score ?? 0) + event.detail.data.score;
            });

            entityStore.listenTarget.listen(PlayerDeathEvent, () => {
                state.gameOver = true;
            });
        }

        if (state.gameOver) {
            return html`
                <div
                    style=${css`
                        position: absolute;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        color: white;
                        font-family: monospace;
                        text-align: center;
                        background: rgba(0, 0, 0, 0.8);
                        padding: 32px 48px;
                        border-radius: 8px;
                    `}
                >
                    <div
                        style=${css`
                            font-size: 48px;
                            margin-bottom: 16px;
                        `}
                    >
                        GAME OVER
                    </div>
                    <div
                        style=${css`
                            font-size: 24px;
                            margin-bottom: 24px;
                        `}
                    >
                        Final Score: ${String(state.score)}
                    </div>
                    <${ViraButton.assign({
                        text: 'Restart',
                        color: ViraColorVariant.Neutral,
                    })}
                        ${listen('click', async () => {
                            await engine.reset();
                            engine.startLoop();
                        })}
                    ></${ViraButton}>
                </div>
            `;
        }

        const gameTickDelta = calculateGameTickDelta(msSinceLastExecute);

        const totalTicks = (state.totalTicks ?? 0) + gameTickDelta;
        state.totalTicks = totalTicks;

        const tickCounter = (state.spawnTickCounter ?? 0) + gameTickDelta;
        state.spawnTickCounter = tickCounter;

        /** Spawn interval shrinks over time, creating increasing difficulty. */
        const currentSpawnInterval = Math.max(
            AsteroidEntity.minSpawnInterval,
            Math.floor(
                AsteroidEntity.initialSpawnInterval -
                    totalTicks * AsteroidEntity.spawnAccelerationRate,
            ),
        );

        if (tickCounter >= currentSpawnInterval) {
            state.spawnTickCounter = 0;
            await spawnAsteroidFromEdge(entityStore);
        }

        return html`
            <div
                style=${css`
                    position: absolute;
                    top: 8px;
                    left: 50%;
                    transform: translateX(-50%);
                    color: white;
                    font-family: monospace;
                    font-size: 20px;
                `}
            >
                Score: ${String(state.score)}
            </div>
        `;
    },
};

export const entitiesDemo: AnthaDemo = {
    demoName: 'Entities',
    demoPathId: 'entities',
    demoSortDate: createUtcFullDate('2026-03-07T00:00:00.000Z'),
    engine() {
        return new AnthaEngine({
            mods: [
                createAnthaGraphics2dMod({
                    extraCanvasStyles: css`
                        border: 2px solid red;
                    `,
                }),
                createAnthaFpsMod({
                    debugFps: true,
                }),
                createAnthaAssetMod(),
                updateEntitiesMod,
                asteroidsGameMod,
            ],
        });
    },
};
