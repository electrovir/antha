import {DeferredPromise, wait} from '@augment-vir/common';

/**
 * Detects if the browser session currently supports playing audio.
 *
 * @category Internal
 */
export async function isPlayingEnabled(
    audioContext: Readonly<BaseAudioContext> = new AudioContext(),
): Promise<boolean> {
    /**
     * Firefox requires an explicit resume after user gesture; other browsers auto-resume. The
     * resume must finish before starting a source: `'ended'` never fires on a suspended context.
     * Firefox also leaves this promise pending (rather than rejecting) while audio is still
     * blocked, so it's raced against a timeout instead of awaited outright.
     */
    if (audioContext instanceof AudioContext && audioContext.state === 'suspended') {
        await Promise.race([
            audioContext.resume().catch(() => {}),
            wait({
                milliseconds: 100,
            }),
        ]);
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
