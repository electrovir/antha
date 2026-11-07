// cspell:word serviceworker
/**
 * Makes a page cross-origin isolated on hosts that can't set response headers, such as GitHub
 * Pages. Same idea as `coi-serviceworker`, but loaded as a module.
 *
 * This file is both the page script that registers the service worker and the service worker
 * itself. It must not import anything: sites copy the compiled file as-is and serve it from their
 * own origin, next to (or above) their `index.html`, loaded with `<script type="module">` before
 * any other script. The first visit reloads the page once so that the service worker can add the
 * headers.
 */
const isolationHeaders = {
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Opener-Policy': 'same-origin',
};
const reloadedStorageKey = 'antha-cross-origin-isolation-reloaded';
function isServiceWorkerScope(scope) {
    return 'skipWaiting' in scope;
}
async function addIsolationHeaders(request) {
    const response = await fetch(request);
    /** Opaque responses have no readable headers or body to copy. */
    if (response.status === 0) {
        return response;
    }
    const headers = new Headers(response.headers);
    Object.entries(isolationHeaders).forEach(
        ([
            name,
            value,
        ]) => {
            headers.set(name, value);
        },
    );
    /**
     * The `Response` constructor throws if these statuses get a body. Browsers send cached module
     * requests with revalidation headers, so dev servers answer many of them with a 304.
     */
    const hasNullBody = [
        101,
        103,
        204,
        205,
        304,
    ].includes(response.status);
    return new Response(hasNullBody ? null : response.body, {
        headers,
        status: response.status,
        statusText: response.statusText,
    });
}
function setupServiceWorker(worker) {
    worker.addEventListener('install', (event) => {
        event.waitUntil(worker.skipWaiting());
    });
    worker.addEventListener('activate', (event) => {
        event.waitUntil(worker.clients.claim());
    });
    worker.addEventListener('fetch', (event) => {
        /** `fetch()` rejects these requests, so leave them to the browser. */
        if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') {
            return;
        }
        event.respondWith(addIsolationHeaders(event.request));
    });
}
async function registerServiceWorker() {
    if (window.crossOriginIsolated) {
        sessionStorage.removeItem(reloadedStorageKey);
        return;
    } else if (sessionStorage.getItem(reloadedStorageKey)) {
        sessionStorage.removeItem(reloadedStorageKey);
        throw new Error(
            'Cross-origin isolation service worker is active but the page is still not cross-origin isolated.',
        );
    } else if (!window.isSecureContext) {
        throw new Error('Cross-origin isolation service worker requires HTTPS or localhost.');
    }
    await navigator.serviceWorker.register(import.meta.url, {
        type: 'module',
    });
    await navigator.serviceWorker.ready;
    sessionStorage.setItem(reloadedStorageKey, 'true');
    window.location.reload();
}
/** TypeScript does not narrow `globalThis` itself. */
const globalScope = globalThis;
if (isServiceWorkerScope(globalScope)) {
    setupServiceWorker(globalScope);
} else {
    /** Chromium refuses to start a service worker module that contains a top-level `await`. */
    void registerServiceWorker();
}
export {};
