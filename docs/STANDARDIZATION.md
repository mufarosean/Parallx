# Standardization — the systems audit and the work queue

Four-dimension audit run 2026-08-24 (settings surfaces, packaging and
portability, UI standards, data layer). This document is the charter for
the polish/unification effort: the diagnosis, the prioritized changes,
and the enforcement that keeps drift from returning.

## The diagnosis in one paragraph

In every domain audited, the app already HAS the right system — one
Settings hub, one design-token registry, one storage service, one
database service, one migration runner, one written UI standard — and in
every domain that system has accumulated bypasses: a parallel settings
store no one bridged, font tokens referenced but never defined, five
tools reaching around the DB service to the raw bridge, four autonomy
event streams, two config stores where editing one is silently ignored
by the reader of the other. The work is not inventing new systems. It is
CLOSING BYPASSES onto the winner, and adding enforcement (compliance
tests, loud failures) so the bypasses cannot quietly come back. The
second finding is universal: every packaging failure found fails
SILENTLY — swallowed migration errors, secrets that decrypt to null,
storage that falls back to memory. Silence is why the USB build "worked
80% of the time" instead of failing once, loudly, diagnosably.

## Why the USB build failed 20% of the time — solved

There is no packaging config at all: the portable build is the repo
folder plus `electron.exe .`, so `app.isPackaged` is always false and
every dev assumption stays live. The intermittent failures are four
stacked silent mechanisms:

1. **`preload.cjs:11` hands the renderer `process.cwd()` as `appPath`.**
   Launch via anything but the batch file (shortcut with a different
   Start-in, taskbar relaunch, Open With) and every renderer path — 
   global storage, last-workspace, appearance, all four migration dirs — 
   roots somewhere else. Storage validation then rejects the mismatched
   paths and the app silently boots amnesiac on in-memory storage.
2. **Migration failure returns success** (`database.cjs:132-138` catches,
   warns, `return;`). A workspace created on the portable machine gets a
   database with ZERO tables; every feature then fails later with
   "no such table" in ways that look random. Migrations also resolve
   from `appPath/src/built-in/...` — the source tree.
3. **Secrets are DPAPI-locked to the dev machine.** `data/secrets/*.enc`
   cannot decrypt under another Windows account; the read swallows the
   throw and returns null, so API keys silently vanish on the USB host.
4. **The restored workspace path is never existence-checked.** A stale
   absolute path from the dev machine gets fabricated as an empty
   directory tree with an empty DB — a workspace that "opens" blank.

Plus: unguarded `mkdirSync` at module load dies on read-only media
before any window exists; the taskbar relaunch command shells out to
`node`, which the portable host does not have (hidden window, so nothing
happens at all).

## P0 — Packaging correctness (do first; upstream of everything)

- [ ] `preload.cjs`: expose the main process's real `APP_ROOT` (IPC or
      injected value), never `process.cwd()`. One line, upstream of most
      of the class.
- [ ] `database.cjs` migration runner: unreadable migrations dir is an
      ERROR returned to the caller; all four built-in callers surface it
      to the user. No silent empty schemas, ever.
- [ ] Move built-in migrations OUT of the source tree contract: ship
      them from a runtime-resolved location (and see P2 — core schema
      moves to a workbench-owned dir run at DB open).
- [ ] `workbench.ts`: `exists()` the restored workspace path before
      building a Workspace; fall back to Welcome on a miss instead of
      fabricating an empty tree.
- [ ] Wrap the three top-level `mkdirSync` calls (main.cjs:163-165) — 
      read-only media must degrade, not die pre-window.
- [ ] Fix `relaunchCommand` to relaunch the running executable, not a
      VBS that requires node + a rebuild.
