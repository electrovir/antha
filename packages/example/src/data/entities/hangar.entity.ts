import {type ViewCreation2d} from '@antha/entity-2d';
import {Assets, Container, Sprite, Text, type TextOptions, type Texture} from '@antha/graphics-2d';
import {mergeDeep} from '@augment-vir/common';
import {defineEntity} from '../mods/example-entity.mod.js';

export const hangarBackgroundSize = {
    width: 1200,
    height: 1200,
};

const sharedTextStyleOptions: TextOptions = {
    style: {
        fill: '#eed',
        fontFamily: 'AirStrike',
        fontSize: 60,
        fontWeight: 'normal',
        stroke: {
            color: 'black',
            width: 10,
        },
    },
    anchor: 0.5,
};

export class HangarEntity extends defineEntity({
    key: 'Hangar',
    assets: {
        background: {
            maxProgress: 1,
            async load({incrementProgressCallback}) {
                const texture = await Assets.load<Texture>({
                    src: '/images/hangar-background.png',
                });

                incrementProgressCallback();

                return {
                    value: texture,
                };
            },
        },
    },
}) {
    public override async createView(): Promise<ViewCreation2d> {
        return {
            view: new Container({
                children: [
                    new Sprite(await this.getAsset.background()),
                    new Text({
                        text: 'Exit',
                        ...mergeDeep(sharedTextStyleOptions, {
                            x: 230,
                            y: 970,
                        }),
                    }),
                    new Text({
                        text: 'Launch',
                        ...mergeDeep(sharedTextStyleOptions, {
                            x: 610,
                            y: 150,
                        }),
                    }),
                ],
                zIndex: -1,
            }),
        };
    }

    public override update(): void {
        const scale = Math.min(
            this.pixi.screen.width / hangarBackgroundSize.width,
            this.pixi.screen.height / hangarBackgroundSize.height,
        );
        const scaledWidth = hangarBackgroundSize.width * scale;
        const scaledHeight = hangarBackgroundSize.height * scale;

        this.view.scale.set(scale);
        this.view.x = (this.pixi.screen.width - scaledWidth) / 2;
        this.view.y = (this.pixi.screen.height - scaledHeight) / 2;
    }
}
