# Shared Core Boundary

This directory contains platform-neutral domain logic intended to be shared by
the Web and future Expo clients.

Core modules may depend only on other modules in this directory and JavaScript
language APIs. They must not import React, Zustand, Web pages, stores, assets,
or browser APIs such as `window`, `document`, and `localStorage`.

Use `src/core/index.ts` as the public API. Existing Web import paths remain as
compatibility re-exports while modules are migrated incrementally.
