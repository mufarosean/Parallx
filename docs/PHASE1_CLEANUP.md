# Phase 1 Cleanup — Bottom-Up Refactor Plan

> **Branch:** `phase1-cleanup` (from `milestone-3` @ `4358c1e`)
>
> **Principle:** Clean bottom-up following the dependency graph. Verify (`tsc --noEmit` + `node scripts/build.mjs`) after every layer. One commit per layer. No functional changes — only dead code removal, deduplication, naming, and structure.

---

## Progress Tracker

| # | Layer | Status | Commit |
|---|-------|--------|--------|
| 1 | `platform/` | ⬜ Not started | — |
| 2 | `layout/` | ⬜ Not started | — |
| 3 | `context/` + `configuration/` | ⬜ Not started | — |
| 4 | `dnd/` + `ui/` | ⬜ Not started | — |
| 5 | `commands/` + `contributions/` | ⬜ Not started | — |
| 6 | `editor/` | ⬜ Not started | — |
| 7 | `parts/` | ⬜ Not started | — |
| 8 | `services/` | ⬜ Not started | — |
| 9 | `views/` + `tools/` | ⬜ Not started | — |
| 10 | `api/` | ⬜ Not started | — |
| 11 | `built-in/` | ⬜ Not started | — |
| 12 | `workbench/` | ⬜ Not started | — |
| 13 | `electron/` | ⬜ Not started | — |
| 14 | Top-level (config, docs, CSS) | ⬜ Not started | — |

---

### Cleanup Philosophy

> **Rule:** Anything currently unused but part of VS Code's structural patterns is **kept** —
> these are pre-positioned for future milestones. Only remove true dead code: duplicates,
> redundancies, deprecated wrappers, and generic fluff with no VS Code lineage.

## Layer 1 — `src/platform/` (7 files, ~1,820 lines)

Foundation layer. 176 imports reference `platform/` from the rest of the codebase.

### Issues Found & Resolved

#### 1.1 — `types.ts`: Duplicate URI interface ✅ REMOVED
- **Problem:** `types.ts` defined a `URI` interface that duplicates the `URI` class in `uri.ts`. Never imported.
- **Fix:** Removed the interface. The class in `uri.ts` is the canonical type.

#### 1.2 — `types.ts`: Unused generic utility types ✅ REMOVED
- **Problem:** `VoidFunction` (shadows global), `MaybePromise<T>`, `Optional<T>`, `Constructor<T>` — generic convenience types, not VS Code patterns, never imported.
- **Fix:** Removed all four.

#### 1.3 — `events.ts`: Deprecated legacy helpers ✅ REMOVED
- **Problem:** `onceEvent()`, `debounceEvent()`, `listenTo()` — explicitly `@deprecated`, redundant wrappers around `EventUtils.*`, never imported.
- **Fix:** Removed all three.

#### 1.4 — `lifecycle.ts`: Unused VS Code pattern utilities ⏭️ KEPT
- `MutableDisposable`, `RefCountDisposable`, `AsyncDisposable`, `AsyncDisposableStore`, `combinedDisposable`, `safeDispose`, `isDisposable`, `markAsDisposed`, disposal tracking — all VS Code patterns for future milestones.

#### 1.5 — `storage.ts`: Unused VS Code pattern classes ⏭️ KEPT
- `InMemoryStorage`, `IndexedDBStorage`, `NamespacedSyncStorage`, `ISyncStorage`, `migrateStorage` — all VS Code patterns.

#### 1.6 — `uri.ts`: `uriCompare()` ⏭️ KEPT
- Common VS Code sorting utility. Trivially small.

#### 1.7 — No structural/naming issues
- File naming consistent, exports consistent, JSDoc good, no circular imports.

---

## Layer 2 — `src/layout/` (7 files)

Assessment pending. Will be done after Layer 1 is complete and verified.

## Layer 3 — `src/context/` + `src/configuration/` (7 files)

Assessment pending.

## Layer 4 — `src/dnd/` + `src/ui/` (~14 files)

Assessment pending.

## Layer 5 — `src/commands/` + `src/contributions/` (~9 files)

Assessment pending.

## Layer 6 — `src/editor/` (7 files)

Assessment pending.

## Layer 7 — `src/parts/` (10 files)

Assessment pending.

## Layer 8 — `src/services/` (~13 files)

Assessment pending.

## Layer 9 — `src/views/` + `src/tools/` (~10 files)

Assessment pending.

## Layer 10 — `src/api/` (~10 files)

Assessment pending.

## Layer 11 — `src/built-in/` (~10 files)

Assessment pending.

## Layer 12 — `src/workbench/` (2-3 files)

Assessment pending.

## Layer 13 — `electron/` (2 files)

Assessment pending.

## Layer 14 — Top-level (config, docs, CSS)

Assessment pending.
