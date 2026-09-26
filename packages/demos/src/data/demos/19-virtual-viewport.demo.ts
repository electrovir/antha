import {createAnthaAssetMod} from '@antha/asset';
import {AnthaEngine, defineAnthaMod, SkipExecution} from '@antha/engine';
import {createAnthaEntity2dSuite, type AnthaEntity2dModState} from '@antha/entity-2d';
import {createAnthaFpsMod} from '@antha/fps';
import {
    Container,
    createAnthaGraphics2dMod,
    createAnthaVirtualViewportMod,
    createVirtualViewportPixiOptions,
    Graphics,
    Text,
} from '@antha/graphics-2d';
import {check} from '@augment-vir/assert';
import {createUtcFullDate} from 'date-vir';
import {css, html, listen} from 'element-vir';
import {ViraSelect, type ViraSelectOption} from 'vira';
import {type AnthaDemo} from '../demo.js';

enum VirtualViewportConstraint {
    Both = 'both',
    Height = 'height',
    Width = 'width',
}

const virtualViewportSize = {
    height: 1000,
    width: 1000,
};

type VirtualViewportDemoGameState = {
    viewportConstraint: VirtualViewportConstraint;
    viewportBorder: VirtualViewportBorderEntity;
    viewportText: VirtualViewportTextEntity;
};

type VirtualViewportDemoState = AnthaEntity2dModState<VirtualViewportDemoGameState>;

const {defineEntity, updateEntitiesMod} = createAnthaEntity2dSuite<VirtualViewportDemoGameState>(
    {},
);

const virtualViewportConstraintOptions: ReadonlyArray<Readonly<ViraSelectOption>> = [
    {
        label: 'Both dimensions',
        value: VirtualViewportConstraint.Both,
    },
    {
        label: 'Width only',
        value: VirtualViewportConstraint.Width,
    },
    {
        label: 'Height only',
        value: VirtualViewportConstraint.Height,
    },
];

const virtualViewportModByConstraint: Record<
    VirtualViewportConstraint,
    ReturnType<typeof createAnthaVirtualViewportMod>
> = {
    [VirtualViewportConstraint.Both]: createAnthaVirtualViewportMod({
        virtualHeight: virtualViewportSize.height,
        virtualWidth: virtualViewportSize.width,
    }),
    [VirtualViewportConstraint.Height]: createAnthaVirtualViewportMod({
        virtualHeight: virtualViewportSize.height,
    }),
    [VirtualViewportConstraint.Width]: createAnthaVirtualViewportMod({
        virtualWidth: virtualViewportSize.width,
    }),
};

class VirtualViewportBorderEntity extends defineEntity({
    key: 'virtual-viewport-border',
}) {
    public override createView() {
        return {
            view: new Graphics(),
        };
    }

    public override update() {
        (this.view as Graphics)
            .clear()
            .rect(0, 0, this.pixi.screen.width, this.pixi.screen.height)
            .stroke({
                color: '#22c55e',
                width: 32,
            });
    }
}

/** Font sizes to compare between Pixi text and HTML text while the viewport is scaled. */
const sampleFontSizes = [
    12,
    16,
    24,
    48,
];

class VirtualViewportTextEntity extends defineEntity({
    key: 'virtual-viewport-text',
}) {
    public override createView() {
        return {
            view: new Container({
                children: sampleFontSizes.map((fontSize, index) => {
                    return new Text({
                        text: `Pixi text (${fontSize}px)`,
                        style: {
                            fill: '#ffffff',
                            fontFamily: 'sans-serif',
                            fontSize,
                        },
                        x: 64,
                        y: 480 + index * 72,
                    });
                }),
            }),
        };
    }

    public override update() {}
}

const virtualViewportDemoEntityMod = defineAnthaMod<VirtualViewportDemoState>({
    modName: 'virtual-viewport-demo-entity',
    execute({state}) {
        if (!state.entityStore) {
            return SkipExecution;
        } else if (state.viewportBorder && state.viewportText) {
            return undefined;
        } else {
            return Promise.all([
                state.entityStore.addEntity(VirtualViewportBorderEntity),
                state.entityStore.addEntity(VirtualViewportTextEntity),
            ]).then(
                ([
                    viewportBorder,
                    viewportText,
                ]) => {
                    state.viewportBorder = viewportBorder;
                    state.viewportText = viewportText;
                },
            );
        }
    },
});

const virtualViewportDemoMod = defineAnthaMod<VirtualViewportDemoState>({
    modName: 'virtual-viewport-demo',
    async cleanup(executeParams) {
        await virtualViewportModByConstraint[
            executeParams.state.viewportConstraint || VirtualViewportConstraint.Both
        ].cleanup?.(executeParams);
    },
    execute(executeParams) {
        return virtualViewportModByConstraint[
            executeParams.state.viewportConstraint || VirtualViewportConstraint.Both
        ].execute(executeParams);
    },
});

const virtualViewportDemoControlsMod = defineAnthaMod<VirtualViewportDemoState>({
    modName: 'virtual-viewport-demo-controls',
    execute({state}) {
        return html`
            <div
                style=${css`
                    background: #ffffff;
                    left: 16px;
                    padding: 12px;
                    position: absolute;
                    top: 16px;
                    z-index: 1;
                `}
            >
                <${ViraSelect.assign({
                    label: 'Constrain viewport by',
                    options: virtualViewportConstraintOptions,
                    value: state.viewportConstraint || VirtualViewportConstraint.Both,
                })}
                    ${listen(ViraSelect.events.valueChange, ({detail}) => {
                        if (
                            !check.isEnumValue(detail, VirtualViewportConstraint) ||
                            detail === state.viewportConstraint
                        ) {
                            return;
                        }

                        state.viewportConstraint = detail;
                    })}
                ></${ViraSelect}>
                ${sampleFontSizes.map((fontSize) => {
                    return html`
                        <p
                            style=${css`
                                font-family: sans-serif;
                                font-size: ${fontSize}px;
                            `}
                        >
                            HTML text (${fontSize}px)
                        </p>
                    `;
                })}
            </div>
        `;
    },
});

export const virtualViewportDemo: AnthaDemo = {
    demoName: 'Virtual Viewport',
    demoPathId: 'virtual-viewport',
    demoSortDate: createUtcFullDate('2026-09-13'),
    engine() {
        return new AnthaEngine<VirtualViewportDemoState>({
            initState: {
                viewportConstraint: VirtualViewportConstraint.Both,
            },
            mods: [
                virtualViewportDemoMod,
                createAnthaGraphics2dMod({
                    extraCanvasWrapperStyles: css`
                        z-index: 0;
                    `,
                    pixiOptions: createVirtualViewportPixiOptions(),
                }),
                createAnthaFpsMod(),
                createAnthaAssetMod(),
                updateEntitiesMod,
                virtualViewportDemoEntityMod,
                virtualViewportDemoControlsMod,
            ],
        });
    },
};
