# @antha/multiplayer-core

This package provides the room, signaling, WebRTC, and identifier utilities behind the [Antha game engine](https://www.npmjs.com/package/@antha/engine)'s peer-to-peer multiplayer features. Use it directly to build a custom multiplayer strategy, or use one of the strategy packages for a ready-made approach.

## Install

```sh
npm i @antha/multiplayer-core
```

## Usage

<!-- example-link: src/readme-examples/creating-multiplayer-client.example.ts -->

```TypeScript
import {createMultiplayerApiClient, createMultiplayerId} from '@antha/multiplayer-core';

const roomId = createMultiplayerId.room();
const multiplayerApiClient = await createMultiplayerApiClient({
    backendOrigin: 'http://localhost:9348',
    portScanOptions: false,
});
```
