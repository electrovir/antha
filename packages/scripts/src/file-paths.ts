import {join, resolve} from 'node:path';

export const monoRepoDirPath = resolve(import.meta.dirname, '..', '..', '..');
export const distDirPath = join(monoRepoDirPath, 'dist');
export const packagesDirPath = join(monoRepoDirPath, 'packages');

export const physicsCacheDirPath = join(monoRepoDirPath, 'node_modules', '.cache', 'antha-physics');

export const physicsEngineDirPaths = {
    box2d: join(packagesDirPath, 'entity-2d', 'src', 'box2d'),
    box3d: join(packagesDirPath, 'entity-3d', 'src', 'box3d'),
};

export const packageDirPaths = {
    antha: join(packagesDirPath, 'antha'),
    demos: join(packagesDirPath, 'demos'),
};
