# @antha/web-test-runner-plugin-pixi

This package provides a web-test-runner plugin that resolves direct `pixi.js` imports to PixiJS's browser-compatible bundle. Use it when browser tests that import PixiJS and use web-test-runner.

## Install

```sh
npm i -D @antha/web-test-runner-plugin-pixi
```

## Usage

Make sure all your `pixi.js` imports are directly from `pixi.js` (like `import {Application} from 'pixi.js'`), not from any of its sub paths.

Add the following to your web-test-runner config:

<!-- example-link: src/readme-examples/configuring-pixi-plugin.example.ts -->

```TypeScript
import {pixiPlugin} from '@antha/web-test-runner-plugin-pixi';

export default {
    plugins: [
        pixiPlugin(),
    ],
};
```
