# Retirement — the missing phase

Written 2026-08-30, after Mufaro's verdict on the A–D integrity program:
"If our app is riddled with old systems that were never retired, it
becomes bloat — hard to know what is actually used and not. When I said
foundation, I mean a foundation for everything."

He was right, and the amendment to the covenant is this:

> **A class is not fixed when the right system exists. It is fixed when
> the right system is the ONLY system.** Retirement is not cleanup after
> the work; it is the work.

Phases A–D added the correct subsystems and migrated callers, but
deleting the superseded system was never its own dimension. This
document is the verified map of everything that survived — produced by
two exhaustive audits (UI/view/layout layer; services/infrastructure
layer) with consumers checked file-by-file. Execute top to bottom; each
part ships alone, green, with the same gates as every phase before it.

The proof this matters: the audit found a LIVE user-facing bug hiding in
the duplication — the Welcome page's recent-workspaces list was
permanently empty because the writer uses key `recentWorkspaces` while
Welcome read `parallx.recentWorkspaces`. Fixed the day the audit ran.

---

## Part 1 — The corpse list (zero consumers, zero blockers; one slice)

Verified dead. Delete, run gates, done.

1. `src/services/retrievalService.ts.old` — 1,137 lines, git-tracked,
   not compiled, contains stale copies of live code.
2. `src/platform/storage.ts` — delete `NamespacedStorage` (:77),
   `NamespacedSyncStorage` (:124), `LocalStorage` (:203, its deprecation
   comment claims a test dependency that no longer exists),
   `IndexedDBStorage` (:323), `migrateStorage` (:471). ~330 of 486 lines
   unreferenced by src AND tests. Keep `IStorage`, `InMemoryStorage`,
   `StorageErrorKind`.
3. `src/layout/layoutRenderer.ts` — constructed at workbench.ts:917,
   disposed at :875, and NOT ONE method ever called. Superseded by
   `_mountBody` + `restoreBodyTree`. Delete class + the three
   workbench.ts lines.
4. `IViewService` + `src/services/viewService.ts` — empty stub, empty
   class, registered at workbenchFacadeFactory.ts:110, zero consumers.
5. `src/ui/dom.ts` `startDrag`/`endDrag` (:140-151) — superseded by
   `beginPointerDrag`; zero callers (tableControls' `_endDrag` is an
   unrelated private; apiFactory's `window.startDrag` is the Electron
   OS-drag, different subsystem).
6. `placeholderViews.ts`: `TerminalPlaceholderView`,
   `OutputPlaceholderView`, their two descriptors (retired at M86,
   classes left behind) + dead CSS `.placeholder-terminal-*`,
   `.placeholder-output-line` (workbench.css:2397-2421).
7. `allAuxiliaryBarViewDescriptors` (= `[]`) + its no-op registerMany at
   workbench.ts:1162.
8. `serializeViewDescriptor` + `SerializedViewDescriptor`
   (views/viewDescriptor.ts:93) — zero consumers anywhere.
9. `serviceTypes.ts:677` `IEditorResolverService` const — the ONLY
   identifier never registered and never resolved (the class is
   constructed directly, outside DI). Keep the interface.
10. `commandTypes.ts:127` `CommandRegistrationOptions` — unreferenced
    since M2.
11. `permissionService.ts:260, 286` — deprecated heartbeat-spelling
    aliases with zero callers.
12. `diffService.ts:451` `DiffService` class + `formatDiffSummary` —
    every consumer imports the free functions.
13. `keybindingContribution.ts:461-480` `_updateCommandKeybindings` —
    empty-bodied no-op called on every contribution pass.
14. Dead exported symbols (audit list, services layer): five
    `FLAG_CANVAS_*`/indexing flag consts (data lives in defaults; the
    exported symbols are dead), `AUTONOMY_LOG_DEFAULT_LIMIT`,
    `getAllKnownLanguages`, `PERMISSIONS_FILE_PATH`, `matchGlob`,
    `getSecretBridge`, `isSemanticGraphSourceType`, `ORIGIN_USER`,
    `parseTranscriptJsonl`, `readKbOverrides`/`writeKbOverrides`
    exports, the five `DEFAULT_*` consts in parallxConfigService,
    `SKIP_DIRS` re-export (indexingPipeline.ts:1587).
