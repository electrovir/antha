import {
    createPixiCanvasMod,
    createPixiFpsMod,
    defaultPixiOptions,
    type AnthaPixiCanvasModState,
} from '@antha/pixi-canvas';
import {assertWrap} from '@augment-vir/assert';
import {createArray, randomInteger} from '@augment-vir/common';
import {AnthaEngine, SkipExecution, css, type AnthaMod} from 'antha';
import {createUtcFullDate} from 'date-vir';
import {Graphics} from 'pixi.js';
import {type AnthaDemo} from '../demo.js';

type BounceWaypoint = {
    x: number;
    y: number;
    /** Fraction through the physics step (0–1) at which the ball contacts the wall. */
    fraction: number;
};

type Ball = {
    graphic: Graphics;
    /** Current physics position. */
    x: number;
    y: number;
    /** Previous physics position (for interpolation). */
    prevX: number;
    prevY: number;
    /**
     * If the ball bounced this step, the wall-contact waypoint used for piecewise interpolation.
     * Without this, a straight lerp from prevPos to pos would visually pass through the wall.
     */
    bounceWaypoint: BounceWaypoint | undefined;
    vx: number;
    vy: number;
    radius: number;
};

const ballColors = [
    '#ff44ff',
    '#ff0088',
    '#ff4444',
    '#ff8800',
    '#ffcc00',
    '#88ff00',
    '#44ff44',
    '#44ffff',
    '#4488ff',
    '#8844ff',
];

const maxBallSpeed = 200;

const bouncingBallsMod: AnthaMod<
    AnthaPixiCanvasModState & {
        balls: Ball[];
        lastPhysicsTime: number;
        tweenTeardown: (() => void) | undefined;
    }
