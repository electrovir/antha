import {
    createAnthaAssetMod,
    type AnthaAssetModState,
    type AssetIncrementProgressCallback,
} from '@antha/asset';
import {AnthaEngine, SkipExecution, defineAnthaMod} from '@antha/engine';
import {
    createAnthaEntityMod2d,
    type AnthaEntity2dModState,
    type EntityStore2d,
} from '@antha/entity-2d';
import {createAnthaFpsMod} from '@antha/fps';
import {createAnthaGraphics2dMod, type AnthaGraphics2dModState} from '@antha/graphics-2d';
import {check} from '@augment-vir/assert';
import {randomInteger, wait, type MinMax} from '@augment-vir/common';
import {createUtcFullDate} from 'date-vir';
import {css, defineElement, html, listen} from 'element-vir';
import {Container, Graphics, Text} from 'pixi.js';
import {ViraError} from 'vira';
import {type AnthaDemo} from '../demo.js';

async function simulateAssetLoad({
    incrementProgressCallback,
    minMax,
    steps,
}: Readonly<{
    minMax: Readonly<MinMax>;
    steps: number;
    incrementProgressCallback: AssetIncrementProgressCallback;
}>) {
    for (let step = 0; step < steps; step++) {
        await wait({
            milliseconds: randomInteger(minMax),
        });
        incrementProgressCallback();
    }
}

type EntityAssetDemoGameState = {
    assetsLoaded: boolean;
    yellowToggle: boolean;
};

const {mod: entityMod, defineEntity} = createAnthaEntityMod2d<EntityAssetDemoGameState>({});

class RedCircleEntity extends defineEntity({
    key: 'RedCircleEntity',
    assets: {
        circleGraphic: {
            maxProgress: 50,
            async load({incrementProgressCallback}) {
                await simulateAssetLoad({
                    incrementProgressCallback,
                    minMax: {
                        min: 0,
                        max: 100,
                    },
                    steps: 50,
                });

                const graphic = new Graphics();
                graphic.circle(0, 0, 60).fill('#e74c3c');

                return {
                    value: graphic,
                };
            },
        },
        labelText: {
            maxProgress: 50,
            async load({incrementProgressCallback}) {
                await simulateAssetLoad({
                    incrementProgressCallback,
                    minMax: {
                        min: 0,
                        max: 100,
                    },
                    steps: 50,
                });

                return {
                    value: new Text({
                        text: 'Entity Asset Loaded!',
                        style: {
                            fill: '#ffffff',
                            fontSize: 20,
                            fontFamily: 'sans-serif',
                        },
                    }),
                };
            },
        },
    },
}) {
    public override async createView() {
        const labelAsset = await this.getAsset.labelText();
        const label = new Text({
            text: labelAsset.text,
            style: labelAsset.style,
        });
        label.anchor.set(0.5, 0);
        label.y = 80;

        const viewContainer = new Container({
            children: [
                await this.getAsset.circleGraphic(),
                label,
            ],
        });

        viewContainer.x = this.pixi.screen.width / 2;
        viewContainer.y = this.pixi.screen.height / 2;

        return {
            view: viewContainer,
        };
    }

    public override update(): void {}
}

class YellowCircleEntity extends defineEntity({
    key: 'YellowCircle',
    assets: {
        circleGraphic: {
            maxProgress: 50,
            async load({incrementProgressCallback}) {
                await simulateAssetLoad({
                    incrementProgressCallback,
                    minMax: {
                        min: 0,
                        max: 100,
                    },
                    steps: 50,
                });

                const graphic = new Graphics();
                graphic.circle(0, 0, 40).fill('#efec21');

                return {
                    value: graphic,
                };
            },
        },
        labelText: {
            maxProgress: 50,
            async load({incrementProgressCallback}) {
                await simulateAssetLoad({
                    incrementProgressCallback,
                    minMax: {
                        min: 0,
                        max: 100,
                    },
                    steps: 50,
                });

                return {
                    value: new Text({
                        text: 'Entity Asset Loaded!',
                        style: {
                            fill: '#ffffff',
                            fontSize: 20,
                            fontFamily: 'sans-serif',
                        },
                    }),
                };
            },
        },
    },
}) {
    public override async createView() {
        const labelAsset = await this.getAsset.labelText();
        const label = new Text({
            text: labelAsset.text,
            style: labelAsset.style,
        });
        label.anchor.set(0.5, 0);
        label.y = 40;

        const viewContainer = new Container({
            children: [
                await this.getAsset.circleGraphic(),
                label,
            ],
        });

        viewContainer.x = this.pixi.screen.width / 2;
        viewContainer.y = this.pixi.screen.height / 2 - 200;

        return {
            view: viewContainer,
        };
    }

    public override update(): void {}
}

