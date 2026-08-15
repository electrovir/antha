# @antha/multiplayer-server

This package provides the server that [Antha](https://www.npmjs.com/package/@antha/engine) multiplayer clients use for room discovery and WebRTC signaling. It is only used for listing and connecting to rooms. Actual game state transfer is expected to be p2p.

## Install

```sh
npm i @antha/multiplayer-server
```

## API

<!-- example-link: src/readme-examples/starting-server.example.ts -->

```TypeScript
import {AnyOrigin} from '@rest-vir/api';
import {startMultiplayerServer} from '@antha/multiplayer-server';

await startMultiplayerServer({
    backendOrigin: 'http://localhost:9348',
    games: {
        default: AnyOrigin,
    },
    host: 'localhost',
    lockPort: true,
    port: 9348,
});
```

## CLI

The `start-mp-server` command accepts a required path to a JavaScript, TypeScript, JSON, YAML, or TOML configuration file. The configuration uses the same options as `startMultiplayerServer`.

Create a configuration file:

<!-- example-link: src/readme-examples/multiplayer-server-config.example.ts -->

```TypeScript
export default {
    games: {
        byId: {
            'example-game-id': 'https://electrovir.github.io',
        },
    },
    host: '127.0.0.1',
    lockPort: true,
    port: 9348,
};
```

Start the server with the configuration file path:

```sh
npx start-mp-server ./multiplayer-server.config.mjs
```
