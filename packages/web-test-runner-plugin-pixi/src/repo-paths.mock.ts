import {join, resolve} from 'node:path';

export const repoDirPath = resolve(import.meta.dirname, '..');
export const testFilesDirPath = join(repoDirPath, 'test-files');
