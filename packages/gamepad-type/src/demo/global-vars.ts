declare global {
    const VITE_RELEASE_NAME: string;
}

export const globalVars = {
    releaseName: typeof VITE_RELEASE_NAME === 'undefined' ? 'unknown' : VITE_RELEASE_NAME,
};
