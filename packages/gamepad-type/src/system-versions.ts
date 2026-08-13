import {check} from '@augment-vir/assert';
import Bowser from 'bowser';

const bowser = Bowser.getParser(navigator.userAgent);

/**
 * System versions that are used to differentiate gamepad layouts, since layouts may differ
 * dramatically between different browsers, operating systems, and versions of each.
 *
 * @category Types
 */
export type SystemVersions = Readonly<{
    osName: string;
    osVersion: string;
    browserName: string;
    browserVersion: string;
}>;

/**
 * Get the current system's versions. This is determined by parsing the user agent string using the
 * [bowser](https://www.npmjs.com/package/bowser) package.
 *
 * @category Util
 */
export function getSystemVersions(): SystemVersions {
    return {
        /* node:coverage ignore next: supported browser user agents include a browser version. */
        browserVersion: bowser.getBrowserVersion() || 'unknown',
        browserName: bowser.getBrowserName(),
        osName: bowser.getOSName(),
        osVersion: bowser.getOSVersion(),
    };
}

/**
 * Check if a system version is in an array of system versions.
 *
 * @category Util
 */
export function includesSystemVersion(
    systemVersions: ReadonlyArray<Readonly<SystemVersions>>,
    systemVersion: Readonly<SystemVersions>,
): boolean {
    return systemVersions.some((matchThis) => check.jsonEquals(matchThis, systemVersion));
}