15. `TokenBudgetService` class — no production importer at all (only
    `estimateTokens` is used); `setConfig`/`getConfig`/`_legacyConfig`
    are self-declared dead. Retarget or delete its test.
16. Untracked detritus at repo root: all-commits.txt, app-changes.txt,
    build-out.txt, canvas-head.txt, flaky-output.txt, full-run.txt,
    master-e2e.log, preserve-slice.log, tg-diff.txt, test-output.txt,
    test-results.json.

## Part 2 — Live defects and lies the audit exposed (fix, not delete)

1. **Welcome recents key mismatch** — FIXED 2026-08-30 (this commit).
2. **Dead-but-live-looking config fallbacks** — chat/main.ts:685, 687,
   800: `chatConfig.get('agent.maxIterations', 25)` etc. read keys the
   manifest deliberately never registers (builtinManifests.ts:341-343),
   so each `??`/`||` fallback is a constant wearing a config costume.
   Delete the fallback branches; unified config is the one source.
3. **Palette shows stale keybindings after a rebind** —
   quickAccess.ts:288 reads the CONTRIBUTION map while menus read the
   SERVICE; a user rebind updates only the service. Fix rides Part 3.2.
4. **Stale tracked package artifacts** —
   `ext/text-generator/text-generator.plx` is a git-tracked zip 18
   commits (4 months) behind its own source; delete it (the packaging
   script regenerates). `scripts/package-media-organizer.mjs:16` targets
   a .plx path that no longer exists; fix or note. `bin/magick.exe`
   (29MB) is tracked inside ext/media-organizer — decide whether a 29MB
   binary belongs in git.
5. **Stale installed extension** (runtime dir, not git):
   `data/extensions/parallx-community.media-organizer` is v0.10.0 with
   4/20 migrations vs source v0.10.2 — Mufaro should reinstall or
   delete it in-app.

## Part 3 — Unifications (small, each its own slice)

1. **DiagnosticsService unconditional → delete the doctor's fallback.**
   Construction currently hides inside `registerIndexingServices`,
   which only runs when a workspace DB opens — so /doctor keeps a
   duplicated 49-line inline copy of nine checks
   (openclawDoctorCommand.ts:58-107) for the no-workspace case. Move
   construction to an unconditional phase (deps are lambdas;
   `updateDeps` already exists), delete `runInlineChecks`, make
   `diagnosticsService` non-optional in openclawTypes.ts:399.
2. **One keybinding dispatcher.** The processor's legacy document
   listener is unreachable in production (removed synchronously at
   workbenchServices.ts:190) but the CLASS still holds: the palette's
   display lookup (quickAccess.ts:288 — the stale-rebind bug), the
   shared pure functions (`normalizeKeybinding`, `keyFromEvent`,
   `formatKeybindingForDisplay`, `RESERVED_KEYBINDINGS`), and a
   reserved-key guard duplicated at three call sites while
   `KeybindingService.registerKeybinding` has none (structural
   registration bypasses it entirely). Move the pure functions to a
   `keybindingUtils.ts`, push the reserved guard INTO
   `registerKeybinding`, repoint the palette at
   `IKeybindingService.lookupKeybinding`, then gut the processor to a
   thin manifest→service forwarder.
3. **Dual-store dedup.** `FileBackedGlobalStorage` and
   `FileBackedWorkspaceStorage` are ~95% byte-identical; one class with
   a version-envelope flag collapses fileBackedStorage.ts 263→~150.
4. **localStorage exits** (keep `px-appearance` — deliberate sync
   pre-paint layer with a durable mirror): move `px-keybindings`
   (await-able; workbench.ts:3420 can await), `px-appearance-presets`
   (currently NO durable mirror — genuine data-loss gap), and the four
   canvas/icon MRU keys onto `IGlobalStorageService`.
5. **Migration windows.** Close M53: delete
   `platform/storageMigration.ts` (281 ln, sentinel-gated, ran long
   ago). Add sentinels or sunset notes to the autonomy/cron/secrets
   legacy shims in autonomyBootstrap.ts and
   settingsRegistryBootstrap.ts (cron's shim runs on EVERY load where
   the ws file is missing — give it a sentinel).
