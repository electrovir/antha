const {baseConfig} = require('@virmator/spellcheck/configs/cspell.config.base.cjs');

module.exports = {
    ...baseConfig,
    ignorePaths: [
        ...baseConfig.ignorePaths,
        'packages/entity-*/src/box*d/box*d.*',
        'packages/entity-*/src/box*d/LICENSE-*',
    ],
    words: [
        ...baseConfig.words,
        'backquote',
        'capslock',
        'desync',
        'desynced',
        'desyncs',
        'emcc',
        'emscripten',
        'heapf',
        'heapu',
        'gamecube',
        'kenney',
        'lerp',
        'numlock',
        'steamdeck',
        'wiiu',
    ],
};
