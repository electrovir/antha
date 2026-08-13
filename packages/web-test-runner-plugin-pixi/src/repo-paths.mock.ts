import {join, resolve} from 'node:path';

export const monoRepoDirPath = resolve(import.meta.dirname, '..', '..', '..');
export const packageDirPath = resolve(import.meta.dirname, '..');
export const testFilesDirPath = join(packageDirPath, 'test-files');
