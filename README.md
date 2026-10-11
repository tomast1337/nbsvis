# nbsvis

[![Build](https://github.com/Bentroen/nbsvis/actions/workflows/check.yml/badge.svg)](https://github.com/Bentroen/nbsvis/actions/workflows/check.yml)

Web player and visualizer for Note Block Studio songs

## Package

**`@opennbs/nbsvis`** is the only package you need to install. It contains:

- the core (`Player`, song loading, the `NbsvisViewerBackend` / `NbsvisAudioBackend` contracts, `NoteBuffer`, and the default Web Audio engine). The core entry imports nothing else.
- an optional Pixi.js viewer, exposed as `@opennbs/nbsvis/pixi`. `pixi.js` is an optional peer dependency: install it (`pnpm add pixi.js`) only if you use `PixiViewer`.

Bring your own viewer or audio backend by implementing the contracts exported from `@opennbs/nbsvis`.

## Usage

Create a viewer backend (typically `PixiViewer` from `@opennbs/nbsvis/pixi`), mount it, initialize Pixi, then construct `Player` with `viewerBackend` and optional `webAudio` options:

```ts
import { Player } from '@opennbs/nbsvis';
import { PixiViewer } from '@opennbs/nbsvis/pixi';

const viewer = new PixiViewer();
viewer.mount(container);
viewer.setViewMode('piano-roll');
await viewer.init();

const player = new Player({
  viewerBackend: viewer,
  webAudio: { urlBase: import.meta.env.BASE_URL },
});
```

## Configurable worker/worklet URL base

Pass `urlBase`, or explicit `workerUrl` / `workletUrl`, via `webAudio` when using the default Web Audio engine, or inject a custom `audioBackend` that implements `NbsvisAudioBackend`.

## Release

Automated releases are handled with semantic-release on pushes to `main`.
See `docs/releasing.md` for commit conventions, required repository secrets, and workflow behavior.

Why don't we bundle?
https://e18e.dev/blog/bundling-dependencies