> = {
    frequency: {
        ticks: 50,
    },
    executeImmediately: true,
    execute({state, engine, frequency}): typeof SkipExecution | void {
        /** Engine tick duration (ms) × mod frequency (ticks) = ms between physics steps. */
        const physicsIntervalMs =
            engine.options.tickDurationMs *
            assertWrap.isDefined(assertWrap.isDefined(frequency).ticks);
        const pixiApp = state.pixi?.pixiApplication;

        if (!pixiApp) {
            return SkipExecution;
        }

        if (!state.balls) {
            state.balls = createArray(20, (index) => {
                const radius = randomInteger({
                    min: 8,
                    max: 32,
                });
                const x = randomInteger({
                    min: radius,
                    max: defaultPixiOptions.width - radius,
                });
                const y = randomInteger({
                    min: radius,
                    max: defaultPixiOptions.height - radius,
                });
                const ball: Ball = {
                    graphic: new Graphics(),
                    x,
                    y,
                    prevX: x,
                    prevY: y,
                    bounceWaypoint: undefined,
                    vx: randomInteger({
                        min: -maxBallSpeed / 2,
                        max: maxBallSpeed / 2,
                    }),
                    vy: randomInteger({
                        min: -maxBallSpeed / 2,
                        max: maxBallSpeed / 2,
                    }),
                    radius,
                };

                ball.graphic.circle(0, 0, radius).fill(ballColors[index % ballColors.length]);
                ball.graphic.position.set(ball.x, ball.y);
                pixiApp.stage.addChild(ball.graphic);
                return ball;
            });

            state.lastPhysicsTime = performance.now();

            /**
             * Use Pixi's own ticker to interpolate positions at ~60 fps, independent of the mod's
             * low physics frequency. When a ball bounced this step, piecewise-interpolate through
             * the bounce waypoint so the visual path never passes through a wall.
             */
            function tweenCallback() {
                const balls = state.balls;
                const lastPhysicsTime = state.lastPhysicsTime;

                if (!balls || lastPhysicsTime == undefined) {
                    return;
                }

                /** Linear interpolation factor: 0 at physics step start, 1 at the next step. */
                const interpolation = Math.min(
                    (performance.now() - lastPhysicsTime) / physicsIntervalMs,
                    1,
                );

                balls.forEach((ball) => {
                    let displayX: number;
                    let displayY: number;

                    const waypoint = ball.bounceWaypoint;

                    if (waypoint && interpolation <= waypoint.fraction) {
                        /** Pre-bounce segment: prevPos → wall contact. */
                        const segmentT =
                            waypoint.fraction > 0 ? interpolation / waypoint.fraction : 0;
                        displayX = ball.prevX + (waypoint.x - ball.prevX) * segmentT;
                        displayY = ball.prevY + (waypoint.y - ball.prevY) * segmentT;
                    } else if (waypoint) {
                        /** Post-bounce segment: wall contact → reflected pos. */
                        const remaining = 1 - waypoint.fraction;
                        const segmentT =
                            remaining > 0 ? (interpolation - waypoint.fraction) / remaining : 1;
                        displayX = waypoint.x + (ball.x - waypoint.x) * segmentT;
                        displayY = waypoint.y + (ball.y - waypoint.y) * segmentT;
                    } else {
                        /** No bounce — simple lerp. */
                        displayX = ball.prevX + (ball.x - ball.prevX) * interpolation;
                        displayY = ball.prevY + (ball.y - ball.prevY) * interpolation;
                    }

                    ball.graphic.position.set(displayX, displayY);
                });
            }

            pixiApp.ticker.add(tweenCallback);
            state.tweenTeardown = () => {
                pixiApp.ticker.remove(tweenCallback);
            };
        }

        const width = pixiApp.screen.width;
        const height = pixiApp.screen.height;

        /** Physics step: snapshot previous positions, then advance. */
        state.lastPhysicsTime = performance.now();

        for (const ball of state.balls) {
            ball.prevX = ball.x;
            ball.prevY = ball.y;

            /**
             * Compute the earliest wall-hit fraction (0–1) across both axes. If the ball doesn't
             * reach a wall this step, the fraction stays at Infinity.
             */
            const nextX = ball.x + ball.vx;
            const nextY = ball.y + ball.vy;

            let txBounce = Infinity;

            if (nextX - ball.radius < 0) {
                txBounce = (ball.radius - ball.x) / (nextX - ball.x);
            } else if (nextX + ball.radius > width) {
                txBounce = (width - ball.radius - ball.x) / (nextX - ball.x);
            }

            let tyBounce = Infinity;

            if (nextY - ball.radius < 0) {
                tyBounce = (ball.radius - ball.y) / (nextY - ball.y);
            } else if (nextY + ball.radius > height) {
                tyBounce = (height - ball.radius - ball.y) / (nextY - ball.y);
            }

            const tBounce = Math.min(txBounce, tyBounce);

            if (tBounce >= 0 && tBounce <= 1) {
                /** Move to the wall contact point. */
                const bounceX = ball.x + ball.vx * tBounce;
                const bounceY = ball.y + ball.vy * tBounce;

                ball.bounceWaypoint = {
                    x: bounceX,
                    y: bounceY,
                    fraction: tBounce,
                };

                /** Reflect the appropriate axis (or both for a corner hit). */
                if (txBounce <= tyBounce) {
                    ball.vx *= -1;
                }
                if (tyBounce <= txBounce) {
                    ball.vy *= -1;
                }

                /** Continue traveling for the remaining fraction after the bounce. */
                const remaining = 1 - tBounce;
                ball.x = bounceX + ball.vx * remaining;
                ball.y = bounceY + ball.vy * remaining;

                /** Safety clamp in case of floating-point drift. */
                ball.x = Math.max(ball.radius, Math.min(width - ball.radius, ball.x));
                ball.y = Math.max(ball.radius, Math.min(height - ball.radius, ball.y));
            } else {
                ball.x = nextX;
                ball.y = nextY;
                ball.bounceWaypoint = undefined;
            }
        }
    },
};

export const pixiCanvasDemo: AnthaDemo = {
    demoName: 'Pixi Canvas',
    demoPathId: 'pixi-canvas',
    sortDate: createUtcFullDate('2026-02-28T20:00:00.000Z'),
    engine: new AnthaEngine({
        mods: [
            createPixiCanvasMod({
                extraCanvasStyles: css`
                    border: 2px solid red;
                `,
            }),
            createPixiFpsMod(),
            bouncingBallsMod,
        ],
    }),
};