- [ ] Secrets: detect decrypt-to-null and SAY SO in the UI ("keys do not
      travel between machines; re-enter them here"), and correct the
      comments claiming portability.
- [ ] Case-insensitive path containment checks in main.cjs /
      storageHandlers.cjs (Windows is case-insensitive; startsWith is
      not), with trailing-separator guards.
- [ ] `devMode.ts` defaults to TRUE in every renderer (invariant checks
      run on every keystroke in "production"); resolve from a real
      signal.
- [ ] DECISION NEEDED: harden the portable-copy model (current use
      case) now; adopt electron-builder packaging as its own later
      milestone. The P0 items above are required under EITHER model.
- [ ] Portable-copy hardening: launcher verifies dist/ freshness;
      `data/` (machine state: last-workspace, secrets, chromium-cache)
      excluded from the copy or reset on first foreign-machine boot;
      `ext/` loading path made first-class, not "dev-only".

## P1 — Settings unification

- [ ] **Bridge the two settings stores.** `IConfigurationService`
      (`config:` keys, what extensions read) and the settings registry
      (`settings.overrides`, what the hub writes) are unbridged: editing
      ~20 extension settings in the hub does nothing. Bind every
      manifest key through one store. This is the single biggest lie in
      the app today.
- [ ] Register the chat manifest's configuration block (chat.fontSize,
      chat.defaultModel etc. are currently registered NOWHERE — stuck at
      hardcoded fallbacks).
- [ ] **Fold AI Settings into the hub.** Point `ai-settings.open`, the
      chat gear/wrench, and the four manage commands at
      `settings.open('ai')` + in-panel scroll; retire `view.aiSettings`.
      Today the hub's own AI action rows open the parallel sidebar.
- [ ] Delete the dead second settings editor (`SettingsEditorPane` +
      input + deserializer wiring).
- [ ] One keyboard-shortcuts surface: point
      `workbench.action.openKeybindings` and the gear menu at the hub
      panel; delete the read-only pane; move `px-keybindings` out of
      localStorage into the registry so rebinds export/import with
      config.
- [ ] One appearance story: hub panel is the editor; `theme-editor.open`
      opens the hub; reconcile the px-appearance vs colorTheme dual
      model (two theme systems, three doors today).
- [ ] Register the big ad-hoc stores as schemas: px-appearance,
      webResearch.* (Brave key aside — secret storage), so they appear
      in and export with settings.
- [ ] Collapse duplicated knobs: default model, context length, agent
      iterations each exist in 2-3 places with a fallback chain — one
      registered setting each, session pickers override per-session
      only.

## P2 — Data layer: the unified stream

- [ ] **Route the five raw-bridge tools (canvas, canvas-db, dashboard,
      planner, worksheet) through `IDatabaseService`.** Highest-leverage
      single change: puts every SQL write behind one seam and deletes
      six duplicate bridge interfaces.
- [ ] **Emit a typed change event from the two chokepoints** — 
      `DatabaseService.run/runTransaction` and
      `FileBacked*Storage._flush` — `{store, scope, table|key, op,
      ref}`. With P2.1 done, that IS the unified data stream from every
      surface, with no per-surface opt-in. The activity journal narrates
      UI; this narrates writes; taps can then subscribe to one bus.
- [ ] **Fix schema ownership inversion**: core RAG tables
      (vec_embeddings, fts_chunks, indexing_metadata) live in CANVAS's
      migration dir — disable canvas and core indexing has no schema.
      Create `src/db/migrations/` (workbench-owned), run at DB open;
      tool dirs keep tool tables only.
- [ ] One migration pattern: the 11 services doing inline
      `CREATE TABLE IF NOT EXISTS` DDL (invisible to `_migrations` and
      to dropToolData) move to real migrations. Fix the duplicate
      concept_nodes DDL (two divergent definitions).
- [ ] Collapse the four autonomy histories (volatile ring, ndjson log,
      hash-chained ledger, activity_log) toward one events table with
      views; the rail service stops being a merge shim. (Phased; big.)
- [ ] Deduplicate dual stores of the same data: chat transcripts
      (SQLite + jsonl), memory (SQLite + markdown) — pick the canonical,
      derive the other or delete it.
- [ ] One "recents" service (six implementations today, two read by
      hardcoded key from Welcome).
- [ ] Kill remaining localStorage (keybindings, appearance fast-layer,
      icon recents, canvas UI state): generalize the pxAppearance
      sync-primed-cache pattern into FileBackedGlobalStorage, or accept
      the flash and drop it.
