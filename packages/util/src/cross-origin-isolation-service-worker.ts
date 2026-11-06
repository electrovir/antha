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

type ExtendableEventLike = Event & {
    waitUntil(promise: Promise<unknown>): void;
};

type FetchEventLike = Event & {
    request: Request;
    respondWith(response: Promise<Response>): void;
};

type ServiceWorkerScopeLike = {
    addEventListener(
        type: 'install' | 'activate',
        listener: (event: ExtendableEventLike) => void,
    ): void;
    addEventListener(type: 'fetch', listener: (event: FetchEventLike) => void): void;
    clients: {
        claim(): Promise<void>;
    };
    skipWaiting(): Promise<void>;
};

function isServiceWorkerScope(scope: object): scope is ServiceWorkerScopeLike {
    return 'skipWaiting' in scope;
}

async function addIsolationHeaders(request: Request) {
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

    return new Response(response.body, {
        headers,
        status: response.status,
        statusText: response.statusText,
    });
}

function setupServiceWorker(worker: ServiceWorkerScopeLike) {
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
const globalScope: object = globalThis;

if (isServiceWorkerScope(globalScope)) {
    setupServiceWorker(globalScope);
} else {
    /** Chromium refuses to start a service worker module that contains a top-level `await`. */
    void registerServiceWorker();
}
