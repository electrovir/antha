# @antha/web-test-runner-plugin-pixi

A plugin for [web-test-runner](https://modern-web.dev/docs/test-runner/overview/) that transforms pixi.js imports to be compatible with browsers.

## Install

```sh
npm i -D web-test-runner-plugin-pixi
```

## Usage

Make sure all your `pixi.js` imports are directly from `pixi.js` (like `import {Application} from 'pixi.js'`), not from any of its sub paths.

Add the following to your web-test-runner config:

```ts
import {pixiPlugin} from 'web-test-runner-plugin-pixi';

export default {
    plugins: [
        pixiPlugin(),
    ],
};
```
