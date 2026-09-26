import {assertWrap, check} from '@augment-vir/assert';

enum HashTag {
    Undefined = 1,
    Null,
    False,
    True,
    Number,
    BigInt,
    String,
    Array,
    Object,
    Map,
    Set,
    Other,
}

const numberView = new DataView(new ArrayBuffer(8));

/**
 * Quickly computes a 32-bit FNV-1a hash of any JSON-like value, intended for comparing game states
 * across multiplayer peers to detect desyncs. This is not cryptographically secure.
 *
 * - Object key order, `Map` entry order, and `Set` insertion order are all ignored.
 * - For plain objects, only own enumerable string keys are included.
 * - `-0` hashes the same as `0` and all `NaN` values hash the same.
 * - Functions and symbols all hash the same as each other.
 *
 * @category Util
 */
export function hashObject(value: unknown) {
    /**
     * A single mutable running hash avoids allocating a params object or intermediate string for
     * every visited value, which dominates the cost when hashing large states every frame.
     */
    let hash = 2_166_136_261;

    function mixWord(word: number) {
        hash = Math.imul(hash ^ word, 16_777_619) >>> 0;
    }

    function mixString(text: string) {
        mixWord(text.length);
        for (let index = 0; index < text.length; index++) {
            mixWord(assertWrap.isDefined(text.codePointAt(index)));
        }
    }

    /**
     * Hashes each unordered entry on its own and sums the results so that `Map` and `Set` insertion
     * order does not affect the hash. Their keys can be any value, so they can't be sorted like
     * object keys.
     */
    function mixUnordered<Entry>(entries: Iterable<Entry>, mixEntry: (entry: Entry) => void) {
        const outerHash = hash;
        let entriesSum = 0;
        for (const entry of entries) {
            hash = 2_166_136_261;
            mixEntry(entry);
            entriesSum = (entriesSum + hash) >>> 0;
        }
        hash = outerHash;
        mixWord(entriesSum);
    }

    function mixValue(entry: unknown) {
        if (entry === undefined) {
            mixWord(HashTag.Undefined);
        } else if (entry == null) {
            mixWord(HashTag.Null);
        } else if (check.isBoolean(entry)) {
            mixWord(entry ? HashTag.True : HashTag.False);
        } else if (typeof entry === 'number') {
            /** `check.isNumber` rejects `NaN`. */
            mixWord(HashTag.Number);
            numberView.setFloat64(0, Number.isNaN(entry) ? Number.NaN : entry === 0 ? 0 : entry);
            mixWord(numberView.getUint32(0));
            mixWord(numberView.getUint32(4));
        } else if (check.isString(entry)) {
            mixWord(HashTag.String);
            mixString(entry);
        } else if (typeof entry === 'bigint') {
            mixWord(HashTag.BigInt);
            mixString(entry.toString(16));
        } else if (Array.isArray(entry)) {
            mixWord(HashTag.Array);
            mixWord(entry.length);
            entry.forEach(mixValue);
        } else if (entry instanceof Map) {
            mixWord(HashTag.Map);
            mixWord(entry.size);
            mixUnordered(
                entry,
                ([
                    key,
                    mapValue,
                ]) => {
                    mixValue(key);
                    mixValue(mapValue);
                },
            );
        } else if (entry instanceof Set) {
            mixWord(HashTag.Set);
            mixWord(entry.size);
            mixUnordered(entry, mixValue);
        } else if (check.isObject(entry)) {
            const keys = Object.keys(entry).sort();
            mixWord(HashTag.Object);
            mixWord(keys.length);
            keys.forEach((key) => {
                mixString(key);
                mixValue(entry[key]);
            });
        } else {
            mixWord(HashTag.Other);
        }
    }

    mixValue(value);

    return hash;
}
