const {baseConfig} = require('@virmator/spellcheck/configs/cspell.config.base.cjs');

module.exports = {
    ...baseConfig,
    ignorePaths: [
        ...baseConfig.ignorePaths,
    ],
    words: [
        ...baseConfig.words,
        'backquote',
        'capslock',
        'desync',
        'desynced',
        'desyncs',
        'gamecube',
        'kenney',
        'lerp',
        'numlock',
        'steamdeck',
        'wiiu',
    ],
};
