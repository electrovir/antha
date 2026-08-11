import {initSentry} from 'sentry-vir/dist/browser.js';
import {globalVars} from './global-vars.js';

const isDev = window.location.hostname === 'localhost';

export async function setupSentry() {
    await initSentry({
        dsn: 'https://5b5d58b459305bfcd595aabfd356136c@o4506447710060544.ingest.sentry.io/4506479530737664',
        isDev,
        releaseEnv: isDev ? 'dev' : 'prod',
        releaseName: globalVars.releaseName,
    });
}
