import {AnthaEngine, defineAnthaMod, SkipExecution} from '@antha/engine';
import {createAnthaEntityMod2d, type AnthaEntity2dModState} from '@antha/entity-2d';
import {createAnthaFpsMod} from '@antha/fps';
import {
    createAnthaGraphics2dMod,
    createAnthaVirtualViewportMod,
    createVirtualViewportPixiOptions,
    Graphics,
    type AnthaVirtualViewportModState,
    type AnthaVirtualViewportOptions,
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
};

type VirtualViewportDemoState = AnthaEntity2dModState<VirtualViewportDemoGameState> &
    AnthaVirtualViewportModState;

const {mod: entityStoreMod, defineEntity} = createAnthaEntityMod2d<VirtualViewportDemoGameState>(
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

const virtualViewportOptionsByConstraint: Record<
    VirtualViewportConstraint,
    AnthaVirtualViewportOptions
> = {
    [VirtualViewportConstraint.Both]: {
        virtualHeight: virtualViewportSize.height,
        virtualWidth: virtualViewportSize.width,
    },
    [VirtualViewportConstraint.Height]: {
        virtualHeight: virtualViewportSize.height,
    },
    [VirtualViewportConstraint.Width]: {
        virtualWidth: virtualViewportSize.width,
    },
};

const virtualViewportModByConstraint: Record<
    VirtualViewportConstraint,
    ReturnType<typeof createAnthaVirtualViewportMod>
> = {
    [VirtualViewportConstraint.Both]: createAnthaVirtualViewportMod(
        virtualViewportOptionsByConstraint[VirtualViewportConstraint.Both],
    ),
    [VirtualViewportConstraint.Height]: createAnthaVirtualViewportMod(
        virtualViewportOptionsByConstraint[VirtualViewportConstraint.Height],
    ),
    [VirtualViewportConstraint.Width]: createAnthaVirtualViewportMod(
        virtualViewportOptionsByConstraint[VirtualViewportConstraint.Width],
    ),
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

const virtualViewportDemoEntityMod = defineAnthaMod<VirtualViewportDemoState>({
    modName: 'virtual-viewport-demo-entity',
    execute({state}) {
        if (!state.entityStore) {
            return SkipExecution;
        } else if (state.viewportBorder) {
            return undefined;
        } else {
            return state.entityStore
                .addEntity(VirtualViewportBorderEntity)
                .then((viewportBorder) => {
                    state.viewportBorder = viewportBorder;
                });
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
                    pixiOptions: {
                        background: 'black',
                        ...createVirtualViewportPixiOptions(),
                    },
                }),
                createAnthaFpsMod(),
                entityStoreMod,
                virtualViewportDemoEntityMod,
                virtualViewportDemoControlsMod,
            ],
        });
    },
};
