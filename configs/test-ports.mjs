/** @typedef {keyof typeof testPorts} TestPackageName */

let basePort = 8500;

/** Port assignments for each package's web-test-runner. */
export const testPorts = {
    antha: ++basePort,
    asset: ++basePort,
    audio: ++basePort,
    engine: ++basePort,
    entity: ++basePort,
    fps: ++basePort,
    graphics2d: ++basePort,
    input: ++basePort,
};
