import {assertWrap} from '@augment-vir/assert';
import {createArray, removeDuplicates} from '@augment-vir/common';

/**
 * The parts of an Emscripten-built physics module that the wasm memory helpers use.
 *
 * @category Internal
 */
export type WasmMemoryModule = {
    HEAPU8: Uint8Array;
    HEAP32: Int32Array;
    HEAPF32: Float32Array;
    /**
     * Returns a pointer to a shared input buffer with room for at least `byteLength` bytes. The
     * buffer is reused, so each call can overwrite the previous input.
     */
    _reserveInput(byteLength: number): number;
};

function copyWasmNumbers<const Count extends number>(
    memory: Readonly<Int32Array | Float32Array>,
    pointer: number,
    count: Count,
) {
    const start = pointer / memory.BYTES_PER_ELEMENT;
    /** Spreading a `subarray` instead is several times slower, and this runs for every body read. */
    return createArray(count, (index) => assertWrap.isDefined(memory[start + index]));
}

/**
 * Copies int32s that a binding wrote into wasm memory. Takes the module rather than a memory view
 * so the view is read after `pointer`'s binding call, because a call that grows wasm memory
 * replaces the views.
 *
 * @category Internal
 */
export function readWasmInt32s<const Count extends number>(
    wasmModule: Readonly<Pick<WasmMemoryModule, 'HEAP32'>>,
    pointer: number,
    count: Count,
) {
    return copyWasmNumbers(wasmModule.HEAP32, pointer, count);
}

/**
 * Same as {@link readWasmInt32s} but for float32s.
 *
 * @category Internal
 */
export function readWasmFloat32s<const Count extends number>(
    wasmModule: Readonly<Pick<WasmMemoryModule, 'HEAPF32'>>,
    pointer: number,
    count: Count,
) {
    return copyWasmNumbers(wasmModule.HEAPF32, pointer, count);
}

/**
 * Reads the entity ids that an overlap binding wrote: a count followed by that many ids, which may
 * repeat when an entity has several overlapping shapes.
 *
 * @category Internal
 */
export function readWasmOverlaps(
    wasmModule: Readonly<Pick<WasmMemoryModule, 'HEAP32'>>,
    pointer: number,
) {
    const [count] = readWasmInt32s(wasmModule, pointer, 1);
    return removeDuplicates(
        readWasmInt32s(wasmModule, pointer + Int32Array.BYTES_PER_ELEMENT, count),
    );
}

/**
 * Writes bytes where the next binding call that takes input reads them.
 *
 * @category Internal
 */
export function writeWasmInputBytes(
    wasmModule: Readonly<Pick<WasmMemoryModule, 'HEAPU8' | '_reserveInput'>>,
    bytes: Readonly<Uint8Array>,
) {
    /** Reserving can grow wasm memory, which replaces `HEAPU8`, so read it only afterwards. */
    const pointer = wasmModule._reserveInput(bytes.byteLength);
    wasmModule.HEAPU8.set(bytes, pointer);
}

/**
 * Joins two uint32 halves, written low half first, into a 64-bit filter.
 *
 * @category Internal
 */
export function readFilterBits({low, high}: Readonly<{low: number; high: number}>) {
    return BigInt(low >>> 0) | (BigInt(high >>> 0) << 32n);
}
