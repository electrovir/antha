/**
 * The codec determining code is largely copied from
 * https://github.com/goldfire/howler.js/blob/a2a47933f1ffcee659e4939a65e075fa7f25706c/src/howler.core.js,
 * which has the following license:
 *
 *     Copyright (c) 2013-2020 James Simpson and GoldFire Studios, Inc.
 *
 *     Permission is hereby granted, free of charge, to any person obtaining
 *     a copy of this software and associated documentation files (the
 *     "Software"), to deal in the Software without restriction, including
 *     without limitation the rights to use, copy, modify, merge, publish,
 *     distribute, sublicense, and/or sell copies of the Software, and to
 *     permit persons to whom the Software is furnished to do so, subject to
 *     the following conditions:
 *
 *     The above copyright notice and this permission notice shall be
 *     included in all copies or substantial portions of the Software.
 *
 *     THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 *     EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 *     MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 *     NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 *     LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 *     OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 *     WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import {mapObjectValues, type Values} from '@augment-vir/common';

function readCodecs() {
    const audioTest = new Audio();

    /* node:coverage disable: there's no way to reasonably test all the different below possibilities. */
    const mpegTest: boolean = !!audioTest.canPlayType('audio/mpeg;');

    // Opera version <33 has mixed MP3 support, so we need to check for and block it.
    const userAgent = globalThis.navigator.userAgent;
    const operaAgent = userAgent.match(/OPR\/(\d+)/g);
    const operaVersion = operaAgent?.[0].split('/')[1];
    const isOldOpera: boolean = operaAgent && operaVersion ? parseInt(operaVersion) < 33 : false;

    const checkSafari = userAgent.includes('Safari') && !userAgent.includes('Chrome');
    const safariVersion = userAgent.match(/Version\/(.*?) /)?.[1];
    const isOldSafari = checkSafari && safariVersion ? parseInt(safariVersion, 10) < 15 : false;

    return {
        mp3: !!(!isOldOpera && (mpegTest || audioTest.canPlayType('audio/mp3;'))),
        mpeg: !!mpegTest,
        opus: !!audioTest.canPlayType('audio/ogg; codecs="opus"'),
        ogg: !!audioTest.canPlayType('audio/ogg; codecs="vorbis"'),
        oga: !!audioTest.canPlayType('audio/ogg; codecs="vorbis"'),
        wav: !!(
            audioTest.canPlayType('audio/wav; codecs="1"') || audioTest.canPlayType('audio/wav')
        ),
        aac: !!audioTest.canPlayType('audio/aac;'),
        caf: !!audioTest.canPlayType('audio/x-caf;'),
        m4a: !!(
            audioTest.canPlayType('audio/x-m4a;') ||
            audioTest.canPlayType('audio/m4a;') ||
            audioTest.canPlayType('audio/aac;')
        ),
        m4b: !!(
            audioTest.canPlayType('audio/x-m4b;') ||
            audioTest.canPlayType('audio/m4b;') ||
            audioTest.canPlayType('audio/aac;')
        ),
        mp4: !!(
            audioTest.canPlayType('audio/x-mp4;') ||
            audioTest.canPlayType('audio/mp4;') ||
            audioTest.canPlayType('audio/aac;')
        ),
        weba: !!(!isOldSafari && audioTest.canPlayType('audio/webm; codecs="vorbis"')),
        webm: !!(!isOldSafari && audioTest.canPlayType('audio/webm; codecs="vorbis"')),
        dolby: !!audioTest.canPlayType('audio/mp4; codecs="ec-3"'),
        flac: !!(audioTest.canPlayType('audio/x-flac;') || audioTest.canPlayType('audio/flac;')),
    } satisfies Record<string, boolean>;
}
/* node:coverage enable */

const supportedCodecs = readCodecs();

/**
 * An enum of audio codec names.
 *
 * @category Internal
 */
export const Codec = mapObjectValues(supportedCodecs, (key) => key);
/**
 * An enum of audio codec names.
 *
 * @category Internal
 */
export type Codec = Values<typeof Codec>;

/**
 * Check if the given audio codec/extension is supported in the current browser.
 *
 * @category Internal
 */
// eslint-disable-next-line sonarjs/prefer-type-guard
export function isCodecSupported(codec: string): boolean {
    return !!(supportedCodecs as Record<string, boolean>)[codec];
}

/**
 * Check if the given audio file is supported in the current browser by extracting its file
 * extension.
 *
 * @category Internal
 */
export function isFileSupported(fileName: string): boolean {
    const fileExtension = extractFileExtension(fileName);

    if (!fileExtension) {
        throw new Error(`Cannot determine file extension from '${fileName}'`);
    }

    return isCodecSupported(fileExtension);
}

function extractFileExtension(fileName: string): string | undefined {
    // Extract the file extension from the URL or base64 data URI.

    const fromBase64DataUri = /^data:audio\/([^;,]+);/i.exec(fileName);
    const preSearch = fileName.split('?', 1)[0];
    const fromUrl = preSearch && /\.([^.]+)$/.exec(preSearch);

    const finalValue = fromBase64DataUri || fromUrl;

    return finalValue?.[1]?.toLowerCase();
}
