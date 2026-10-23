# @antha/multiplayer-core

This package provides the room, signaling, WebRTC, and identifier utilities behind the [Antha game engine](https://www.npmjs.com/package/@antha/engine)'s peer-to-peer multiplayer features. Use it directly to build a custom multiplayer strategy, or use one of the strategy packages for a ready-made approach.

## Install

```sh
npm i @antha/multiplayer-core
```

## Default STUN server

By default, multiplayer connections use Cloudflare's public STUN server (`stun.cloudflare.com:3478`), a third-party service. Every client sends a request to it, which exposes that client's public IP address to Cloudflare. This helps peers on different networks find a route to each other.

To change this, set `stunServerUrls` when calling `initMultiplayer`:

-   Use your own STUN servers: `stunServerUrls: ['stun.example.com:3478']`
-   Use no STUN server at all: `stunServerUrls: []`

Omitting `stunServerUrls` (or setting it to `undefined`) uses the Cloudflare default, exported as `defaultStunServerUrls`.

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
