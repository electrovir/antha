import {check} from '@augment-vir/assert';
import {mapObject, type Values} from '@augment-vir/common';

export function makeObjectKeysLowercase<Generic extends Readonly<Record<PropertyKey, unknown>>>(
    input: Generic,
): Record<PropertyKey, Values<Generic>> {
    return mapObject(input, (key, value) => {
        return {
            key: check.isString(key) ? key.toLowerCase() : key,
            value,
        };
    });
}
