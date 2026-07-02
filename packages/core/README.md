# @life-quest/core

This package contains platform-neutral domain logic intended to be shared by the
Web and future Expo clients.

Core modules may depend only on other modules in this directory and JavaScript
language APIs. They must not import React, Zustand, Web pages, stores, assets,
or browser APIs such as `window`, `document`, and `localStorage`.

Use `@life-quest/core` as the public API for cross-platform code. Existing Web
import paths remain as compatibility re-exports while modules are migrated
incrementally.

The shared domains currently include tasks, habits, equipment and synthesis,
battle skills, persistence, validation, numeric helpers, and HP display rules.
