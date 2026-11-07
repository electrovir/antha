# @antha/entity-core

Entity logic shared by every [Antha](https://www.npmjs.com/package/@antha/engine) entity package: the entity store, entity definitions, the fixed-step update mod, collision categories, snapshots for lock-step multiplayer, and entity asset loading. It has no renderer or physics engine of its own.

Games should install an entity package built on this one, like [`@antha/entity-2d`](https://www.npmjs.com/package/@antha/entity-2d), which re-exports everything here.

## Install

```sh
npm i @antha/entity-core
```

## Building an entity package

An entity package connects one physics engine and one renderer to this package:

1. Implement `PhysicsWorld` for the physics engine. Its `bodyStateShape` defines what each entity's body saves in snapshots, and `step` reports which entity ids started and stopped touching.
2. Extend `BaseEntity` to give entities a view. Override `initInstance` to create it and `destroyView` to release it.
3. Extend `EntityStore` and implement `placeView`, which moves a view to its body blended between the last two steps, and `detachView`, which takes a view off the screen.
4. Call `createEntitySuite` with the base entity class and a `createEntityStore` function that builds the store (and its physics world) from game state, then wrap the returned `defineEntity` with types for the package's own entity class.
