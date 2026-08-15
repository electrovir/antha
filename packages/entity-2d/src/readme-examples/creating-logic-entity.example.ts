import {AnthaEngine, defineAnthaMod} from '@antha/engine';
import {createAnthaGraphics2dMod} from '@antha/graphics-2d';
import {type AnthaEntity2dModState, createAnthaEntityMod2d} from '../index.js';

type GameState = AnthaEntity2dModState<{
    hasCreatedScoreEntity: boolean;
}>;

const {defineLogicEntity, mod: entityMod} = createAnthaEntityMod2d<{
    hasCreatedScoreEntity: boolean;
}>();

class ScoreEntity extends defineLogicEntity({
    key: 'score',
    paramsShape: undefined,
}) {
    public override update() {}
}

const engine = new AnthaEngine<GameState>({
    initState: {
        hasCreatedScoreEntity: false,
    },
    mods: [
        createAnthaGraphics2dMod(),
        entityMod,
        defineAnthaMod<GameState>({
            modName: 'game-logic',
            async execute({state}) {
                if (state.entityStore && !state.hasCreatedScoreEntity) {
                    state.hasCreatedScoreEntity = true;
                    await state.entityStore.addEntity(ScoreEntity);
                }
            },
        }),
    ],
});

engine.startLoop();