6. **Dead settings stores.** Delete `AISettingsService` class (replaced
   by UnifiedAIConfigService which is registered under both tokens;
   only two test files construct the old class — retarget them) and the
   `ParallxConfigService` class body (keep `mergeConfig`,
   `DEFAULT_CONFIG`, and the types that unified config imports).
7. **Recents consolidation.** Six independent trackers (audit §8). A
   small RecentsService absorbing RecentWorkspaces + quickAccess's two
   lists + the explorer recents tracker; the dashboard widget keeps its
   frozen typeId and command aliases.

## Part 4 — The two structural retirements (the real work)

### 4a. ONE sidebar path (demolishes the scaffolding that caused the Search bug)

Today two architectures build the sidebar. Path A: a hardcoded loop
(workbench.ts:2066-2214) with inline SVGs, `createViewSync` of
DEMO-CONTENT placeholders (`SearchPlaceholderView` renders three fake
search results), and `registerBuiltinSidebarContainer`. Path B: the
contributed pipeline. They are stitched together by three hacks that
exist only to serve each other:
- The placeholder descriptors register FIRST, permanently shadowing the
  contributed view.explorer/view.search descriptors
  (viewContribution.ts:248 hasDescriptor guard);
- `_replaceBuiltinPlaceholderIfNeeded`
  (workbenchContributionHandler.ts:653-689) then smuggles real content
  in with raw `innerHTML = ''` DOM surgery;
- `_containerRedirects` (:404-421) matches contributed containers to
  builtin ones BY LOWERCASED DISPLAY TITLE — rename "Search" anywhere
  and a duplicate icon silently appears.

The retirement: Path B serves every sidebar container. The manifests
already declare everything (explorer-container/search-container with
icons 'folder'/'search'; providers already registered on the
contributed path). Known parity gaps to close, enumerated by the audit:
stacked-mode chrome for Explorer's two views (Path B hides tab bars),
default-container seeding (view.explorer hardcoded in three places),
icon-registry entries for 'folder'/'search', boot timing (things read
builtinSidebarContainers in Phase 3), and the `_defaultSidebarContainer`
aliasing (the "generic sidebar fallback" IS the Explorer container —
viewsBridge's fallback default routes stray views into Explorer).
Then delete: placeholderViews.ts entirely, the `View` base class
(views/view.ts — placeholders are its only subclass; IView etc. are
re-exports from viewTypes), `ViewDescriptorBuilder`, the replace-DOM
mechanism, the title-match redirects, and the placeholder CSS.
Tests to update: containerRails.test.ts (:104, :155 builtin-map
round-trips), e2e 08/95 selectors. AFTER this lands, deferred view
materialization becomes possible, and with it real onView lazy
activation (lazyActivationCompliance.test.ts guards until then).

### 4b. THE FOUNDATION DECISION — mount the surfaces layer or retire its scaffolding

The audit's biggest finding: the surfaces foundation — the thing this
branch is named for — is BUILT, TESTED, AND NOT MOUNTED:
- `surfaceRegistry.register(...)` is called from NOWHERE in src; the
  production registry is empty.
- `SurfaceTree.open/restore/capture` are never called; the tree is
  instantiated once and used only as a Grid holder (layout.ts:188-190).
- `SurfaceActivityTap` (mounted in Phase B) listens for events no
  production path can fire.
- Three modules have ZERO production importers: `surfaceAdapters.ts`
  (241 ln), `surfaceContribution.ts` (170 ln — the intended replacement
  for ViewContributionProcessor; `contributes.views` is already marked
  @deprecated pointing at it, but zero manifests declare surfaces and
  nothing reads them at runtime), `arrangementStore.ts` (177 ln — a
  direct duplicate of the LIVE SavedLayoutStore, same concern, same
  design, never written).
- "Surface" means three unrelated things: the foundation pane concept
  (src/surfaces), the openclaw delivery channel
  (src/workbench/surfaces + surfaceRouterService), and their name
  collision makes both unreadable.

This is Mufaro's decision, the same shape as the editor decision:
- **Option A — mount it**: the surfaces migration becomes the next real
  milestone (4a is its prerequisite and first step: contributed views
  re-read as surfaces via readSurfaceContributions; SavedLayoutStore
  folds into ArrangementStore as the layouts feature always intended).
- **Option B — retire the scaffolding**: delete the three unmounted
  modules + their tests, keep tree/registry as the grid substrate they
  currently are, and remove the @deprecated marker on contributes.views
  (a deprecation nothing implements is a lie).
- Either way: rename ONE of the two "surface" families (recommendation:
  the openclaw channels become `channels/` — upstream calls them
  ChannelPlugin anyway).
Not choosing is the one wrong answer — that IS the current state.

## Part 5 — Autonomy stream note (not a merge candidate)

AutonomyLogService (in-memory bodies) vs AutonomyEventLog (durable
ndjson metadata) is a deliberate privacy split (§3.9: bodies must never
reach ndjson), already merged for display by AutonomyTaskRailService.
The honest evolution is a persisted body store keyed by the event
ULID — a design task, not a deletion. The activity journal overlaps
only on the AI slice and serves a different consumer (wake context).

## Order and budget

Part 1 + Part 2 remainder: one sitting, low risk, ~2,500 lines leave
the tree. Part 3 items: one slice each, any order; 3.1 and 3.2 first
(they close live lies). Part 4a: a full sitting with Mufaro reachable
(sidebar chrome is eyes-on territory). Part 4b: decision first, then
either an afternoon (retire) or the next milestone (mount).

## Ledger

- Part 1 — SHIPPED 58ff7393 (~2,600 lines deleted, 16 corpses).
- Part 2 — SHIPPED (chat fallbacks honest; palette lie fixed by 3.2).
- 3.1 diagnostics — SHIPPED 89dc0a90 (unconditional service, inline
  doctor copy deleted).
- 3.2 keybindings — SHIPPED aa57ed9e (keybindingUtils.ts, central
  reserved guard, palette reads the live service).
- 3.3 storage dedup — SHIPPED (one FileBackedStorage, options bag).
- 3.4 localStorage exits — SHIPPED. px-keybindings → global storage
  (self-terminating localStorage adoption inside readKbOverrides);
  px-appearance-presets gained the stamped durable mirror
  (data/appearance-presets.json, healed at boot beside appearance).
  DECIDED: the canvas/icon MRU keys and collapsed-flags STAY on
  localStorage — same class as px-appearance's fast layer (sync reads
  at popup-render time), but loss is costless so they need no mirror.
  themeCatalog was already durable since M53; its lying "localStorage"
  comments fixed, and two dead exports (updateUserThemesCache,
  getUserThemeSources — the user-theme WRITE path died with the old
  theme editor) deleted.
