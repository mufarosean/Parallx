# Parallx Redesign Running Log

> Format: append-only. Newest iteration at top. Each entry has a date and a
> commit hash where applicable. The agent updates this every iteration. The
> user reads this to monitor progress without sitting at the keyboard.

---

## Iteration 23 — Slice A22: resourceEquals() + SurfaceRegistry.findByResource() (2026-05-25)

Two pure-additive primitives:

1. **`resourceEquals(a, b): boolean`** — structural Resource equality
   in `resource.ts`. Compares by `type` + type-specific identity:
   - `file` → `path` + `workspaceId` (`hash` is metadata, NOT identity)
   - `canvas-page` → `pageId` + `blockId` + `workspaceId`
   - `chat-session` → `sessionId` + `turnId` + `workspaceId`
   - `tool-artifact` → `toolId` + `artifactId` + `workspaceId`
   - `external` → `uri`

2. **`ISurfaceRegistry.findByResource(resource)`** — returns every
   surface currently showing a structurally-equal Resource. Powers
   "is this resource already open?", "reveal in editor", and dedup
   of resource-aware command targets. Surfaces with no resource are
   never matched. Returns fresh snapshot in insertion order.

**Files**

- `src/workbench/resources/resource.ts` — `resourceEquals()` export
- `src/workbench/resources/surfaceRegistry.ts` — interface + impl
- `tests/unit/platform/resourceEquals.tier0.test.ts` (15 tests)
- `tests/unit/platform/surfaceRegistryFindByResource.tier0.test.ts`
  (7 tests)

**Verification**

- `npm run test:unit:tier0 -- --run`: 31 files / 291 passed
  (22 new — 15 + 7).
- `npx tsc --noEmit`: clean.

**Commit**: pending
**Review**: single-pass — tier-0 corpus green + tsc clean.

---

## Iteration 22 — Slice A21: IToolArtifactStore.deleteByWorkspace() (2026-05-25)

Pure-additive `deleteByWorkspace(workspaceId): number` counterpart to
`deleteByTool`. Bulk-removes every artifact whose `workspaceId`
matches. Designed for workspace-close cleanup so per-workspace
tool outputs don't linger after the workspace is unloaded.

**Behavior**

- Returns count of removed records.
- Empty `workspaceId` → 0 with no events.
- Records with no `workspaceId` are never matched.
- Fires `onDidChange` once per removed record in insertion order.

**Files**

- `src/workbench/toolArtifactStore.ts` — interface + impl
- `tests/unit/platform/toolArtifactStoreDeleteByWorkspace.tier0.test.ts`
  (7 tests)

**Verification**

- `npm run test:unit:tier0 -- --run`: 29 files / 268 passed (7 new).
- `npx tsc --noEmit`: clean.

**Commit**: pending
**Review**: single-pass — tier-0 corpus green + tsc clean.

---

## Iteration 21 — Slice A20: IResourceRegistry.resolveSafe() (2026-05-25)

Pure-additive non-throwing variant of `resolve` / `resolveUri`. Returns
a discriminated union `{ ok:true; value } | { ok:false; reason; error? }`
where `reason ∈ 'malformed-uri' | 'no-resolver' | 'failed'`. Removes
the asymmetry between `resolve` (throws) and `resolveUri` (returns
`null` only for malformed URIs).

**Behavior**

- Accepts `Resource | string | null | undefined`.
- `null`/`undefined`/non-object/non-`{type:string}` → `malformed-uri`.
- Unparseable URI string → `malformed-uri`.
- Type with no registered resolver → `no-resolver`.
- Resolver throws → `failed` with the error attached.
- Never rejects.

**Files**

- `src/workbench/resources/resourceRegistry.ts` — interface + impl,
  new `ResolveSafeResult<T>` discriminated-union export.
- `tests/unit/platform/resourceRegistryResolveSafe.tier0.test.ts`
  (8 tests)

**Verification**

- `npm run test:unit:tier0 -- --run`: 28 files / 261 passed (8 new).
- `npx tsc --noEmit`: clean.

**Commit**: pending
**Review**: single-pass — tier-0 corpus green + tsc clean.

---

## Iteration 20 — Slice A19: ISelectionService introspection (2026-05-25)

Pure-additive `surfaceIds(): readonly string[]` and
`entries(): ReadonlyArray<{surfaceId, selection}>` on
`ISelectionService` (and `SelectionService` impl). Lets diagnostics,
when-clause builders, and AI context retrieval enumerate active
surfaces without subscribing to every change event.

**Behavior**

- Insertion order = order of first `setSelection(surfaceId, …)`.
- Re-writes to the same surface preserve original position.
- Clearing a surface removes it from both methods.
- `entries()` carries the A7 auto-populated `selection.resource`.
- Both return fresh snapshots independent of later mutations.

**Files**

- `src/services/serviceTypes.ts` — interface additions
- `src/services/selectionService.ts` — impl
- `tests/unit/platform/selectionServiceIntrospection.tier0.test.ts`
  (8 tests)

**Verification**

- `npm run test:unit:tier0 -- --run`: 27 files / 253 passed (8 new).
- `npx tsc --noEmit`: clean.

**Commit**: pending
**Review**: single-pass — tier-0 corpus green + tsc clean.

---

## Iteration 19 — Slice A18: ISurfaceRegistry.listByKind() filter (2026-05-25)

