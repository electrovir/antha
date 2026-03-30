/* eslint-disable sonarjs/pseudo-random */
import {
    createAnthaEntityStoreMod,
    EntityEvent,
    standardParamsMap,
    type AnthaEntityStoreModState,
    type BaseEntity,
    type EntityStore,
    type ViewCreation,
} from '@antha/entity';
import {createAnthaPixiCanvasMod, createAnthaPixiFpsMod} from '@antha/pixi-canvas';
import {assertWrap} from '@augment-vir/assert';
import {executeCount, randomInteger} from '@augment-vir/common';
import {AnthaEngine, SkipExecution, type AnthaMod} from 'antha';
import {createUtcFullDate} from 'date-vir';
import {Circle, Polygon} from 'detect-collisions';
import {css, html, listen} from 'element-vir';
import {defineShape} from 'object-shape-tester';
import {Graphics} from 'pixi.js';
import {ViraButton, ViraColorVariant} from 'vira';
import {type AnthaDemo} from '../demo.js';

/** Multiplier for all game speeds. >1 = faster, <1 = slower. */
const gameSpeed = 2;

type AsteroidsGameState = {
    score: number;
    gameOver: boolean;
    spawnTickCounter: number;
    totalTicks: number;
    listenersInitialized: boolean;
};

class PlayerDeathEvent extends EntityEvent<void> {}
class AsteroidHitEvent extends EntityEvent<{score: number}> {}

const {mod: entityStoreMod, defineEntity} = createAnthaEntityStoreMod<AsteroidsGameState>({});

class AsteroidEntity extends defineEntity({
    key: 'Asteroid',
    paramsShape: defineShape({
        x: 0,
        y: 0,
        directionX: 0,
        directionY: 0,
        size: 30,
    }),
    paramsMap: standardParamsMap,
}) {
    public static readonly minAsteroidSize = 7;
    public static readonly initialSpawnInterval = 120;
    public static readonly minSpawnInterval = 20;
    public static readonly spawnAccelerationRate = 0.02;

    public override createView(): ViewCreation {
        const graphic = new Graphics();
        graphic.circle(0, 0, this.params.size).fill('#888888');

        return {
            view: graphic,
            hitbox: new Circle(
                {
                    x: this.params.x,
                    y: this.params.y,
                },
                this.params.size,
            ),
        };
    }

    public override update(): void {
        /** Move the asteroid. */

        this.params.x += this.params.directionX * gameSpeed;
        this.params.y += this.params.directionY * gameSpeed;

        const {width: screenWidth, height: screenHeight} = this.pixi.screen;

        if (this.params.x < -this.params.size) {
            this.params.x = screenWidth + this.params.size;
        } else if (this.params.x > screenWidth + this.params.size) {
            this.params.x = -this.params.size;
        }

        if (this.params.y < -this.params.size) {
            this.params.y = screenHeight + this.params.size;
        } else if (this.params.y > screenHeight + this.params.size) {
            this.params.y = -this.params.size;
        }
    }

    public override async collide(otherEntity: BaseEntity): Promise<void> {
        if (otherEntity instanceof PlayerBulletEntity) {
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
                await this.addEntity(AsteroidEntity, {
                    x: this.params.x,
                    y: this.params.y,
                    directionX: this.params.directionY + (Math.random() - 0.5),
                    directionY: -this.params.directionX + (Math.random() - 0.5),
                    size: halfSize,
                });
                await this.addEntity(AsteroidEntity, {
                    x: this.params.x,
                    y: this.params.y,
                    directionX: -this.params.directionY + (Math.random() - 0.5),
                    directionY: this.params.directionX + (Math.random() - 0.5),
                    size: halfSize,
                });
            }

            otherEntity.destroy();
            this.destroy();
        }
    }
}

