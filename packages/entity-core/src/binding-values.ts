import {assertWrap, check} from '@augment-vir/assert';
import {getObjectTypedEntries, mapObjectValues} from '@augment-vir/common';

/**
 * The layout of values passed to or from a physics engine's bindings: numbers and booleans, nested
 * in objects as deep as needed. Only its key order and nesting matter, not its values.
 *
 * @category Internal
 */
export type BindingTemplate = {
    [Key in string]: number | boolean | BindingTemplate;
};

/**
 * Flattens `values` into the numbers a physics engine's bindings read, in `template`'s key order.
 * Booleans become 0 or 1, and anything `values` leaves out becomes `NaN`, even a whole nested
 * object. Keys that `template` lacks are skipped. The return type is annotated because this is
 * recursive.
 *
 * @category Internal
 * @example
 *
 * ```ts
 * flattenBindingValues({a: 0, b: {c: false, d: 0}}, {b: {c: true}});
 * // [NaN, 1, NaN]
 * ```
 */
export function flattenBindingValues(
    template: Readonly<BindingTemplate>,
    values: Readonly<Record<string, unknown>> | undefined,
): number[] {
    return getObjectTypedEntries(template).flatMap(
        ([
            key,
            templateValue,
        ]) => {
            const value = values?.[key];
            if (check.isObject(templateValue)) {
                return flattenBindingValues(
                    templateValue,
                    check.isObject(value) ? value : undefined,
                );
            }
            return [
                value == undefined ? Number.NaN : Number(value),
            ];
        },
    );
}

/**
 * The reverse of {@link flattenBindingValues}: fills an object shaped like `template` with the
 * numbers a physics engine's bindings wrote, in key order. Booleans are read from 0 or 1, and extra
 * numbers are ignored.
 *
 * @category Internal
 * @example
 *
 * ```ts
 * readBindingValues(
 *     {a: 0, b: {c: 0}},
 *     [
 *         1,
 *         2,
 *         3,
 *     ],
 * );
 * // {a: 1, b: {c: 2}}
 * ```
 */
export function readBindingValues<Template extends Readonly<BindingTemplate>>(
    template: Template,
    numbers: ReadonlyArray<number>,
) {
    return fillTemplate(template, numbers.values()) satisfies BindingTemplate as Template;
}

/** The return type is annotated because this is recursive. */
function fillTemplate(
    template: Readonly<BindingTemplate>,
    numbers: Iterator<number>,
): BindingTemplate {
    return mapObjectValues(template, (key, templateValue) => {
        if (check.isObject(templateValue)) {
            return fillTemplate(templateValue, numbers);
        }
        const value = assertWrap.isNumber(numbers.next().value);
        return check.isBoolean(templateValue) ? value !== 0 : value;
    });
}