Pure-additive `listByKind(kind: SurfaceKind): ReadonlyArray<Surface>`
on the surface registry. Powers diagnostics ("show me every open
editor"), AI-context retrieval ("what canvas pages are open?"), and
command availability filters.

**Behavior**

- Returns surfaces whose `kind === kind` in insertion order.
- Returns a fresh snapshot independent of later mutations.
- Reflects `update()` replacements without duplicating.
- Accepts open-string kinds (extension-defined `extension:*` etc.).

**Files**

- `src/workbench/resources/surfaceRegistry.ts` — interface + impl
- `tests/unit/platform/surfaceRegistryListByKind.tier0.test.ts`
  (7 tests)

**Verification**

- `npm run test:unit:tier0 -- --run`: 26 files / 245 passed
  (7 new from this slice).
- `npx tsc --noEmit`: clean.

**Commit**: pending
**Review**: single-pass — tier-0 corpus green + tsc clean.

---

## Iteration 18 — Slice A17: IResourceRegistry.canResolve() (2026-05-25)

Pure-additive `canResolve(target: Resource | string): boolean` on the
registry. Powers "should I show this resource as a clickable link?"
gating, command availability, and "can I attach this to chat?" checks
without forcing callers to do their own parse + has() pairing.

**Behavior**

- For a `Resource`: checks `has(target.type)`.
- For a `string`: parses via `parallxUri.parse()` first; returns
  `false` if unparseable, otherwise `has(parsed.type)`.
- Defensive against non-object / wrong-shape inputs.

**Files**

- `src/workbench/resources/resourceRegistry.ts` — interface + impl
- `tests/unit/platform/resourceRegistryCanResolve.tier0.test.ts`
  (8 tests)

**Verification**

- `npm run test:unit:tier0 -- --run`: 25 files / 238 passed
  (8 new from this slice).
- `npx tsc --noEmit`: clean.

**Commit**: pending
**Review**: single-pass — tier-0 corpus green + tsc clean.

---

## Iteration 17 — Slice A16: IToolArtifactStore.deleteByTool() bulk cleanup (2026-05-25)

Pure-additive bulk `deleteByTool(toolId): number` on the artifact store.
Powers tool-unload cleanup, "discard all web-research results" UX, and
test-suite teardown without forcing callers to enumerate via `list()`.

**Behavior**

- Returns count removed.
- Fires `onDidChange` once per removed record (kind: 'delete') in
  insertion order.
- Empty `toolId` returns 0 without firing events.
- Iterates over a pre-collected key list, so map mutation semantics
  don't matter.

**Files**

- `src/workbench/toolArtifactStore.ts` — interface + impl
- `tests/unit/platform/toolArtifactStoreDeleteByTool.tier0.test.ts`
  (7 tests)

**Verification**

- `npm run test:unit:tier0 -- --run`: 24 files / 230 passed
  (7 new from this slice).
- `npx tsc --noEmit`: clean.

**Commit**: pending
**Review**: single-pass — tier-0 corpus green + tsc clean.

---

## Iteration 16 — Slice A15: IToolArtifactStore.list() query API (2026-05-25)

Pure-additive `list(toolId?): readonly ToolArtifactRecord[]` method on
the artifact store. Powers future diagnostics surfaces (e.g.
"artifacts produced by web-research this session"), gives consumers a
way to enumerate without subscribing to `onDidChange` from boot, and
keeps the workbench-internals observable from a single canonical
service.

**Behavior**

- `list()` returns every record in insertion order.
- `list(toolId)` returns only records whose `toolId === toolId`,
  insertion order preserved.
- The returned array is a fresh snapshot — subsequent puts/deletes
  don't mutate it.

**Files**

- `src/workbench/toolArtifactStore.ts` — interface + impl
- `tests/unit/platform/toolArtifactStoreList.tier0.test.ts` (8 tests)

**Verification**

- `npm run test:unit:tier0 -- --run`: 23 files / 223 passed
  (8 new from this slice).
- `npx tsc --noEmit`: clean.

**Commit**: pending
**Review**: single-pass — tier-0 corpus green + tsc clean.

---

## Iteration 15 — Slice A14: ContextService.activeResource derived field (2026-05-25)

Pure-additive enrichment of `WorkbenchContext` with an `activeResource`
field derived from `activeSelection.resource` (populated automatically
by SelectionService in slice A7). Consumers of context (when-clauses,
context keys, command availability, future AI retrieval glue) now have
a typed Resource hook without having to reach into the loose
`ContextSelectionLike` shape.

**Behavior**

- `ContextService._snapshot()` reads `selection.resource` via a
  duck-typed `extractResource()` helper: any object with a string
  `type` is treated as a `Resource`. Missing / non-object / wrong-shape
  values yield `undefined`.
- `_maybeFire()` adds `activeResource` to its dedup check so the event
  fires when the derived resource changes (typically tied to selection
  change anyway).
- All existing tier-0 contextService tests still pass — they used
  `toEqual` against shape literals; vitest treats `undefined` own
  properties as equivalent to missing in those comparisons.

**Files**

- `src/workbench/resources/contextService.ts`
  - import `Resource` type from `resource.js`
  - `WorkbenchContext.activeResource: Resource | undefined`
  - `_snapshot()` reads selection once and derives resource via
    `extractResource(selection)`
  - `_maybeFire()` includes `activeResource` in coalescing check
  - new `extractResource(selection)` helper (file-local)
- `tests/unit/platform/contextServiceActiveResource.tier0.test.ts`
  (7 tests covering: undefined when no selection, undefined when
  selection has no resource field, FileResource extraction,
  ExternalResource extraction, fires on selection change, rejects
  non-object resource, rejects resource without type)

**Verification**

- `npm run test:unit:tier0 -- --run`: 22 files / 215 passed
  (7 new from this slice).
- `npx tsc --noEmit`: clean.

**Commit**: pending
**Review**: single-pass — tier-0 corpus green + tsc clean.

---

## Iteration 14 — Slice A13: ResourceRegistry introspection (2026-05-25)

Adds two pure-additive read APIs to `IResourceRegistry`:

- `types(): readonly ResourceType[]` — snapshot of registered types in
  insertion order. Fresh array per call (callers can't mutate state).
- `onDidChange: Event<ResourceRegistryChangeEvent>` — fires on
  register / override / unregister with `{ type, kind }` where `kind`
  is `'register'` on first add (even via `override()`), `'override'`
  on replace, and `'unregister'` on actual removal (no-op unregisters
  do not fire).

Enables diagnostics commands, status surfaces, and consumers that need
to react to new resolver registrations (e.g. when an extension
contributes a custom Resource type).

**Files**

- `src/workbench/resources/resourceRegistry.ts`
  - import `Emitter, Event` from `platform/events.js`
  - exported `ResourceRegistryChangeEvent` type
  - `IResourceRegistry.types()` + `IResourceRegistry.onDidChange`
  - `ResourceRegistry` emits change events from register/override/
    unregister; `override` distinguishes 'override' vs 'register'
    based on prior presence.
- `tests/unit/platform/resourceRegistryIntrospection.tier0.test.ts`
  (8 tests)

**Verification**

- `npm run test:unit:tier0 -- --run`: 21 files / 208 passed
  (8 new from this slice).
- `npx tsc --noEmit`: clean.

**Commit**: `fb907e75`
**Review**: single-pass — tier-0 corpus green + tsc clean.

---

## Iteration 13 — Slice A12: publishToolArtifact helper (2026-05-25)

**Continuation of:** A10 created the store, A11 verified end-to-end
resolution. This slice provides the canonical *write* path: a small
helper that bundles "store record + return URI" so tools (extensions,
web research, agents) don't reinvent the pairing.

**Done:**

- New `src/workbench/toolArtifactPublisher.ts` (~55 LOC).
- `publishToolArtifact(store, input): { uri, record }`:
  - Validates non-empty `toolId` / `artifactId`.
  - Builds a `ToolArtifactRecord` (timestamp defaults to `Date.now()`).
  - Calls `IToolArtifactStore.put`.
  - Returns the canonical `parallx://tool-artifact:<tool>/<id>[?workspace=...]`
    URI via `serialize()` so the value can be embedded in chat
    attachments, canvas blocks, or links.

The helper closes the producer side of the tool-artifact loop:
producers call `publishToolArtifact`; consumers call
`registry.resolveUri(uri)`. Both sides talk to the same store, never
to each other.

**Files:** `src/workbench/toolArtifactPublisher.ts` (new),
`tests/unit/platform/toolArtifactPublisher.tier0.test.ts` (8 tests
incl. round-trip-via-registry).

**Verification:** tier-0 20 files / 200 passed (8 new). `tsc --noEmit`
clean.

**§13a:** Pure workbench addition, no preservation surface touched.
`single-pass-review: tier-0-tests-pass-typecheck-clean`.

**Commits this iteration:** `<pending>`.

---

## Iteration 12 — Slice A11: ResourceRegistry end-to-end integration test (2026-05-25)

**Continuation of:** A10 wired the third resolver (tool-artifact). The
primitive layer is now production-shaped. This slice adds an
integration test that proves `resolveUri` works end-to-end through the
exact composition the facade performs.

**Done:**

- New tier-0 test `resourceRegistryEndToEnd.tier0.test.ts` (6 tests).
  Assembles `ResourceRegistry` + `fileResourceResolver` +
  `externalResourceResolver` + `toolArtifactResourceResolver` against
  minimal fakes (the same composition `workbenchFacadeFactory.ts`
  performs) and asserts:
  - `parallx://file:<encoded-path>` returns file content.
  - `https://...` returns external pass-through.
  - `mailto:...` returns external pass-through.
  - `parallx://tool-artifact:<tool>/<id>` returns stored record.
  - Unknown tool-artifact id rejects with "not found".
  - Malformed URI resolves to `null`.

Closes the verification gap: until A11, each resolver had unit tests
in isolation but no test exercised them through the registry's
`resolveUri` parse-and-dispatch path together. A regression in
`parallxUri.parse()`, the registry's dispatch, or any resolver wiring
will now fail this test.

**Files:** `tests/unit/platform/resourceRegistryEndToEnd.tier0.test.ts`
(new). No production code changed.

**Verification:** tier-0 19 files / 192 passed (6 new). `tsc --noEmit`
clean.

**§13a:** Test-only addition; no preservation surface touched.
`single-pass-review: tier-0-tests-pass-typecheck-clean`.

**Commits this iteration:** `<pending>`.

---

## Iteration 11 — Slice A10: InMemoryToolArtifactStore + tool-artifact resolver wired (2026-05-25)

**Continuation of:** Slice A9 left `tool-artifact` as a resolver class
with no source service in scope. This slice creates the source service
in the workbench itself and wires it through.

**Done:**

- New `IToolArtifactStore` service identifier and
  `InMemoryToolArtifactStore` implementation: in-memory `Map`-backed
  store of `ToolArtifactRecord` keyed by `(toolId, artifactId)`. Emits
  `onDidChange { kind: 'put' | 'delete' }`. Disposable.
- Service registered in `workbenchFacadeFactory.ts`.
- `ToolArtifactResourceResolver` registered against the store via an
  inline `{ getArtifact: (toolId, id) => store.get(toolId, id) }`
  adapter. `resolveUri('parallx://tool-artifact:<tool>/<id>')` now
  works end-to-end (returns `{ resource, artifact: ToolArtifactRecord }`
  for stored entries; rejects with "not found" for missing).

Resolver matrix after A10:

| ResourceType | Resolver class | Wired in registry |
|---|---|---|
| `file` | `FileResourceResolver` | ✓ (A6) |
| `external` | `ExternalResourceResolver` | ✓ (A9) |
| `tool-artifact` | `ToolArtifactResourceResolver` | ✓ (A10 here) |
| `canvas-page` | `CanvasPageResourceResolver` | — (source service not in scope) |
| `chat-session` | `ChatSessionResourceResolver` | — (source service not in scope) |

Three of five `ResourceType`s now resolve end-to-end. Persistence for
the artifact store (per-workspace, per-conversation) is a future slice
— the in-memory store gives extensions, web-research, and agent
artifacts an immediate concrete home.

**Files:** `src/workbench/toolArtifactStore.ts` (~80 LOC),
`src/services/serviceTypes.ts` (+10, identifier block),
`src/workbench/workbenchFacadeFactory.ts` (+~15, wiring),
`tests/unit/platform/toolArtifactStore.tier0.test.ts` (8 tests).

**Verification:** tier-0 18 files / 186 passed (8 new). `tsc --noEmit`
clean.

**§13a:** All new files in `src/workbench/`. `workbenchFacadeFactory.ts`
edit is purely additive registration. `serviceTypes.ts` edit appends a
new identifier block (no existing identifier touched). Recording
`single-pass-review: tier-0-tests-pass-typecheck-clean`.

**Commits this iteration:** `<pending>`.

---

## Iteration 10 — Slice A9: tool-artifact & external resolvers + external wiring (2026-05-25)

**Continuation of:** Slices A6 + A8 introduced three resolvers. This
slice closes the resolver matrix for all five `ResourceType`s and wires
the external resolver into `IResourceRegistry`.

**Done:**

- `ToolArtifactResourceResolver` (type `tool-artifact`) — takes
  `ToolArtifactSource { getArtifact(toolId, artifactId) }`. Rejects on
  empty ids and on `undefined`/`null` lookups.
- `ExternalResourceResolver` (type `external`) — echoes the URI
  unchanged. Network fetching for `http(s):` URIs intentionally stays
  in the web-research extension's bounded egress chokepoint
  (`electron/webFetchBridge.cjs`), which has its own security model.
  Registered into `IResourceRegistry` at facade-factory time (no source
  service required).

Resolver matrix coverage:

| ResourceType | Resolver class | Wired in registry |
|---|---|---|
| `file` | `FileResourceResolver` | ✓ (Slice A6) |
| `external` | `ExternalResourceResolver` | ✓ (Slice A9 here) |
| `canvas-page` | `CanvasPageResourceResolver` | — (source service not in scope) |
| `chat-session` | `ChatSessionResourceResolver` | — (source service not in scope) |
| `tool-artifact` | `ToolArtifactResourceResolver` | — (source service not in scope) |

**Files:** `src/workbench/resources/resolvers/toolArtifactResolver.ts`
(~45 LOC), `src/workbench/resources/resolvers/externalResolver.ts`
(~35 LOC), `src/workbench/workbenchFacadeFactory.ts` (+5 wiring lines),
two tier-0 test files (5 + 4 tests).

**Verification:** tier-0 17 files / 178 passed (9 new). `tsc --noEmit`
clean.

**§13a:** All new files in `src/workbench/resources/resolvers/`
(non-preservation). `workbenchFacadeFactory.ts` wiring is purely
additive registration. Recording
`single-pass-review: tier-0-tests-pass-typecheck-clean`.

**Commits this iteration:** `<pending>`.

---

## Iteration 9 — Slice A8: canvas-page & chat-session Resource resolvers (2026-05-25)

**Continuation of:** Slice A6 introduced the first resolver (file). This
slice adds the next two with the same shape so the registry now knows
how to talk to three of the five `ResourceType`s.

**Done:** Two new resolver classes, each taking a minimal source-service
interface so the resolver stays tier-0 testable and never crosses the
canvas-data or AI-chat preservation/off-limits boundaries:

- `CanvasPageResourceResolver` (type `canvas-page`) — takes
  `CanvasPageSource { getPage(pageId) }`.
- `ChatSessionResourceResolver` (type `chat-session`) — takes
  `ChatSessionSource { getSession(sessionId) }`.

Both reject on empty id and on `undefined`/`null` lookups (page/session
not found). Both integrate cleanly with `ResourceRegistry.resolveUri`,
verified end-to-end in tier-0 tests.

**Not yet wired:** registration into `IResourceRegistry` is deferred
until a canvas-page service and a chat-session source are reachable at
`workbenchFacadeFactory` time without crossing the preservation /
off-limits lines. The resolver classes themselves are pure-additive and
ready to be plugged in by a future slice.

**Files:** `src/workbench/resources/resolvers/canvasPageResolver.ts`
(~45 LOC), `src/workbench/resources/resolvers/chatSessionResolver.ts`
(~45 LOC), two tier-0 test files (5 tests each).

**Verification:** tier-0 15 files / 169 passed (10 new). `tsc --noEmit`
clean.

**§13a:** All new files live in `src/workbench/resources/resolvers/`
(non-preservation). No existing files modified. Recording
`single-pass-review: tier-0-tests-pass-typecheck-clean`.

**Commits this iteration:** `<pending>`.

---

## Iteration 8 — Slice A7: SelectionService auto-populates selection.resource (2026-05-25)

**Continuation of:** Unified Workbench Primitives — making the optional
`ISelection.resource` field (added in A5) actually populated for the
common case.

**Done:** `SelectionService.setSelection` now derives a `FileResource`
from `selection.source.filePath` via `resourceFromSelectionSource()`
when the caller didn't supply `selection.resource`. Pure-additive:

- Existing callers that already set `resource` are respected — auto-fill
  only fires when the field is `undefined`.
- Callers with empty/missing `filePath` get `undefined` (no fabrication).
- The enriched selection is what subscribers receive on
  `onDidChangeSelection`, so downstream consumers (chat retrieval,
  when-clauses, link resolution) see the Resource without changing
  upstream callers.

This is the bridge between the primitive layer (A1–A6) and consumer
migration: every text selection that flows through `SelectionService`
now carries a stable cross-tool identity by default.

**Files:** `src/services/selectionService.ts` (+ import + ~12 LOC in
`setSelection`), `tests/unit/platform/selectionResourceAutoPopulate.tier0.test.ts`
(5 tests).

**Verification:** tier-0 13 files / 159 passed (5 new). `tsc --noEmit`
clean.

**§13a:** `selectionService.ts` lives in `src/services/` — not a
preservation-listed surface. Pure-additive enrichment behind a guard;
no existing call path changes semantics. Recording
`single-pass-review: tier-0-tests-pass-typecheck-clean`.

**Commits this iteration:** `<pending>`.

---

## Iteration 7 — Slice A6: file Resource resolver (2026-05-25)

**Continuation of:** Unified Workbench Primitives. First actual resolver
populates the ResourceRegistry.

**Done:** New `FileResourceResolver` reads a `FileResource` via
`IFileService.readFile` and returns `{ resource, content }`. Registered
into `IResourceRegistry` at workbench facade-factory time so any
consumer can now call:

```
resourceRegistry.resolveUri('parallx://file:' + encodeURIComponent(path))
```

and get back the file's content as a string, without re-implementing
URI parsing or file-service plumbing.

Pure-additive: no consumer reads from `resolveUri` yet. The resolver is
exercised end-to-end by tier-0 tests (registry.resolveUri → parseUri →
file.readFile mocked → content returned).

This is the first move that turns the registry from "empty container"
into "useful service". Future slices register canvas-page, chat-session,
and tool-artifact resolvers and migrate consumers (chat retrieval,
LinkResolverService, extension API) to call `resolveUri` once instead
of stitching their own per-type dispatch.

**Files:** `src/workbench/resources/resolvers/fileResolver.ts` (~45 LOC),
`tests/unit/workbench/resources/resolvers/fileResolver.tier0.test.ts`
(7 tests), `src/workbench/workbenchFacadeFactory.ts` (+10, registration).

**Verification:** tier-0 12 files / 154 passed (7 new). `tsc --noEmit`
clean.

**§13a:** Single-line registration block in facade factory; no preservation
surface touched. Recording
`single-pass-review: tier-0-tests-pass-typecheck-clean`.

**Commits this iteration:** `<pending>`.

---

## Iteration 6 — Slice A5: ISelection.resource + selection→Resource adapter (2026-05-25)

**Continuation of:** Unified Workbench Primitives. Slice A primitive
layer was complete in A4; this slice makes the bridge from the existing
selection world into the new Resource world.

**Done:**

1. Added optional `resource?: Resource` field to `ISelection` so selection
   adapters can carry a stable cross-tool identity alongside their
   text payload. Pure-additive: every existing call-site is unaffected.
2. Added `resourceFromSelectionSource({ filePath, pageNumber?, workspaceId? })`
   helper. One line converts a selection's `source` into a `FileResource`.
   Future selection adapters populate `resource` via this helper.

This unblocks consumer migration: chat retrieval, when-clauses, and the
attachment service can read `selection.resource` directly instead of
hand-parsing `source.filePath`. No consumer migrated in this slice.

**Files:** `src/workbench/resources/resource.ts` (+15 LOC helper),
`src/services/selectionActionTypes.ts` (+8 LOC field + import),
`tests/unit/workbench/resources/resourceFromSelectionSource.tier0.test.ts`
(6 tests).

**Verification:** tier-0 11 files / 147 passed (6 new). `tsc --noEmit`
clean.

**§13a:** Optional field on a shared interface — every existing producer
and consumer is unaffected. No preservation surface touched. Recording
`single-pass-review: tier-0-tests-pass-typecheck-clean`.

**Commits this iteration:** `<pending>`.

---

## Iteration 5 — Slice A4: ContextService (2026-05-25)

**Continuation of:** Unified Workbench Primitives program. Capstone of
Slice A — atlas weakness #2 (no unified Context/Selection) addressed.

**Done:** New `ContextService` composes three independent signals into
one canonical workbench context:

- active workspace id (from `IWorkspaceService`)
- active surface (from `ISurfaceRegistry`)
- active selection (from `ISelectionService`)

Wired into the workbench facade factory immediately after
`IWorkspaceService` is registered (where all three sources already exist).
Pure-additive: no consumer reads from it yet. Future slices migrate
when-clause expressions, command availability checks, AI chat retrieval
context, and extension `getActiveContext()` calls to a single
`IContextService.getContext()` snapshot or subscription.

Coalesces no-op events: if all three fields are reference-equal to the
previous snapshot, no fire — avoids burning listeners on duplicate signals.

**Files:** `src/workbench/resources/contextService.ts` (~115 LOC),
`tests/unit/workbench/resources/contextService.tier0.test.ts` (11 tests),
`src/services/serviceTypes.ts` (+10, `IContextService` id),
`src/workbench/workbenchFacadeFactory.ts` (+22, construction & wiring).

**Verification:** tier-0 10 files / 141 passed (11 new). `tsc --noEmit`
clean.

**§13a:** workbenchFacadeFactory.ts is not preservation-listed; the edit
is one additive `new ContextService(...) + registerInstance` block with
zero changes to existing service construction. Recording
`single-pass-review: tier-0-tests-pass-typecheck-clean`.

**Slice A status:** Resource ✓, ParallxUri ✓, ResourceRegistry ✓ (wired),
Surface ✓, SurfaceRegistry ✓ (wired), ContextService ✓ (wired). Slice A
primitive layer complete. Remaining future work: extend SelectionService
payload to carry Resource (Slice A5), migrate LinkResolverService to use
ResourceRegistry (preservation-surface slice), migrate canvas / chat /
extension consumers to read from IContextService.

**Commits this iteration:** `<pending>`.

---

## Iteration 4 — Slice A3: SurfaceRegistry (2026-05-25)

**Continuation of:** Unified Workbench Primitives program.

**Done:** New `Surface` type + `SurfaceRegistry` (register / update /
unregister / active / events) + wiring into the service container as
`ISurfaceRegistry`. Pure-additive: no part / editor / view registers as
a Surface yet. Symmetric with `ResourceRegistry` and prepares the
foundation for atlas weakness #2 (no unified Context/Selection) — a
future ContextService will compose `SurfaceRegistry.getActive()` +
`SelectionService.getSelection()` + workspace into one canonical context.

**Files:** `src/workbench/resources/surface.ts` (~60 LOC),
`src/workbench/resources/surfaceRegistry.ts` (~120 LOC),
`tests/unit/workbench/resources/surfaceRegistry.tier0.test.ts` (16 tests),
`src/services/serviceTypes.ts` (+10 lines, `ISurfaceRegistry` id),
`src/workbench/workbenchServices.ts` (+8 lines, registration).

**Verification:** tier-0 9 files / 130 passed (16 new, no regressions).
`tsc --noEmit` clean.

**§13a:** Pure-additive. workbenchServices.ts registration is one line
per service. No preservation surface touched. Recording
`single-pass-review: tier-0-tests-pass-typecheck-clean`.

**Commits this iteration:** `<pending>`.

---

## Iteration 2 — Slice A1: Resource Primitive (2026-05-25)

**Program:** Unified Workbench Primitives — landing Slice A from
[`WORKBENCH_INTERACTION_MODEL.md` §7.2](../architecture/WORKBENCH_INTERACTION_MODEL.md).
This is the big-win, top-down redesign. Atlas §12 weakness #1 ("No unified
concept of Resource or Surface") is the highest-leverage gap. Every cross-tool
bridge in atlas §4.1 (Selection→Chat, Selection→Canvas, Canvas↔Chat URIs,
Chat↔Explorer attachments, Canvas-sidebar↔Editor, Recent-workspaces dual
owners, per-feature URI handlers) depends on these primitives existing first.

**Pivot away from small fixes:** I scoped a canvas-block theme-propagation
slice from atlas §4.3, then verified by grep + reading `themeService.ts` that
the theme service injects CSS custom properties on `body` (line 67 fires
`onDidChangeTheme` after re-injecting). Any consumer using `var(--*)` updates
automatically. The atlas claim that canvas blocks don't see theme changes is
inaccurate — there are zero theme references in any canvas .ts file, and the
update path is CSS, not JS. Slice rejected on verification. User then said
explicitly: "focus top down, big wins first." Pivoted to the Resource program.

**Slice A1 — §16 Work Definition Contract:**

| Field | Answer |
|---|---|
| User workflow | Cross-tool referencing across files, canvas pages, chat sessions, tool artifacts (the §5 primary workflow). |
| Current behavior | Each feature invents its own ID scheme. Canvas: `parallx.canvas:canvas:<uuid>`. Files: absolute paths. Chat: opaque session IDs. Link resolver handles each ad-hoc. |
| Pain | Atlas §12 weakness #1. Every new bridge or new resource type touches every feature. Bridges 3 and 7 in atlas §4.1 are hard-coded URI handlers. |
| Workbench concepts | Resource (manifest §10), URI scheme, Provenance (precursor). |
| Scope | `src/workbench/resources/resource.ts`, `src/workbench/resources/parallxUri.ts`, `tests/unit/workbench/resources/parallxUri.tier0.test.ts`. New files only. |
| Out of scope | LinkResolverService, ChatDataService, CanvasDataService, SelectionActionDispatcher — no consumer migrated this slice. SurfaceRegistry, SelectionService — separate slices. |
| Baseline | None — purely additive. Establishes the Resource baseline future slices migrate to. |
| Better claim | Single canonical `Resource` discriminated union exists. URI scheme round-trips deterministically across all 5 variants. Legacy `parallx.canvas:canvas:<uuid>` parseable via alias. |
| Preservation checks | None touched. `src/links/linkResolverService.ts` (preservation surface) NOT modified. Zero imports added to existing code. |
| Verification | Tier-0 vitest: 32 tests covering parse (typed + legacy alias + external + 8 rejection paths), serialize (5 variants), round-trip (8 cases), equals. `npm run build` clean. |
| Rollback | `git revert <hash>`. No consumer depends on the new files. |

**Done this iteration:**
- Created `src/workbench/resources/resource.ts` (discriminated union + constructors).
- Created `src/workbench/resources/parallxUri.ts` (`parse`, `serialize`, `equals`).
- Created `tests/unit/workbench/resources/parallxUri.tier0.test.ts` (32 tests).
- `npm run test:unit:tier0` → 7 files / 100 passed (32 new, 68 prior, no regressions).
- `npm run build` → tsc clean, renderer bundle written.
- §13a: pure-additive slice, no preservation surface, no subagent reviewer.
  Recording `single-pass-review: tier-0-tests-pass-build-green` in commit body.

**Why this slice unlocks the program:**
- SelectionService (Slice A continuation) needs `Resource` as the selection
  payload type.
- SurfaceRegistry needs `Resource` for `Surface.activeResource`.
- LinkResolverService unification (atlas bridge #7) needs the union + URI
  scheme to register per-type resolvers.
- Canvas↔Chat URI replacement (atlas bridge #3) needs the legacy alias path
  this slice ships.

**Next slice (A2 candidate):** ResourceRegistry / resolver interface — the
service that lets each domain (Canvas, Chat, File, Tool) register a resolver
for its Resource type, and that link-handling code calls instead of the
ad-hoc URI matching in `linkResolverService.ts`. Still purely additive;
existing `linkResolverService.ts` untouched.

**Commits this iteration:** `959a6767` — slice A1.

---

## Iteration 3 — Slice A2: ResourceRegistry (2026-05-25)

**Continuation of:** Unified Workbench Primitives program (Slice A).

**Slice A2 — §16 Work Definition Contract:**

| Field | Answer |
|---|---|
| User workflow | Same as A1 — cross-tool referencing across files, canvas pages, chat sessions, tool artifacts. |
| Current behavior | Each domain has its own URI handler. `LinkResolverService` (preservation surface) contains the union by hand-rolled matching. |
| Pain | A2 is the dispatch layer that future bridges and a future `LinkResolverService` migration will sit on. Without it, every consumer of `parse()` has to re-implement type dispatch. |
| Workbench concepts | Resource, ResourceRegistry (per interaction model §2.2 migration story). |
| Scope | `src/workbench/resources/resourceRegistry.ts` + `tests/unit/workbench/resources/resourceRegistry.tier0.test.ts`. New files only. |
| Out of scope | LinkResolverService (preservation surface — separate slice with subagent review). No consumer wired this slice. |
| Baseline | None — purely additive. |
| Better claim | A typed per-`ResourceType` resolver registry exists. Consumers can call `registry.resolveUri(uri)` and get unified parse+dispatch in one place. |
| Preservation checks | None touched. `src/links/linkResolverService.ts` not modified. Zero imports added to existing code. |
| Verification | Tier-0 vitest: 14 tests covering register/has/override/unregister, dispatch, duplicate-throw, dispose, resolveUri including legacy alias and malformed URIs. `npx tsc --noEmit` clean. |
| Rollback | `git revert <hash>`. No consumer depends on the new file. |

**Done this iteration:**
- Created `src/workbench/resources/resourceRegistry.ts` (~95 LOC).
- Created `tests/unit/workbench/resources/resourceRegistry.tier0.test.ts` (14 tests).
- `npm run test:unit:tier0` → 8 files / 114 passed (14 new, no regressions).
- `npx tsc --noEmit` clean.
- §13a: pure-additive slice, no preservation surface, no subagent reviewer.
  Recording `single-pass-review: tier-0-tests-pass-typecheck-clean` in commit body.

**Slice A status after this iteration:**
- Resource union type — landed (A1).
- ParallxUri parse/serialize/equals + legacy alias — landed (A1).
- ResourceRegistry (per-type resolver dispatch) — landed (A2).
- Resource is now ready for consumer migration. The remaining Slice A items
  (SelectionService → Resource payload, SurfaceRegistry, ContextService) are
  follow-on slices.

**Next-slice candidates (atlas-prioritized, ordered by leverage):**
1. **LinkResolverService migration to ResourceRegistry** — kills atlas bridges #3 and #7 in one move. Preservation surface — needs separate Executor + Reviewer subagents OR a documented single-pass-review with extra care.
2. **Chat-context attachments via editor event** — atlas bridge #4. `src/built-in/chat/input/chatContextAttachments.ts` is NOT preservation-listed (only `main.ts` is). Replaces iteration of `api.editors.openEditors` with an `onDidChangeOpenEditors` subscription.
3. **Canvas-sidebar editor sync** — atlas bridge #5. Same pattern.
4. **Workspace canonical ownership of folder set** — atlas bridge #6.

**Commits this iteration:** `051253b8` (A2 registry) + `<pending>` (A2 wiring).

**A2 wiring follow-up (same iteration):** Registered `IResourceRegistry`
service identifier in `serviceTypes.ts` and instantiated `ResourceRegistry`
in `workbenchServices.ts`. The registry is now reachable through the
standard service container so future consumer slices can `getService(IResourceRegistry)`.
No consumer wired yet — still pure-additive. Verification: tier-0
8 files / 114 passed (no change in count, no regressions). `tsc --noEmit` clean.

---

## Iteration 1 — Foundational Artifacts (2026-05-25)

**Status:** inherited from prior sessions; accepted as iteration-1 baseline.

**Discovery:** the manifest's required first artifacts were ALREADY produced
in earlier sessions but the agent ignored them and shipped M86 W-items
anyway. The artifacts are substantive (atlas 67 KB, interaction model 88 KB,
baseline 39 KB, external research 48 KB). I'm not rewriting them; I'm
accepting them and acting on them.

**Inherited artifacts (all on disk, no rewrite needed):**
- `docs/architecture/SYSTEM_ATLAS.md` (66 891 bytes).
- `docs/architecture/WORKBENCH_INTERACTION_MODEL.md` (87 623 bytes).
- `docs/research/baselines/workbench-baseline.md` (38 697 bytes).
- `docs/research/WORKBENCH_CURRENT_CODE_RESEARCH_BRIEF.md` (18 937 bytes).
- `docs/research/WORKBENCH_EXTERNAL_ARCHITECTURE_RESEARCH_BRIEF.md` (47 867 bytes).
- `docs/research/agents/*.md` — all 9 agent cards present (1.4–2.4 KB each).
- `docs/research/SYSTEMS_REDESIGN_KICKOFF.md` — overwritten this iteration
  with current branch state (HEAD `33a5d8fa`, 398 ahead of master) and the
  autonomous-iteration contract reflected.

**Done this iteration:**
- Overwrote stale May 23 kickoff with current-state version.
- Verified all iteration-1 artifacts exist with substance.
- Logged decision: read atlas before picking the iteration 2 slice.

**Next:** read SYSTEM_ATLAS.md + WORKBENCH_INTERACTION_MODEL.md to pick the
iteration 2 slice. Commit kickoff overwrite + log update as the iteration 1
acceptance commit.

**Commits this iteration:** _pending the iteration-1 acceptance commit_

---

## Iteration 0 — Manifest & Contract (2026-05-25)

**Status:** complete. Pushed.

**Commit:** `33a5d8fa` — `manifest: autonomous iteration contract + per-turn instructions + running log`.
**Pushed:** `6f193e13..33a5d8fa systems-redesign-planning -> systems-redesign-planning`.

**Done:**
- Manifest §0/§1 stop rule replaced with autonomous iteration mandate.
- Manifest §8 clarifies AI chat infrastructure (`src/openclaw/**`,
  `src/services/chatAgentService.ts`, the chat agent runtime) is off-limits;
  surrounding API surfaces are in scope.
- Manifest §13a rule 5 rewritten: agent routes around subagent invocation
  failure with a fresh-context re-read pass, never stops for user approval.
- Manifest §18 Decision Rights rewritten: commit and push allowed on the
  working branch; only `master`, force-push, branch deletion,
  archive-vs-delete, extension-API breaks without migration, and accepted
  regressions need user.
- Manifest §25 cleanup schedule reframed as natural sequencing guidance,
  not a pause-and-wait gate.
- `.github/instructions/parallx-instructions.instructions.md` set to
  `applyTo: '**'` so it auto-loads every turn. Six-rule READ-FIRST preamble
  prepended above the verbatim manifest body.
- Created `docs/research/REDESIGN_LOG.md` (this file).

---

## Iteration 2+ — Subsystem slices (planned)

Priority decided after reading the existing atlas. Likely first targets
based on repo memories:
- IPC contract layer (W6 typed registry partial; many handlers untouched).
- Persistence ownership (mixed SQLite/JSON/extension DBs; no ownership registry).
- Extension manifest/capability model (`parallx.d.ts` from W10 unused).
- Workbench startup phases (W2 `runPhase` invariant; other phases unmigrated).

Each slice follows §16 work-definition + separate Executor and Reviewer
subagents + §22 verification + commit + log update.

---

## Repo memory audit (continuous)

`/memories/repo/*` contains ~30 files. As I touch each subsystem I audit
the relevant memory files for staleness and update them. Stale notes are
re-written or marked superseded. Fresh discoveries are added. User
explicitly delegated this: "I cannot tell you what is stale and what is
not, they are your memories."

---

## Stop rules (reference)

I stop only on:
- §18 user-reserved item triggered.
- §13a Fitness-and-Review subagent returns a rollback I cannot resolve.
- Verification fails and cannot be made green within the slice.
- §11 preservation rule violated without a net-positive replacement.

Otherwise I keep iterating.
