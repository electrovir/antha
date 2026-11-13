import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {
    readFilterBits,
    readWasmFloat32s,
    readWasmInt32s,
    readWasmOverlaps,
    writeWasmInputBytes,
} from './wasm-memory.js';

function createWasmModule() {
    const buffer = new ArrayBuffer(64);
    return {
        HEAPU8: new Uint8Array(buffer),
        HEAP32: new Int32Array(buffer),
        HEAPF32: new Float32Array(buffer),
        reservedByteLengths: [] as number[],
        _reserveInput(byteLength: number) {
            this.reservedByteLengths.push(byteLength);
            return 8;
        },
    };
}

describe(readWasmInt32s.name, () => {
    it('reads int32s and float32s starting at a byte pointer', () => {
        const wasmModule = createWasmModule();
        wasmModule.HEAP32.set(
            [
                7,
                -3,
            ],
            2,
        );
        wasmModule.HEAPF32.set(
            [
                1.5,
                -0.25,
            ],
            4,
        );

        assert.deepEquals(
            {
                ints: readWasmInt32s(wasmModule, 8, 2),
                floats: readWasmFloat32s(wasmModule, 16, 2),
            },
            {
                ints: [
                    7,
                    -3,
                ],
                floats: [
                    1.5,
                    -0.25,
                ],
            },
        );
    });
});

describe(readWasmOverlaps.name, () => {
    it('reads a counted list of entity ids without duplicates', () => {
        const wasmModule = createWasmModule();
        wasmModule.HEAP32.set(
            [
                4,
                1,
                2,
                1,
                3,
            ],
            1,
        );

        assert.deepEquals(
            readWasmOverlaps(wasmModule, 4),
            [
                1,
                2,
                3,
            ],
        );
    });
});

describe(writeWasmInputBytes.name, () => {
    it('writes bytes where the module reserved input', () => {
        const wasmModule = createWasmModule();
        writeWasmInputBytes(
            wasmModule,
            new Uint8Array([
                9,
                8,
                7,
            ]),
        );

        assert.deepEquals(
            {
                reservedByteLengths: wasmModule.reservedByteLengths,
                written: [...wasmModule.HEAPU8.subarray(8, 11)],
            },
            {
                reservedByteLengths: [
                    3,
                ],
                written: [
                    9,
                    8,
                    7,
                ],
            },
        );
    });
});

describe(readFilterBits.name, () => {
    it('joins unsigned low and high halves', () => {
        assert.strictEquals(
            readFilterBits({
                low: -1,
                high: 1,
            }),
            0x1_ff_ff_ff_ffn,
        );
    });
});
