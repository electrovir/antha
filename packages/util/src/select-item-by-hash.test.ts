import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {selectItemByHash} from './select-item-by-hash.js';

describe(selectItemByHash.name, () => {
    it('selects the same item for a given key', () => {
        assert.strictEquals(
            selectItemByHash({
                items: [
                    'first',
                    'second',
                    'third',
                    'fourth',
                ],
                key: 'player-one',
            }),
            selectItemByHash({
                items: [
                    'first',
                    'second',
                    'third',
                    'fourth',
                ],
                key: 'player-one',
            }),
        );
    });

    it('uses the whole Unicode key when choosing an item', () => {
        assert.notStrictEquals(
            selectItemByHash({
                items: [
                    'first',
                    'second',
                    'third',
                    'fourth',
                ],
                key: 'cat',
            }),
            selectItemByHash({
                items: [
                    'first',
                    'second',
                    'third',
                    'fourth',
                ],
                key: 'cat🐈',
            }),
        );
    });
});
