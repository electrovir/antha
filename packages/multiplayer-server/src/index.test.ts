import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import * as multiplayerServerExports from './index.js';

describe('multiplayer server index', () => {
    it('exports the public server API', () => {
        assert.deepEquals(Object.keys(multiplayerServerExports).toSorted(), [
            'defaultMultiplayerApiLogger',
            'implementMultiplayerApi',
            'startMultiplayerServer',
        ]);
    });
});
