import {createAnthaAssetMod, type AnthaAssetModOptions} from '@antha/asset';
import {createAnthaAudioMod, type AnthaAudioModOptions, type AnthaAudioState} from '@antha/audio';
import {AnthaEngine, type AnthaEngineInit} from '@antha/engine';
import {
    createAnthaEntityMod2d,
    type AnthaEntity2dModOptions,
    type AnthaEntity2dModState,
} from '@antha/entity-2d';
import {createAnthaFpsMod, type AnthaFpsModOptions} from '@antha/fps';
import {
    createAnthaGraphics2dMod,
    type AnthaGraphics2dModOptions,
    type AnthaGraphics2dModState,
} from '@antha/graphics-2d';
import {
    createAnthaInputBindingsMod,
    createAnthaReadRawInputMod,
    type AnthaInputBindingsModOptions,
    type AnthaInputBindingsModState,
    type AnthaReadRawInputModOptions,
    type AnthaReadRawInputModState,
} from '@antha/input';
import {type AnyObject} from '@augment-vir/common';
import {type EmptyObject} from 'type-fest';

/**
 * Options for {@link createDefaultAnthaEngine}, combined from all the default mods.
 *
 * @category Internal
 */
export type DefaultAnthaEngineOptions<
    ExtraState extends AnyObject = EmptyObject,
    UserCommandName extends string = string,
> = AnthaGraphics2dModOptions &
    AnthaFpsModOptions &
    AnthaAssetModOptions &
    AnthaAudioModOptions &
    AnthaEntity2dModOptions &
    AnthaReadRawInputModOptions &
    AnthaInputBindingsModOptions<NoInfer<UserCommandName>> &
    AnthaEngineInit<NoInfer<ExtraState>>;

/**
 * State for {@link createDefaultAnthaEngine}, combined from all the default mods.
 *
 * @category Internal
 */
export type DefaultAnthaEngineState<
    ExtraState extends AnyObject = EmptyObject,
    UserCommandName extends string = string,
> = AnthaGraphics2dModState &
    AnthaAudioState &
    AnthaEntity2dModState<ExtraState> &
    AnthaReadRawInputModState &
    AnthaInputBindingsModState<UserCommandName> &
    ExtraState;

/**
 * Creates a default Antha engine with all the pre-built mods included.
 *
 * @category Antha
 */
export function createDefaultAnthaEngine<
    ExtraState extends AnyObject = EmptyObject,
    UserCommandName extends string = string,
>(options: Readonly<DefaultAnthaEngineOptions<ExtraState, UserCommandName>> = {}) {
    const {
        mod: entityMod,
        defineEntity,
        defineLogicEntity,
        entityKeys,
    } = createAnthaEntityMod2d<
        AnthaGraphics2dModState &
            AnthaAudioState &
            AnthaReadRawInputModState &
            AnthaInputBindingsModState<UserCommandName> &
            ExtraState
    >(options);

    const engine = new AnthaEngine<DefaultAnthaEngineState<ExtraState, UserCommandName>>({
        ...options,
        mods: [
            createAnthaGraphics2dMod(options),
            createAnthaFpsMod(options),
            createAnthaAssetMod(options),
            createAnthaAudioMod(options),
            entityMod,
            createAnthaReadRawInputMod(options),
            createAnthaInputBindingsMod(options),
            ...(options.mods || []),
        ],
    });

    return {
        engine,
        defineEntity,
        defineLogicEntity,
        entityKeys,
        /**
         * Should only be used as a type, will never actually be populated with state properties or
         * values.
         */
        StateType: {} as DefaultAnthaEngineState<ExtraState, UserCommandName>,
    };
}
