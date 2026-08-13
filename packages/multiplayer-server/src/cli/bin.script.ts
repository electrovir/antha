#!/usr/bin/env node

import {assertWrap} from '@augment-vir/assert';
import {readPackageJson} from '@augment-vir/node';
import {parseArgs} from 'cli-vir';
import {resolve} from 'node:path';
import {runMultiplayerServerCli} from './cli.js';

export const packageDirPath = resolve(import.meta.dirname, '..', '..');
const binName = assertWrap.isTruthy(
    Object.keys(
        assertWrap.isObject(
            (await readPackageJson(packageDirPath)).bin,
            'Bin definition is not an object.',
        ),
    )[0],
    'Failed to find bin name.',
);

const args = parseArgs(
    process.argv,
    {
        configPath: {
            position: 0,
            required: true,
            description:
                'Path to a config file (can be JS, TS, JSON, YAML, or TOML) with contents matching startMultiplayerServerOptionsShape.',
        },
    },
    {
        binName,
        importMeta: import.meta,
    },
);

await runMultiplayerServerCli(args.configPath);