- 3.5 migration windows — SHIPPED. storageMigration.ts (M53) deleted;
  all three M61 shims in autonomyBootstrap closed: event-log move and
  approvals rename had physically consumed their sources long ago, and
  the cron copy shim was a live misfeature (copied but never removed
  data/cron.json, so every future fresh workspace would inherit
  M61-era global jobs). settingsRegistryBootstrap has no shims.
- 3.6 dead settings stores — SHIPPED 37182531 (AISettingsService +
  ParallxConfigService class, 1,446 lines with their orphan tests).
- 3.7 recents — SHIPPED. New core RecentsService (src/services/
  recentsService.ts) is the ONE owner of per-workspace recency: the
  opened-items list (files + canvas pages) and the palette's command
  MRU, hydrated once, sync in-memory reads, `whenReady` for early
  readers. quickAccess deleted both private lists + both storage keys
  + three parsers; the explorer tracker kept only its canvas-id tap
  and the two frozen read commands (explorer/dashboard.getRecentItems)
  as thin service reads; Welcome deleted its duplicated key constants
  and raw parsers — recent workspaces now via
  IWorkspaceService.getRecentWorkspaces(), recent files via the
  service. Ctrl+P recency now sees ALL editor opens (explorer clicks
  included), not just palette picks. RecentWorkspaces stays the single
  global-scope owner. DECIDED: no data migration from the orphaned
  pre-3.7 keys — recency lists repopulate passively with zero user
  effort (the 3.4 keybinding adoption was different: rebinds cost
  manual re-entry). Behavior pinned in tests/unit/recentsService.test.ts.
- 4a / 4b — PENDING (4b needs Mufaro's mount-or-retire decision).
