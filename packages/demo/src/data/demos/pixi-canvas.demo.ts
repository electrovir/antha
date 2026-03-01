import {
    createPixiCanvasMod,
    createPixiFpsMod,
    defaultPixiOptions,
    type AnthaPixiCanvasModState,
} from '@antha/pixi-canvas';
import {createArray, randomInteger} from '@augment-vir/common';
import {AnthaEngine, css, type AnthaMod} from 'antha';
import {createUtcFullDate} from 'date-vir';
import {Graphics} from 'pixi.js';
import {type AnthaDemo} from '../demo.js';

type Ball = {
    graphic: Graphics;
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
};

const ballColors = [
    '#ff4444',
    '#44ff44',
    '#4488ff',
    '#ffcc00',
    '#ff44ff',
    '#44ffff',
    '#ff8800',
    '#88ff00',
    '#8844ff',
    '#ff0088',
];

const maxBallSpeed = 10;

const bouncingBallsMod: AnthaMod<
    AnthaPixiCanvasModState & {
        balls: Ball[];
    }
> = {
    execute({state}) {
        const pixiApp = state.pixi?.pixiApplication;

        if (!pixiApp) {
            return;
        }

        if (!state.balls) {
            state.balls = createArray(20, (index) => {
                const radius = randomInteger({
                    min: 8,
                    max: 32,
                });
                const ball: Ball = {
                    graphic: new Graphics(),
                    x: randomInteger({
                        min: radius,
                        max: defaultPixiOptions.width - radius,
                    }),
                    y: randomInteger({
                        min: radius,
                        max: defaultPixiOptions.height - radius,
                    }),
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
        }

        const width = pixiApp.screen.width;
        const height = pixiApp.screen.height;

        for (const ball of state.balls) {
            ball.x += ball.vx;
            ball.y += ball.vy;

            if (ball.x - ball.radius <= 0 || ball.x + ball.radius >= width) {
                ball.vx *= -1;
                ball.x = Math.max(ball.radius, Math.min(width - ball.radius, ball.x));
            }
            if (ball.y - ball.radius <= 0 || ball.y + ball.radius >= height) {
                ball.vy *= -1;
                ball.y = Math.max(ball.radius, Math.min(height - ball.radius, ball.y));
            }

            ball.graphic.position.set(ball.x, ball.y);
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
