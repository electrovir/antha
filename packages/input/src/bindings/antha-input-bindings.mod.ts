import {defineAnthaMod, html} from '@antha/engine';
import {check} from '@augment-vir/assert';
import {
    filterMap,
    getEnumValues,
    getObjectTypedEntries,
    mapObjectValuesSync,
    type SelectFrom,
} from '@augment-vir/common';
import {GamepadInputDeviceKey} from 'input-device-handler';
import {
    AnthaReadRawInputMod,
    type AnthaReadRawInputModState,
} from '../raw-inputs/antha-read-raw-input.mod.js';
import {type RawInput, type RawInputs} from '../raw-inputs/raw-input.js';
import {AnthaActiveBindingsDebug} from './antha-active-bindings-debug.element.js';
import {AnthaBindingAssignmentsDebug} from './antha-binding-assignments-debug.element.js';
import {
    AnyGamepad,
    type ActiveBinding,
    type ActiveBindings,
    type AnthaDeviceKey,
    type BindingAssignment,
    type BindingAssignments,
    type GamepadKeyMap,
    type PlayersActiveBindings,
    type PlayersBindingAssignments,
} from './player-bindings.js';

/**
 * Options for {@link createAnthaInputBindingsMod}.
 *
 * @category Internal
 */
export type AnthaInputBindingsModOptions<BindingNames extends string = string> = Partial<
    SelectFrom<
        AnthaInputBindingsState<BindingNames>,
        {
            debugBindingAssignments: true;
            debugActiveBindings: true;
            bindingAssignments: true;
            gamepadKeyMap: true;
        }
    >
>;

/**
 * All state used and set by `createAnthaReadBindingsMod`.
 *
 * @category Internal
 */
export type AnthaInputBindingsState<BindingNames extends string = string> = Pick<
    AnthaReadRawInputModState,
    'rawInputs'
> & {
    /** Maps gamepads to different gamepad slots. See `GamepadKeyMap` for more information. */
    gamepadKeyMap: GamepadKeyMap;
    /** Bindings for all players. */
    bindingAssignments: PlayersBindingAssignments<BindingNames>;
    /** All active bindings for all players. */
    activeBindings: PlayersActiveBindings<BindingNames>;
    debugBindingAssignments: boolean;
    debugActiveBindings: boolean;
};

/**
 * A pre-built mod that reads all current bindings (set externally) and all current raw inputs (set
 * by {@link AnthaReadRawInputMod}) and then determines and sets the currently active bindings.
 *
 * By default, this mod allows any strings as binding names. Use the generic type parameter to
 * define this mod with a specific set of allowed binding names.
 *
 * @category Pre-Built Mods
 */
export function createAnthaInputBindingsMod<const BindingNames extends string = string>(
    options: Readonly<AnthaInputBindingsModOptions> = {},
) {
    return defineAnthaMod<AnthaInputBindingsState<BindingNames>>({
        modName: 'antha-input-bindings',
        initState: options,
        execute({state, msSinceLastExecute}) {
            if (!state.bindingAssignments || !state.rawInputs) {
                /** Nothing to do if there are no bindings or inputs. */
                state.activeBindings = {};
            } else {
                const newPlayersActiveBindingsMap = mapObjectValuesSync(
                    state.bindingAssignments,
                    (playerPosition, bindingsMap) => {
                        return readPlayerBindings({
                            bindingsMap,
                            activeBindingsMap: state.activeBindings?.[playerPosition],
                            rawInputs: state.rawInputs,
                            msSinceLastExecute,
                            gamepadKeyMap: state.gamepadKeyMap,
                        });
                    },
                );

                state.activeBindings = newPlayersActiveBindingsMap;
            }

            const assignmentDebugElement = state.debugBindingAssignments
                ? html`
                      <${AnthaBindingAssignmentsDebug.assign({
                          bindingAssignments: state.bindingAssignments,
                      })}></${AnthaBindingAssignmentsDebug}>
                  `
                : undefined;

            const activeDebugElement = state.debugActiveBindings
                ? html`
                      <${AnthaActiveBindingsDebug.assign({
                          activeBindings: state.activeBindings,
                      })}></${AnthaActiveBindingsDebug}>
                  `
                : undefined;

            if (assignmentDebugElement || activeDebugElement) {
                return [
                    assignmentDebugElement,
                    activeDebugElement,
                ];
            } else {
                return undefined;
            }
        },
    });
}

