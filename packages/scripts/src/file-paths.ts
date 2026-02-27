import {join, resolve} from 'node:path';

export const monoRepoDirPath = resolve(import.meta.dirname, '..', '..', '..');
export const distDirPath = join(monoRepoDirPath, 'dist');
export const packagesDirPath = join(monoRepoDirPath, 'packages');

export const packageDirPaths = {
    antha: join(packagesDirPath, 'antha'),
    demo: join(packagesDirPath, 'demo'),
};
