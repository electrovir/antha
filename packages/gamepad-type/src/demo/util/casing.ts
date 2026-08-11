import {setFirstLetterCasing, StringCase} from '@augment-vir/common';

export function kebabCaseToNameCase(input: string): string {
    return input
        .split('-')
        .map((word) => setFirstLetterCasing(word, StringCase.Upper))
        .join(' ');
}
