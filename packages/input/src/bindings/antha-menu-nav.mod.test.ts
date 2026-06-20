import {AnthaEngine} from '@antha/engine';
import {assert, assertWrap} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {NavAction, NavController, NavEntry, type CurrentNavEntry} from 'device-navigation';
import {createAnthaMenuNavMod, MenuNavBinding, type MenuNavModState} from './antha-menu-nav.mod.js';

describe(createAnthaMenuNavMod.name, () => {
    it('fires a new active binding regardless of sampled hold duration', async () => {
        const mod = createAnthaMenuNavMod({
            repeatThreshold: {
                milliseconds: 500,
            },
        });

        const engine = new AnthaEngine<MenuNavModState>({
            mods: [
                mod,
            ],
        });

        engine.state.isInMenu = true;
        engine.state.activeBindings = {
            '1': {
                [MenuNavBinding.MenuRight]: {
                    holdDuration: {
                        milliseconds: 120,
                    },
                    value: 1,
                    actCount: 0,
                    lastActDuration: {
                        milliseconds: 0,
                    },
                },
            },
        };

        await engine.runSingleTick();

        const activeBinding = assertWrap.isDefined(
            engine.state.activeBindings['1']?.[MenuNavBinding.MenuRight],
        );

        assert.deepEquals(activeBinding, {
            holdDuration: {
                milliseconds: 120,
            },
            value: 1,
            actCount: 1,
            lastActDuration: {
                milliseconds: 120,
            },
        });
    });

    it('recovers when the current nav entry was removed from the nav tree', async () => {
        const hostElement = document.createElement('div');
        const navController = new NavController(hostElement, {
            alwaysRequireFocused: true,
        });
        const staleNavEntry = new NavEntry(document.createElement('button'), navController, {});
        const removeDisconnectListenerCalls: true[] = [];
        const currentNavEntry: CurrentNavEntry = {
            entry: staleNavEntry,
            navAction: NavAction.Focus,
            position: {
                ancestorChain: [],
                node: {
                    root: true,
                    children: [],
                },
                nodeCoords: {
                    x: 0,
                    y: 0,
                },
            },
            removeDisconnectListener() {
                removeDisconnectListenerCalls.push(true);
            },
        };

        navController.currentNavEntry = currentNavEntry;

        const engine = new AnthaEngine<MenuNavModState>({
            hostElement,
            initState: {
                isInMenu: true,
                navController,
                activeBindings: {
                    '1': {
                        [MenuNavBinding.MenuRight]: {
                            holdDuration: {
                                milliseconds: 0,
                            },
                            value: 1,
                            actCount: 0,
                            lastActDuration: {
                                milliseconds: 0,
                            },
                        },
                    },
                },
            },
            mods: [
                createAnthaMenuNavMod(),
            ],
        });

        await engine.runSingleTick();

        assert.isUndefined(navController.currentNavEntry);
        assert.isLengthExactly(removeDisconnectListenerCalls, 1);
    });
});
