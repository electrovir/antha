import {
    createAnthaEntityStoreMod,
    type AnthaEntityStoreModState,
    type ViewCreation,
} from '@antha/entity';
import {createAnthaPixiCanvasMod, createAnthaPixiFpsMod} from '@antha/pixi-canvas';
import {AnthaEngine, SkipExecution, css, defineAnthaMod} from 'antha';
import {createUtcFullDate} from 'date-vir';
import {defineShape} from 'object-shape-tester';
import {AnimatedSprite, Assets, Spritesheet, type SpritesheetData} from 'pixi.js';
import {joinUrlPaths} from 'url-vir';
import {githubPagesBasePathname, isOnGitHubPages} from '../demo-router.js';
import {type AnthaDemo} from '../demo.js';

function resolveSpritePath(fileName: string): string {
    if (isOnGitHubPages()) {
        return joinUrlPaths(githubPagesBasePathname, 'sprites', fileName);
    } else {
        return joinUrlPaths('', 'sprites', fileName);
    }
}

type SpritesGameState = {
    playerEntity: PlayerEntity;
};

const {mod: entityStoreMod, defineEntity} = createAnthaEntityStoreMod<SpritesGameState>({});

class PlayerEntity extends defineEntity({
    key: 'PlayerSprite',
    paramsShape: defineShape({
        x: 0,
        y: 0,
        angle: 0,
    }),
    paramsMap: {
        view: {
            x: true,
            y: true,
            rotation: 'angle',
        },
    },
}) {
    private static readonly spriteProperties = {
        resolution: 4,
        rotationSpeed: 0.002,
        playerDisplaySize: 400,
    };

    public override createView(): ViewCreation {
        return {};
    }

    public async loadSprite(): Promise<void> {
        const spriteSizes = {
            enemy: {
                w: 36,
                h: 36,
            },
            player: {
                w: 50,
                h: 50,
            },
        };

        const spritesheetData = {
            frames: {
                enemy1: {
                    frame: {
                        x: 0,
                        y: 0,
                        ...spriteSizes.enemy,
                    },
                },
                enemy2: {
                    frame: {
                        x: 36,
                        y: 0,
                        ...spriteSizes.enemy,
                    },
                },
                enemy3: {
                    frame: {
                        x: 72,
                        y: 0,
                        ...spriteSizes.enemy,
                    },
                },
                player1: {
                    frame: {
                        x: 0,
                        y: 36,
                        ...spriteSizes.player,
                    },
                },
                player2: {
                    frame: {
                        x: 50,
                        y: 36,
                        ...spriteSizes.player,
                    },
                },
                player3: {
                    frame: {
                        x: 100,
                        y: 36,
                        ...spriteSizes.player,
                    },
                },
                player4: {
                    frame: {
                        x: 50,
                        y: 36,
                        ...spriteSizes.player,
                    },
                },
            },
            meta: {
                image: resolveSpritePath('sprites.svg'),
                scale: 1,
            },
            animations: {
                enemy: [
                    'enemy1',
                    'enemy2',
                    'enemy3',
                ],
                player: [
                    'player1',
                    'player2',
                    'player3',
                    'player4',
                ],
            },
        } satisfies SpritesheetData;

        /** Scale all frame coordinates by resolution to match the rasterized SVG. */
        Object.values(spritesheetData.frames).forEach((frame) => {
            frame.frame.x *= PlayerEntity.spriteProperties.resolution;
            frame.frame.y *= PlayerEntity.spriteProperties.resolution;
            frame.frame.h *= PlayerEntity.spriteProperties.resolution;
            frame.frame.w *= PlayerEntity.spriteProperties.resolution;
        });

        const spritesheetTexture = await Assets.load({
            src: spritesheetData.meta.image,
            data: {
                resolution: PlayerEntity.spriteProperties.resolution,
            },
        });

        const spritesheet = new Spritesheet(spritesheetTexture, spritesheetData);
        await spritesheet.parse();

        const playerSprite = new AnimatedSprite(spritesheet.animations.player);
        playerSprite.animationSpeed = 0.1;
        playerSprite.anchor = 0.5;
        playerSprite.width = PlayerEntity.spriteProperties.playerDisplaySize;
        playerSprite.height = PlayerEntity.spriteProperties.playerDisplaySize;
        playerSprite.play();

        this.view.removeFromParent();
        this.view = playerSprite;

        this.pixi.stage.addChild(this.view);
    }

    public override update(): void {
        this.params.x = this.pixi.screen.width / 2;
        this.params.y = this.pixi.screen.height / 2;
        this.params.angle =
            (this.params.angle || 0) +
            PlayerEntity.spriteProperties.rotationSpeed * this.entityStore.pixi.ticker.deltaMS;
    }
}

const dynamicSpriteMod = defineAnthaMod<AnthaEntityStoreModState<SpritesGameState>>({
    modName: 'demo-dynamic-sprite',
    executeImmediately: true,
    async execute({state}) {
        if (!state.entityStore) {
            return SkipExecution;
        }

        if (!state.playerEntity) {
            state.playerEntity = await state.entityStore.addEntity(PlayerEntity, {
                x: 0,
                y: 0,
                angle: 0,
            });
            await state.playerEntity.loadSprite();
        }

        return undefined;
    },
});

export const spritesDemo: AnthaDemo = {
    demoName: 'Dynamic Sprite',
    demoPathId: 'dynamic-sprite',
    demoSortDate: createUtcFullDate('2026-03-10T00:00:00.000Z'),
    engine() {
        return new AnthaEngine({
            mods: [
                createAnthaPixiCanvasMod({
                    extraCanvasStyles: css`
                        border: 2px solid red;
                    `,
                }),
                createAnthaPixiFpsMod(),
                entityStoreMod,
                dynamicSpriteMod,
            ],
        });
    },
};