- [ ] Location rules written down: per-workspace vs app-global vs
      per-user — and fix the misfits (PDF highlights are per-FILE data
      in app-global storage; dashboard assets are global for
      per-workspace widgets).

## P3 — Fonts (one evening, big visible win)

- [ ] **Define the missing aliases.** Four font vars are referenced 65
      times across 21 files and never defined (`--px-font-ui`,
      `--px-font-mono`, `--vscode-font-family`,
      `--vscode-editor-font-family`). Alias all four to the
      `--parallx-fontFamily-*` tokens in the theme bridge. Instantly:
      the terminal, all log panes, search, chat code blocks stop
      rendering Courier New — 12 effective stacks collapse toward 3.
- [ ] Then sweep stragglers to the parallx tokens and BAN the other
      namespaces via compliance test.
- [ ] Fix the boot flash: index.html overlay + BrowserWindow
      backgroundColor use VS Code's #1e1e1e and a hardcoded Segoe stack;
      align to `--px-base-00` (#16171a) and the UI token.
- [ ] Hardcoded font-size sweep (120 px-literals, 77 in canvas) to
      `--px-text-*` — mechanical, low priority within P3.

## P4 — Window sizing

- [ ] Clamp restored bounds to the target display's workArea (an
      ultrawide size restored onto a laptop currently puts the frameless
      close button off-screen).
- [ ] Clamp negative y (the live window-state.json already carries
      y:-16 from the maximized-frame offset; un-maximize jumps the
      titlebar off the top with no OS chrome to recover).
- [ ] Debounced bounds save on resize/move (today: saved only on clean
      close; crash/kill loses geometry — the recorder frame already does
      this correctly; copy it).
- [ ] `show:false` + `ready-to-show` to kill the gray flash; fix the
      hide-then-save-again close sequence (the authoritative bounds
      write currently happens on a HIDDEN window) and the stuck-teardown
      trap where `_closingDown` blocks the second-instance rescue.

## P5 — Copy standards + ENFORCEMENT

- [ ] Em-dash sweep of the strings that reach users: command
      titles/descriptions in builtinManifests (14 — palette-visible),
      thrown-error toasts (~15), recorderFrame.html UI strings, and the
      LLM-channel prompt/tool descriptions (the model echoes them).
      Comments keep their em dashes — house style there.
- [ ] Emoji sweep of system UI: openclaw doctor/status/new/think/
      verbose command output, cron/heartbeat status prefixes, truncation
      warnings (~19 real sites) → icon registry or plain text.
- [ ] Text-symbols-as-icons (18 sites: ✕ close buttons in four files,
      ▶/▼ disclosure, → links) → the icon registry.
- [ ] Ellipsis: 24 `...` → `…`, including four commands registered under
      BOTH spellings (palette shows duplicates).
- [ ] Casing per register: ~118 Title Case strings in sentence-case
      registers (buttons, form labels, section headers), plus
      same-action label drift ("Export PDF" / "Export as PDF" /
      "Export Markdown" / "Export as Markdown"). Normalize; note
      "Add Widget To Workbench" should be "…to Workbench" even in
      Title Case.
- [ ] **The enforcement layer — what makes all of this stick**: add
      compliance tests in the existing gate-test pattern
      (motionTokenCompliance is the template):
      - fontCompliance: no font-family outside the parallx tokens
        (allowlist: canvas font picker, EPUB serif, print export)
      - copyCompliance: no `...` in labels, no em dash in
        title:/label:/textContent strings, no pictographic emoji in
        system UI, ellipsis and casing rules
      - pathCompliance: no `appPath` joined with 'src', no
        process.cwd() in path building, no new localStorage
      Zero of today's rules have automated enforcement; that is why
      drift happened.

## Sequencing

P0 packaging correctness → P1 settings bridge + AI-settings fold →
P3 font aliases (cheap, visible) → P2 data seam (route tools, emit
events, schema ownership) → P4 window → P5 copy + compliance tests.
Compliance tests land WITH each sweep, not after. The autonomy-stream
collapse and dual-store dedup (P2 tail) are their own later passes.
