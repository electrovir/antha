import {DeferredPromise} from '@augment-vir/common';

/**
 * Detects if the browser session currently supports playing audio.
 *
 * @category Internal
 */
export async function isPlayingEnabled(
    audioContext: Readonly<BaseAudioContext> = new AudioContext(),
): Promise<boolean> {
    /** Firefox requires an explicit resume after user gesture; other browsers auto-resume. */
    if (audioContext instanceof AudioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
    }

    const source = audioContext.createBufferSource();
    source.buffer = audioContext.createBuffer(1, 1, 22_050);
    source.connect(audioContext.destination);

    const deferredPromise = new DeferredPromise<boolean>();

    source.addEventListener('ended', () => {
        source.disconnect();
        if (!deferredPromise.isSettled) {
            deferredPromise.resolve(true);
        }
    });
    source.start();
    globalThis.setTimeout(() => {
        if (!deferredPromise.isSettled) {
            deferredPromise.resolve(false);
        }
    }, 100);

    return deferredPromise.promise;
}
