import {position2dParamsMap, position2dParamsShape, type ViewCreation2d} from '@antha/entity-2d';
import {Graphics} from '@antha/graphics-2d';
import {defineEntity} from '../mods/example-entity.mod.js';

export const playerShipSize = 36;

export class PlayerShipEntity extends defineEntity({
    key: 'PlayerShip',
    paramsShape: position2dParamsShape,
    paramsMap: position2dParamsMap,
    assets: {
        wireframe: {
            maxProgress: 1,
            load({incrementProgressCallback}) {
                const triangle = new Graphics();

                triangle
                    .poly([
                        0,
                        -playerShipSize,
                        -playerShipSize * 0.7,
                        playerShipSize,
                        playerShipSize * 0.7,
                        playerShipSize,
                    ])
                    .fill({
                        color: 'white',
                    })
                    .stroke({
                        color: '#14d7fe',
                        width: 5,
                    });

                incrementProgressCallback();

                return {
                    value: triangle,
                };
            },
        },
    },
}) {
    public override async createView(): Promise<ViewCreation2d> {
        return {
            view: (await this.getAsset.wireframe()).clone(true),
        };
    }

    public override update(): void {}
}