class BlueDotEntity extends defineEntity({
    key: 'BlueDot',
    assets: {
        dotGraphic: {
            maxProgress: 100,
            async load({incrementProgressCallback}) {
                await simulateAssetLoad({
                    incrementProgressCallback,
                    minMax: {
                        min: 10,
                        max: 100,
                    },
                    steps: 100,
                });

                const graphic = new Graphics();
                graphic.circle(0, 0, 40).fill('#3498db');

                return {
                    value: graphic,
                };
            },
        },
    },
}) {
    public override async createView() {
        const label = new Text({
            text: 'Dynamic Blue Dot',
            style: {
                fill: '#ffffff',
                fontSize: 16,
                fontFamily: 'sans-serif',
            },
        });
        label.anchor.set(0.5, 0);
        label.y = 50;

        const viewContainer = new Container({
            children: [
                (await this.getAsset.dotGraphic()).clone(),
                label,
            ],
        });

        viewContainer.x = randomInteger({
            min: 100,
            max: this.pixi.screen.width - 100,
        });
        viewContainer.y = randomInteger({
            min: 100,
            max: this.pixi.screen.height - 100,
        });

        return {
            view: viewContainer,
        };
    }

    public override update(): void {}
}

let renderCount = 0;

const EntityAssetDemoControls = defineElement<{
    entityStore: EntityStore2d;
    state: Partial<EntityAssetDemoGameState & AnthaGraphics2dModState>;
}>()({
    tagName: 'entity-asset-demo-controls',
    styles: css`
        :host {
            position: absolute;
            top: 100px;
            left: 100px;
        }
    `,
    render({inputs}) {
        renderCount++;
        if (renderCount > 1) {
            return html`
                <${ViraError}>This should not render more than once!</${ViraError}>
            `;
        }
        return html`
            <button
                ${listen('click', () => {
                    inputs.state.pixi?.pixiApplication?.stage.removeChildren();
                    inputs.state.assetsLoaded = false;
                    inputs.state.yellowToggle = !inputs.state.yellowToggle;
                })}
            >
                Reload
            </button>
            <button
                ${listen('click', async () => {
                    await inputs.entityStore.addEntity(BlueDotEntity);
                })}
            >
                Add Dynamic
            </button>
        `;
    },
});

const entityAssetDemoMod = defineAnthaMod<
    AnthaEntity2dModState<EntityAssetDemoGameState> & AnthaAssetModState
>({
    modName: 'entity-asset-demo',
    executeImmediately: true,
    execute({state}) {
        const entityStore = state.entityStore;

        if (!entityStore) {
            return SkipExecution;
        }

        if (!state.assetsLoaded) {
            state.assetsLoaded = true;
            void (async () => {
                await entityStore.loadEntityAssets({
                    entities: [
                        RedCircleEntity,
                        state.yellowToggle && YellowCircleEntity,
                    ].filter(check.isTruthy),
                });
                if (state.yellowToggle) {
                    await entityStore.addEntity(YellowCircleEntity);
                }
                await entityStore.addEntity(RedCircleEntity);
            })();
        }

        return html`
            <${EntityAssetDemoControls.assign({
                entityStore,
                state,
            })}></${EntityAssetDemoControls}>
        `;
    },
});

/**
 * Click "Add Dynamic" to load a new asset dynamically (without a loading screen) and insert it.
 * Notice how the asset is cached if this button is multiple times before reloading.
 *
 * Click Reload to:
 *
 * 1. Toggle the yellow circle on and off
 * 2. Reload all assets
 *
 * Don't this clear the dynamically added blue dot (if added yet) from the asset cache, requiring it
 * to reload if dynamically inserted afterwards. It also loads the yellow asset (if toggled on). If
 * the yellow asset is toggled off, there will be no loading screen as the only asset registered is
 * now the red one, which is already registered (so no loading is needed).
 */
export const entityAssetLoadingDemo: AnthaDemo = {
    demoName: 'Entity Asset Loading',
    demoPathId: 'entity-asset-loading',
    demoSortDate: createUtcFullDate('2026-03-30'),
    engine() {
        return new AnthaEngine({
            mods: [
                createAnthaGraphics2dMod(),
                createAnthaFpsMod(),
                createAnthaAssetMod(),
                entityMod,
                entityAssetDemoMod,
            ],
        });
    },
};
