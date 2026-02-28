import {assert, waitUntil} from '@augment-vir/assert';
import {wait} from '@augment-vir/common';
import {describe, it, testWeb} from '@augment-vir/test';
import {queryThroughShadow} from '@augment-vir/web';
import {html} from 'element-vir';
import {AnthaUi} from './antha-ui.element.js';
import {AnthaEngine, defineAnthaMod} from './antha.js';

describe(AnthaUi.tagName, () => {
    it('renders', async () => {
        const engine = new AnthaEngine();

        const fixture = await testWeb.render(html`
            <${AnthaUi.assign({
                engine,
            })}></${AnthaUi}>
        `);

        assert.instanceOf(fixture, AnthaUi);

        testWeb.cleanupRender();
    });

    it('renders mod templates after a tick', async () => {
        const engine = new AnthaEngine({
            mods: [
                {
                    execute() {
                        return html`
                            <p class="test-output">hello from mod</p>
                        `;
                    },
                },
            ],
        });

        const fixture = await testWeb.render(html`
            <${AnthaUi.assign({
                engine,
                options: {
                    disableConnectStart: true,
                },
            })}></${AnthaUi}>
        `);

        assert.isNullish(queryThroughShadow(fixture, '.test-output'));

        await engine.runSingleTick();

        const output = await waitUntil.isTruthy(() => queryThroughShadow(fixture, '.test-output'));
        assert.strictEquals(output.textContent, 'hello from mod');

        testWeb.cleanupRender();
    });

    it('updates mod templates', async () => {
        const engine = new AnthaEngine({
            mods: [
                defineAnthaMod<{count: number}>({
                    execute({state}) {
                        return html`
                            <span class="counter">${String(state.count ?? 0)}</span>
                        `;
                    },
                }),
            ],
        });

        const fixture = await testWeb.render(html`
            <${AnthaUi.assign({
                engine,
                options: {
                    disableConnectStart: true,
                },
            })}></${AnthaUi}>
        `);

        await engine.runSingleTick();

        const counter = await waitUntil.isTruthy(() => queryThroughShadow(fixture, '.counter'));
        assert.strictEquals(counter.textContent, '0');

        engine.state.count = 42;
        await engine.runSingleTick();

        await waitUntil(() => queryThroughShadow(fixture, '.counter')?.textContent === '42');

        assert.strictEquals(queryThroughShadow(fixture, '.counter')?.textContent, '42');

        testWeb.cleanupRender();
    });

    it('auto-starts the engine by default', async () => {
        const engine = new AnthaEngine({
            mods: [
                {
                    execute() {
                        return html`
                            <div class="auto-started">running</div>
                        `;
                    },
                },
            ],
        });

        const fixture = await testWeb.render(html`
            <${AnthaUi.assign({
                engine,
            })}></${AnthaUi}>
        `);

        await waitUntil.isTruthy(() => queryThroughShadow(fixture, '.auto-started'));
        assert.isTrue(engine.isLoopRunning);

        engine.stopLoop();
        testWeb.cleanupRender();
    });

    it('does not auto-start when disableConnectStart=true', async () => {
        const engine = new AnthaEngine({
            mods: [
                {
                    execute() {
                        return html`
                            <div class="should-not-appear">running</div>
                        `;
                    },
                },
            ],
        });

        await testWeb.render(html`
            <${AnthaUi.assign({
                engine,
                options: {
                    disableConnectStart: true,
                },
            })}></${AnthaUi}>
        `);

        await wait({
            seconds: 2,
        });

        assert.isFalse(engine.isLoopRunning);

        testWeb.cleanupRender();
    });

    it('resets the engine on element cleanup by default', async () => {
        const engine = new AnthaEngine({
            mods: [
                {
                    execute() {
                        return html`
                            <p>tick</p>
                        `;
                    },
                },
            ],
        });

        await testWeb.render(html`
            <${AnthaUi.assign({
                engine,
                options: {
                    disableConnectStart: true,
                },
            })}></${AnthaUi}>
        `);

        await engine.runSingleTick();
        assert.isAbove(engine.currentTick, 0);

        testWeb.cleanupRender();

        await wait({
            seconds: 2,
        });

        assert.strictEquals(engine.currentTick, 0);
        assert.isFalse(engine.isLoopRunning);
    });

    it('does not reset the engine on cleanup when disableDisconnectReset=true', async () => {
        const engine = new AnthaEngine({
            mods: [
                {
                    execute() {
                        return html`
                            <p>tick</p>
                        `;
                    },
                },
            ],
        });

        await testWeb.render(html`
            <${AnthaUi.assign({
                engine,
                options: {
                    disableConnectStart: true,
                    disableDisconnectReset: true,
                },
            })}></${AnthaUi}>
        `);

        await engine.runSingleTick();
        const tickAfterExecution = engine.currentTick;
        assert.isAbove(tickAfterExecution, 0);

        testWeb.cleanupRender();

        await wait({
            seconds: 2,
        });

        assert.strictEquals(engine.currentTick, tickAfterExecution);
        engine.reset();
        const afterResetTick = engine.currentTick;

        await wait({
            seconds: 2,
        });
        assert.strictEquals(engine.currentTick, afterResetTick);
    });

    it('renders templates from multiple mods', async () => {
        const engine = new AnthaEngine({
            mods: [
                {
                    execute() {
                        return html`
                            <span class="mod-a">A</span>
                        `;
                    },
                },
                {
                    execute() {
                        return html`
                            <span class="mod-b">B</span>
                        `;
                    },
                },
            ],
        });

        const fixture = await testWeb.render(html`
            <${AnthaUi.assign({
                engine,
                options: {
                    disableConnectStart: true,
                },
            })}></${AnthaUi}>
        `);

        await engine.runSingleTick();

        const modA = await waitUntil.isTruthy(() => queryThroughShadow(fixture, '.mod-a'));
        const modB = await waitUntil.isTruthy(() => queryThroughShadow(fixture, '.mod-b'));

        assert.strictEquals(modA.textContent, 'A');
        assert.strictEquals(modB.textContent, 'B');

        testWeb.cleanupRender();
    });
});
