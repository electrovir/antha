import {AnthaEngine, defineAnthaMod} from '../index.js';

const engine = new AnthaEngine<{
    count: number;
}>({
    mods: [
        defineAnthaMod<{
            count: number;
        }>({
            modName: 'counter',
            execute({state}) {
                state.count = (state.count ?? 0) + 1;

                return `Count: ${state.count}`;
            },
        }),
    ],
});

engine.startLoop();
