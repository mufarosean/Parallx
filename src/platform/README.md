# platform

The basics with no DOM, and no imports from anywhere else in `src`:
`events.ts` (`Emitter`, `Event`), `lifecycle.ts` (`IDisposable`,
`Disposable`, `DisposableStore`), `storage.ts` and `fileBackedStorage.ts`,
`uri.ts`, `localTime.ts` (the app clock and Time Zone), `instantiation.ts`
(service ids for dependency injection), `rafThrottle.ts`.

Entry: no single one; each file is a leaf.
May import: nothing else in `src`.
May not import: anything above it.