class PlayerBulletEntity extends defineEntity({
    key: 'PlayerBullet',
    paramsShape: defineShape({
        x: 0,
        y: 0,
        directionX: 0,
        directionY: 0,
    }),
    paramsMap: standardParamsMap,
}) {
    public static readonly bulletRadius = 3;
    public static readonly bulletSpeed = 8;

    public override createView(): ViewCreation {
        const graphic = new Graphics();
        graphic.circle(0, 0, PlayerBulletEntity.bulletRadius).fill('#ffffff');

        return {
            view: graphic,
            hitbox: new Circle(
                {
                    x: this.params.x,
                    y: this.params.y,
                },
                PlayerBulletEntity.bulletRadius,
            ),
        };
    }

    public override update(): void {
        this.params.x += this.params.directionX * gameSpeed;
        this.params.y += this.params.directionY * gameSpeed;

        const {width: screenWidth, height: screenHeight} = this.pixi.screen;

        if (
            this.params.x < -PlayerBulletEntity.bulletRadius ||
            this.params.x > screenWidth + PlayerBulletEntity.bulletRadius ||
            this.params.y < -PlayerBulletEntity.bulletRadius ||
            this.params.y > screenHeight + PlayerBulletEntity.bulletRadius
        ) {
            this.destroy();
        }
    }
}

