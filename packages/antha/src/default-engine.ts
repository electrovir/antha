import {createAnthaAssetMod, type AnthaAssetModOptions} from '@antha/asset';
import {createAnthaAudioMod, type AnthaAudioState, type AudioPlayerOptions} from '@antha/audio';
import {AnthaEngine, type AnthaEngineInit} from '@antha/engine';
import {
    createAnthaEntityMod,
    type AnthaEntityModOptions,
    type AnthaEntityModState,
} from '@antha/entity';
import {
    createAnthaGraphics2dMod,
    createAnthaPixiFpsMod,
    type AnthaGraphics2dModOptions,
    type AnthaGraphics2dModState,
    type PixiFpsModOptions,
} from '@antha/graphics-2d';
import {
    createAnthaInputBindingsMod,
    createAnthaReadRawInputMod,
    type AnthaInputBindingsModOptions,
    type AnthaInputBindingsState,
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
    PixiFpsModOptions &
    AnthaAssetModOptions &
    AudioPlayerOptions &
    AnthaEntityModOptions &
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
    AnthaEntityModState<ExtraState> &
    AnthaReadRawInputModState &
    AnthaInputBindingsState<UserCommandName> &
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
    } = createAnthaEntityMod<
        AnthaGraphics2dModState &
            AnthaAudioState &
            AnthaReadRawInputModState &
            AnthaInputBindingsState<UserCommandName> &
            ExtraState
    >(options);

    const engine = new AnthaEngine<DefaultAnthaEngineState<ExtraState, UserCommandName>>({
        ...options,
        mods: [
            createAnthaGraphics2dMod(options),
            createAnthaPixiFpsMod(options),
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
