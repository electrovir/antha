import {type PartialWithUndefined} from '@augment-vir/common';
import {Container, Rectangle, Ticker, type Application, type ApplicationOptions} from 'pixi.js';

/**
 * Create a mock Pixi.js Application. Additional Application mocks can be provided that will be
 * merged with the base mock. (Clashing properties will be overridden by what is provided in the
 * additional mocks.)
 *
 * @category Mock
 */
export function createMockPixi({
    mocks,
    options,
}: PartialWithUndefined<{
    options: Partial<ApplicationOptions>;
    mocks: Partial<Application>;
}> = {}) {
    const mock = new MockPixiApp(options) as MockPixiApp & Application;
    if (mocks) {
        Object.assign(mock, mocks);
    }

    return mock;
}

/**
 * Mock Pixi.js Application. This is not a complete mock (yet) and only implements partial
 * functionality.
 *
 * @category Internal
 */
export class MockPixiApp {
    /** A live Pixi.js Ticker so it can be used to trigger updates. */
    public readonly ticker = new Ticker();

    public readonly stage = new Container();

    public readonly screen = new Rectangle(0, 0, 1000, 1000);

    constructor(options?: Partial<ApplicationOptions>) {
        this.ticker.autoStart = false;

        if (options?.width != undefined) {
            this.screen.width = options.width;
        }
        if (options?.height != undefined) {
            this.screen.height = options.height;
        }
    }
}
