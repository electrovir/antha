import {AnthaEngine, ModExecutionTriggerType, defineAnthaMod} from '@antha/engine';
import {createUtcFullDate} from 'date-vir';
import {css, defineElement, html, listen} from 'element-vir';
import {defineTypedEvent} from 'typed-event-target';
import {type AnthaDemo} from '../demo.js';

class EventTriggeredModsDemoEvent extends defineTypedEvent('event-triggered-mods-demo-event') {}

type EventTriggeredModsDemoState = {
    eventBatchCount: number;
    eventCount: number;
    mostRecentBatchSize: number;
};

const AnthaDemoEventTriggerOutput = defineElement<{
    engine: AnthaEngine<EventTriggeredModsDemoState>;
    eventBatchCount: number;
    eventCount: number;
    mostRecentBatchSize: number;
}>()({
    tagName: 'antha-demo-event-trigger-output',
    styles: css`
        :host {
            align-items: center;
            display: flex;
            flex-direction: column;
            gap: 16px;
            justify-content: center;
        }

        .event-buttons {
            display: flex;
            gap: 8px;
        }

        .event-stats {
            border-collapse: collapse;
            text-align: center;
        }

        th,
        td {
            padding: 4px 8px;
        }

        th {
            text-align: right;
        }
    `,
    render({inputs}) {
        return html`
            <div class="event-buttons">
                <button
                    ${listen('click', () => {
                        inputs.engine.dispatch(new EventTriggeredModsDemoEvent());
                    })}
                >
                    Dispatch one event
                </button>
                <button
                    ${listen('click', () => {
                        inputs.engine.dispatch(new EventTriggeredModsDemoEvent());
                        inputs.engine.dispatch(new EventTriggeredModsDemoEvent());
                    })}
                >
                    Dispatch two events
                </button>
            </div>
            <table class="event-stats">
                <tbody>
                    <tr>
                        <th>Total events</th>
                        <td>${inputs.eventCount}</td>
                    </tr>
                    <tr>
                        <th>Mod executions</th>
                        <td>${inputs.eventBatchCount}</td>
                    </tr>
                    <tr>
                        <th>Most recent batch</th>
                        <td>${inputs.mostRecentBatchSize}</td>
                    </tr>
                </tbody>
            </table>
        `;
    },
});

const eventCounterMod = defineAnthaMod<EventTriggeredModsDemoState>({
    trigger: {
        event: EventTriggeredModsDemoEvent,
        executeImmediately: true,
    },
    modName: 'event-triggered-counter',
    execute({engine, executionTrigger, state}) {
        if (executionTrigger.type === ModExecutionTriggerType.Tick) {
            throw new Error('Wrong trigger.');
        }

        state.eventBatchCount = (state.eventBatchCount || 0) + 1;
        state.eventCount = (state.eventCount || 0) + executionTrigger.events.length;
        state.mostRecentBatchSize = executionTrigger.events.length;

        return html`
            <${AnthaDemoEventTriggerOutput.assign({
                engine,
                eventBatchCount: state.eventBatchCount || 0,
                eventCount: state.eventCount || 0,
                mostRecentBatchSize: state.mostRecentBatchSize || 0,
            })}></${AnthaDemoEventTriggerOutput}>
        `;
    },
});

export const eventTriggeredModsDemo: AnthaDemo = {
    demoName: 'Event-triggered Mods',
    demoPathId: 'event-triggered-mods',
    demoSortDate: createUtcFullDate('2026-09-15'),
    engine() {
        return new AnthaEngine<EventTriggeredModsDemoState>({
            initState: {
                eventBatchCount: 0,
                eventCount: 0,
                mostRecentBatchSize: 0,
            },
            mods: [
                eventCounterMod,
            ],
        });
    },
};
