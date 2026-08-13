/* eslint-disable sonarjs/no-hardcoded-ip */

import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {getSystemVersions, includesSystemVersion} from './system-versions.js';

describe(getSystemVersions.name, () => {
    it('returns string values parsed from the browser environment', () => {
        const systemVersions = getSystemVersions();

        assert.isString(systemVersions.browserName);
        assert.isString(systemVersions.browserVersion);
        assert.isString(systemVersions.osName);
        assert.isString(systemVersions.osVersion);
    });
});

describe(includesSystemVersion.name, () => {
    const systemVersion = {
        browserName: 'Chrome',
        browserVersion: '117.0.0.0',
        osName: 'macOS',
        osVersion: '10.15.7',
    };

    it('finds a matching system version', () => {
        assert.isTrue(includesSystemVersion([systemVersion], systemVersion));
    });

    it('does not find a different system version', () => {
        assert.isFalse(
            includesSystemVersion([systemVersion], {
                ...systemVersion,
                browserVersion: '118.0.0.0',
            }),
        );
    });
});