class PlayerEntity extends defineEntity({
    key: 'Player',
    paramsShape: defineShape({
        x: 0,
        y: 0,
        direction: 0,
    }),
    paramsMap: {
        hitbox: {
            x: true,
            y: true,
        },
        view: {
            x: true,
            y: true,
            rotation: 'direction',
        },
    },
}) {
    public static readonly playerSize = 14;
    public static readonly playerSpeed = 2;
    public static readonly playerShootInterval = 30;
    public static readonly maxTurnRate = 0.05;
    public static readonly borderMargin = 40;
    public static readonly stopDistance = 100;
    private shootCooldown = 0;

    /**
     * Solve for the time t at which a bullet fired from the player can intercept a moving target.
     * Returns the smallest positive root, or undefined if no intercept is possible.
     */
    private static computeInterceptTime({
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

    public override createView(): ViewCreation {
        const trianglePoints: [number, number][] = [
            [
                PlayerEntity.playerSize,
                0,
            ],
            [
                -PlayerEntity.playerSize,
                -PlayerEntity.playerSize * 0.7,
            ],
            [
                -PlayerEntity.playerSize,
                PlayerEntity.playerSize * 0.7,
            ],
        ];

        const graphic = new Graphics();
        graphic.poly(trianglePoints.flat()).fill('#44ff44');

        return {
            view: graphic,
            hitbox: new Polygon(
                {
                    x: this.params.x,
                    y: this.params.y,
                },
                trianglePoints.map(
                    ([
                        pointX,
                        pointY,
                    ]) => {
                        return {
                            x: pointX,
                            y: pointY,
                        };
                    },
                ),
            ),
        };
    }

    public override async update(): Promise<void> {
        this.shootCooldown += gameSpeed;

        const {width: screenWidth, height: screenHeight} = this.pixi.screen;

        const asteroids = Array.from(this.entityStore.getEntities(AsteroidEntity)).filter(
            (asteroid) => {
                return (
                    asteroid.params.x > PlayerEntity.borderMargin &&
                    asteroid.params.x < screenWidth - PlayerEntity.borderMargin &&
                    asteroid.params.y > PlayerEntity.borderMargin &&
                    asteroid.params.y < screenHeight - PlayerEntity.borderMargin
                );
            },
        );

        if (asteroids.length === 0) {
            return;
        }

        const closestAsteroid = asteroids.reduce<
            | {
                  asteroid: AsteroidEntity;
                  distance: number;
              }
            | undefined
        >((closest, asteroid) => {
            const distance = Math.hypot(
                asteroid.params.x - this.params.x,
                asteroid.params.y - this.params.y,
            );

            if (!closest || distance < closest.distance) {
                return {
                    asteroid,
                    distance,
                };
            }
            return closest;
        }, undefined);

        if (!closestAsteroid) {
            /** If there is no asteroid, do nothing */
            return;
        }

        const deltaX = closestAsteroid.asteroid.params.x - this.params.x;
        const deltaY = closestAsteroid.asteroid.params.y - this.params.y;

        /** Predict where the asteroid will be when a bullet could reach it. */
        const interceptTime = PlayerEntity.computeInterceptTime({
            deltaX,
            deltaY,
            targetVelocityX: closestAsteroid.asteroid.params.directionX,
            targetVelocityY: closestAsteroid.asteroid.params.directionY,
            bulletSpeed: PlayerBulletEntity.bulletSpeed,
        });

        const targetAngle =
            interceptTime == undefined
                ? Math.atan2(deltaY, deltaX)
                : Math.atan2(
                      deltaY + closestAsteroid.asteroid.params.directionY * interceptTime,
                      deltaX + closestAsteroid.asteroid.params.directionX * interceptTime,
                  );

        /** Compute shortest signed angle difference, wrapping around ±π. */
        const angleDiff = Math.atan2(
            Math.sin(targetAngle - this.params.direction),
            Math.cos(targetAngle - this.params.direction),
        );

        /** Clamp the turn to the max turn rate. */
        const maxTurn = PlayerEntity.maxTurnRate * gameSpeed;
        const turn = Math.max(-maxTurn, Math.min(maxTurn, angleDiff));
        this.params.direction += turn;

        const moveSpeed = PlayerEntity.playerSpeed * gameSpeed;

        /** Move forward normally, or retreat when too close to an asteroid. */
        if (closestAsteroid.distance > PlayerEntity.stopDistance) {
            this.params.x += Math.cos(this.params.direction) * moveSpeed;
            this.params.y += Math.sin(this.params.direction) * moveSpeed;
        } else {
            this.params.x -= Math.cos(this.params.direction) * moveSpeed;
            this.params.y -= Math.sin(this.params.direction) * moveSpeed;
        }

        if (this.shootCooldown >= PlayerEntity.playerShootInterval) {
            this.shootCooldown = 0;
            await this.addEntity(PlayerBulletEntity, {
                x:
                    this.params.x +
                    Math.cos(this.params.direction) *
                        (PlayerEntity.playerSize + PlayerBulletEntity.bulletRadius + 2),
                y:
                    this.params.y +
                    Math.sin(this.params.direction) *
                        (PlayerEntity.playerSize + PlayerBulletEntity.bulletRadius + 2),
                directionX: Math.cos(this.params.direction) * PlayerBulletEntity.bulletSpeed,
                directionY: Math.sin(this.params.direction) * PlayerBulletEntity.bulletSpeed,
            });
        }
    }

    public override collide(otherEntity: BaseEntity): void {
        if (otherEntity instanceof AsteroidEntity) {
            this.dispatch(
                new PlayerDeathEvent({
                    entityInstance: this,
                }),
            );
            this.destroy();
        }
    }
}

type AsteroidsState = AnthaEntityStoreModState<AsteroidsGameState>;

async function spawnAsteroidFromEdge(
    entityStore: EntityStore<Partial<AsteroidsState>>,
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
        0: () => {
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
        1: () => {
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
        2: () => {
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
        3: () => {
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
        ...spawn,
        size,
    });
}

const asteroidsGameMod: AnthaMod<AsteroidsState> = {
    modName: 'asteroids-game',
    async execute({state, engine}) {
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
                x: entityStore.pixi.screen.width / 2,
                y: entityStore.pixi.screen.height / 2,
                direction: 0,
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
                state.score = (state.score ?? 0) + (event.detail.data as {score: number}).score;
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
                        colorVariant: ViraColorVariant.Neutral,
                    })}
                        ${listen('click', async () => {
                            await engine.reset();
                            engine.startLoop();
                        })}
                    ></${ViraButton}>
                </div>
            `;
        }

        const totalTicks = (state.totalTicks ?? 0) + gameSpeed;
        state.totalTicks = totalTicks;

        const tickCounter = (state.spawnTickCounter ?? 0) + gameSpeed;
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
                createAnthaPixiCanvasMod({
                    extraCanvasStyles: css`
                        border: 2px solid red;
                    `,
                }),
                createAnthaPixiFpsMod({
                    debugTps: true,
                }),
                entityStoreMod,
                asteroidsGameMod,
            ],
        });
    },
};
