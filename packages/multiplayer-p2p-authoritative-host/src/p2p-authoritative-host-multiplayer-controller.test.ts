import {assert, assertWrap} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {
    ControllerStateEvent,
    P2pAuthoritativeHostMultiplayerController,
    type StateEventDetail,
} from './p2p-authoritative-host-multiplayer-controller.js';

type CounterState = {
    count: number;
};

describe(P2pAuthoritativeHostMultiplayerController.name, () => {
    it('applies singleplayer authoritative inputs and ticks', () => {
        const state: {
            updates: ReadonlyArray<StateEventDetail<number, CounterState>>;
        } = {
            updates: [],
        };
        const controller = new P2pAuthoritativeHostMultiplayerController<number, CounterState>({
            gameId: 'singleplayer-authoritative-host-test',
            createInitialState() {
                return {
                    count: 0,
                };
            },
            applyInput({state, input}) {
                return {
                    count: state.count + input,
                };
            },
            tick({state, elapsedMs}) {
                return {
                    count: state.count + elapsedMs,
                };
            },
        });

        controller.listen(ControllerStateEvent<CounterState, number>, ({detail}) => {
            state.updates = [
                ...state.updates,
                detail,
            ];
        });

        assert.deepEquals(controller.getState(), {
            count: 0,
        });
        controller.startSingleplayer();
        const clientId = assertWrap.isDefined(controller.getClientId());
        assert.isLengthExactly(controller.getAllClientIds(), 1);
        controller.act(2);
        controller.tick(3);

        assert.deepEquals(controller.getState(), {
            count: 5,
        });
        assert.deepEquals(state.updates, [
            {
                sequence: 0,
                state: {
                    count: 0,
                },
            },
            {
                clientId,
                input: 2,
                sequence: 1,
                state: {
                    count: 2,
                },
            },
            {
                sequence: 2,
                state: {
                    count: 5,
                },
            },
        ]);
    });
});
