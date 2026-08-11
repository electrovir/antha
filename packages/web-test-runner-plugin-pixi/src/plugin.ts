import {type SelectFrom} from '@augment-vir/common';
import {findAncestor, toPosixPath} from '@augment-vir/node';
import {type Plugin} from '@web/dev-server-core';
import {existsSync} from 'node:fs';
import {join as fsJoin} from 'node:path';
import {join, relative} from 'node:path/posix';
import {fileURLToPath} from 'node:url';

export function pixiPlugin() {
    return new PixiPlugin();
}

export class PixiPlugin implements Plugin {
    public readonly name = 'pixi';

    protected pixiPath: string | undefined;

    protected getPixiPath(rawRootDir: string) {
        const pixiPackageDirPath = findAncestor(
            fileURLToPath(import.meta.resolve('pixi.js')),
            (path) => {
                return existsSync(fsJoin(path, 'package.json'));
            },
        );

        /* node:coverage ignore next 3: impossible to mock this in the current repo */
        if (!pixiPackageDirPath) {
            throw new Error('Failed to find pixi.js package path.');
        }

        const rootDir = toPosixPath(rawRootDir).replace(/^\/c/, '');

        const fullPixiMinPath = join(
            toPosixPath(pixiPackageDirPath).replace(/^\/c/, ''),
            'dist',
            'pixi.min.mjs',
        );

        const relativeToRoot = relative(rootDir, fullPixiMinPath);
        const splitPath = relativeToRoot.split('/');
        const notUpDirParts = splitPath.filter((part) => part !== '..');
        const upDirCount = splitPath.length - notUpDirParts.length;
        const rejoinedPath = notUpDirParts.join('/');

        if (upDirCount) {
            /** Pixi path is above root path. */
            return `/__wds-outside-root__/${upDirCount}/${rejoinedPath}`;
        } else {
            return '/' + relativeToRoot;
        }
    }

    public serverStart({config}: Parameters<NonNullable<Plugin['serverStart']>>[0]) {
        this.pixiPath = this.getPixiPath(config.rootDir);
    }

    public resolveImport({
        source,
    }: SelectFrom<
        Parameters<NonNullable<Plugin['resolveImport']>>[0],
        {
            source: true;
        }
    >) {
        if (source === 'pixi.js') {
            if (!this.pixiPath) {
                throw new Error('Cannot resolve import: pixiPath not set');
            }

            return this.pixiPath;
        }
        return undefined;
    }
}
