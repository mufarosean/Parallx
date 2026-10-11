# ext

The nine extensions shipped with the app, loaded like any third-party
extension: Browser, Budget, Concept Lab, Creations AI, Flashcards, Atelier
(`media-organizer`), Study, Web Research, Workspace Graph. Each has a
`parallx-manifest.json` and a `main.js` that exports `activate()`; the
loader resolves relative imports, so an extension may be many files.
`ext/study/main.js` is generated from `ext/study/src/` by
`scripts/bundle-study.mjs`.

An extension sees only `api.*` (see `docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md`).
`scripts/package-extension.mjs <folder>` packages one as a `.plx`.