/**
 * The mod created by {@link createAnthaInputBindingsMod}.
 *
 * @category Internal
 */
export type AnthaInputBindingsMod = ReturnType<typeof createAnthaInputBindingsMod>;

const gamepadInputDeviceKeys = getEnumValues(GamepadInputDeviceKey);

function filterRawInput(
    entry: RawInput | undefined,
    binding: BindingAssignment,
): entry is RawInput {
    return (
        entry?.direction === binding.direction &&
        (binding.gamepadBrand ? binding.gamepadBrand === entry.mapped.gamepadBrand : true)
    );
}

function readPlayerBindings<BindingNames extends string>({
    bindingsMap,
    activeBindingsMap,
    rawInputs,
    msSinceLastExecute,
    gamepadKeyMap,
}: {
    bindingsMap: Readonly<BindingAssignments<BindingNames>>;
    activeBindingsMap: Readonly<ActiveBindings<BindingNames>> | undefined;
    rawInputs: Readonly<RawInputs> | undefined;
    msSinceLastExecute: DOMHighResTimeStamp;
    gamepadKeyMap: GamepadKeyMap | undefined;
}): ActiveBindings<BindingNames> {
    return getObjectTypedEntries(
        bindingsMap satisfies BindingAssignments as BindingAssignments,
    ).reduce(
        (
            accum,
            [
                bindingName,
                bindings,
            ],
        ) => {
            const matchingInputs = filterMap(
                bindings,
                (binding) => {
                    const mappedDeviceKey: AnthaDeviceKey =
                        (gamepadKeyMap &&
                            check.isKeyOf(binding.deviceKey, gamepadKeyMap) &&
                            gamepadKeyMap[binding.deviceKey]) ||
                        binding.deviceKey;

                    const matchingInputs =
                        mappedDeviceKey === AnyGamepad
                            ? filterMap(
                                  gamepadInputDeviceKeys,
                                  (gamepadKey) => {
                                      return rawInputs?.[gamepadKey]?.[binding.inputName];
                                  },
                                  (entry): entry is NonNullable<typeof entry> => {
                                      return filterRawInput(entry, binding);
                                  },
                              )
                            : [rawInputs?.[mappedDeviceKey]?.[binding.inputName]].filter(
                                  (entry): entry is NonNullable<typeof entry> => {
                                      return filterRawInput(entry, binding);
                                  },
                              );

                    if (matchingInputs.length) {
                        return matchingInputs;
                    } else {
                        return undefined;
                    }
                },
                check.isTruthy,
            ).flat();

            if (matchingInputs.length) {
                const value = matchingInputs.reduce((accum, matchingInput) => {
                    return accum + matchingInput.inputValue;
                }, 0);

                const previousActiveBinding = (
                    activeBindingsMap satisfies ActiveBindings | undefined as
                        | ActiveBindings
                        | undefined
                )?.[bindingName];

                const previousBindingDuration = previousActiveBinding?.holdDuration;
                const durationMs = previousBindingDuration
                    ? previousBindingDuration.milliseconds + msSinceLastExecute
                    : 0;

                const newActiveBinding: ActiveBinding = {
                    holdDuration: {
                        milliseconds: Math.round(durationMs),
                    },
                    value,
                    actCount: previousActiveBinding?.actCount || 0,
                    lastActDuration: previousActiveBinding?.lastActDuration || {
                        milliseconds: 0,
                    },
                };

                accum[bindingName] = newActiveBinding;
            }

            return accum;
        },
        {} satisfies ActiveBindings as ActiveBindings,
    );
}
