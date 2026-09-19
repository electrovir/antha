import {type ActiveBindings} from './player-bindings.js';

/** Names the bindings that control a two-dimensional direction. */
export type DirectionalBindingNames<BindingName extends string> = {
    down: BindingName;
    left: BindingName;
    right: BindingName;
    up: BindingName;
};

/** @category Internal */
export type DirectionalInput = {
    durationMs: number;
    value: number;
};

/** @category Internal */
export function getDirectionalInput<BindingName extends string>({
    activeBindings,
    bindingName,
}: Readonly<{
    activeBindings: ActiveBindings<BindingName> | undefined;
    bindingName: BindingName;
}>): DirectionalInput {
    const activeBinding = activeBindings?.[bindingName];

    return {
        durationMs: activeBinding?.holdDuration.milliseconds ?? Infinity,
        value: activeBinding?.value || 0,
    };
}

/** @category Internal */
export function getAxisValue({
    negative,
    positive,
}: Readonly<{
    negative: DirectionalInput;
    positive: DirectionalInput;
}>) {
    return negative.value && negative.durationMs < positive.durationMs
        ? -negative.value
        : positive.value && positive.durationMs < negative.durationMs
          ? positive.value
          : 0;
}

/**
 * Converts directional bindings into a normalized vector and favors the newest opposing input.
 * Useful for determining player input from binding assignments.
 *
 * @category Util
 */
export function getDirectionalInputVector<BindingName extends string>({
    activeBindings,
    bindingNames,
}: Readonly<{
    activeBindings: ActiveBindings<BindingName> | undefined;
    bindingNames: Readonly<DirectionalBindingNames<BindingName>>;
}>) {
    const movementX = getAxisValue({
        negative: getDirectionalInput({
            activeBindings,
            bindingName: bindingNames.left,
        }),
        positive: getDirectionalInput({
            activeBindings,
            bindingName: bindingNames.right,
        }),
    });
    const movementY = getAxisValue({
        negative: getDirectionalInput({
            activeBindings,
            bindingName: bindingNames.up,
        }),
        positive: getDirectionalInput({
            activeBindings,
            bindingName: bindingNames.down,
        }),
    });
    const magnitude = Math.hypot(movementX, movementY);

    if (!magnitude) {
        return undefined;
    }

    return {
        x: (movementX / magnitude) * Math.min(magnitude, 1),
        y: (movementY / magnitude) * Math.min(magnitude, 1),
    };
}
