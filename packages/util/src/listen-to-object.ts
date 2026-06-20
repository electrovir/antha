import {getOrSetFromMap, type AnyObject, type MaybePromise} from '@augment-vir/common';

type RegisteredListener = (this: void, value: any) => MaybePromise<void>;

const registry = new WeakMap<AnyObject, Record<PropertyKey, Set<RegisteredListener>>>();

/**
 * Listen to sets on a specific object key. Note that this does not trigger on:
 *
 * - Mutations of anything at the given key
 * - Deletions of the given key
 *
 * @category Util
 */
export function listenToObject<const Original extends AnyObject, const Key extends keyof Original>(
    original: Original,
    key: Key,
    listener: (this: void, value: Original[Key]) => MaybePromise<void>,
): (this: void) => void {
    const registryEntry = getOrSetFromMap(registry, original, () => {
        return {};
    });

    /** Fix the internal type of {@link key}. */
    const actualKey: PropertyKey = key;

    if (!registryEntry[actualKey]) {
        registryEntry[actualKey] = new Set();

        let currentValue = original[actualKey];

        Object.defineProperty(original, actualKey, {
            get() {
                return currentValue;
            },
            set(newValue) {
                currentValue = newValue;

                registryEntry[actualKey]?.forEach((listener) => {
                    void listener(newValue);
                });
            },
            configurable: true,
        });
    }

    registryEntry[actualKey].add(listener);

    return function removeListener(this: void) {
        if (registryEntry[actualKey]) {
            registryEntry[actualKey].delete(listener);
            if (!registryEntry[actualKey].size) {
                delete registryEntry[actualKey];
            }
            if (!Object.keys(registryEntry).length) {
                registry.delete(original);
            }
        }
    };
}
