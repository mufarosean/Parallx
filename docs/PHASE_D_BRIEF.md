# Phase D Brief — modularity, the decisions, and the order

Written 2026-08-25 at the close of Phases A–C (SYSTEM_INTEGRITY.md has
the full ledger). Phase D makes "add or remove things as they please"
structurally true for the 19 built-ins, not just the 7 external
extensions. This brief exists so the next session starts with answers:
three decisions are yours, everything else is sequenced execution.

---

## The three decisions

**DECIDED 2026-08-29 (Mufaro): all three recommendations adopted —
api.services goes read-only for externals; activation events flip for
leaf tools only, after the extractions; the editor moves into core.
The eyes-on probe pass is waived on field use (a week of daily driving
with no issues). Execution begins.**

### Decision 1 — api.services: gate it, or document it?

Today any extension can resolve ANY core service and even overwrite one
by re-registering its identifier. Four extensions already use the door.
It is a manners boundary, not a real one.

- **Option A — document only.** Declare it a built-in privilege in the
  API docs; externals keep working until one misbehaves. Zero cost,
  zero protection.
- **Option B — read-only for externals.** External tools may `get` but
  not `registerInstance`; built-ins unchanged. Small change in the API
  factory, protects against the overwrite class, breaks nothing that
  exists today.
- **Option C — allowlist.** Manifests declare `coreServices: [...]`;
  anything undeclared throws. Most honest, most work, and every
  built-in manifest needs its list written.

**Recommendation: B now, C later if a real extension ecosystem forms.**
The overwrite hazard is the dangerous half; the read half is how the
sandbox vision works.

### Decision 2 — activation events: honor them, and for whom?

Boot currently awaits all 19 built-in activations (chat's activate alone
is 3.7k lines). The engine supports onCommand/onView lazy activation and
nothing uses it. Honoring events = faster boot, but it CHANGES STARTUP
SEMANTICS: anything chat constructs (settings registry, cron, autonomy)
would not exist until chat wakes.

**Recommendation: do not decide "lazy for everyone." Sequence it:**
first move the load-bearing construction out of chat (steps 4–5 below),
then flip the LEAF tools lazy (worksheet, flashcards, media-organizer,
web-research…), measure boot, and stop there unless it is clearly safe.
This is the one Phase D step that requires launching the app between
changes — plan it for a session where you are present.

### Decision 3 — what is the editor, structurally?

The audit calls built-in/editor a "tool costume": 34 core import lines,
the only `'*'` activation, and by your own decision the ANCHOR of the
layout. Two honest shapes:

- **Option A — stop pretending: move it into core** (src/editor/…, no
  manifest, not listed in the Gallery). Matches the anchor decision;
  the Gallery then lists only things that are genuinely optional.
- **Option B — keep the costume, add `required: true`** so the Gallery
  shows it greyed with an honest label. Less churn, but the costume is
  the lie the audit flagged.

**Recommendation: A.** The editor already isn't a tool by decision;
the file layout should say so. (canvas/chat/dashboard/explorer stay
tools but gain `required: true` until their extractions land.)

---

## Execution order (risk-sorted; each step ships alone, green)

**PROGRESS 2026-08-29:** Step 1 SHIPPED (73d0d798, shadows deleted after
three-layer verification). Decision 1 SHIPPED (same commit: registerInstance
throws for externals, apiServicesGate.test.ts pins it; the three externals
using api.services only read). Step 2 SHIPPED (same commit:
canvas.getEmbeddedNoteHost getter seam, editor loaded lazily on first
embed, zero dashboard→canvas imports). Step 3 SHIPPED (3c26f74c: the
13-file chain moved wholesale to src/services/db-migrations, workbench
applies it on DB open; filename-keyed _migrations tracking continues
seamlessly). Step 4 SHIPPED (0c354a7d: settingsRegistryBootstrap in core;
chat keeps only its domain schemas behind a sentinel; the four canvas.*
keys moved home to canvas). Step 5a SHIPPED (1ffee8c9: autonomyBootstrap
in core builds flags/event-log/rail/patterns + both legacy migrations;
chat resolves; cron + background runner stay for 5b's executor seam).
NEXT: field-verify boot (registry + autonomy substrate now core-built),
then 5b → 6 → 7 → 8 → 9 → 10.

1. **Delete the six shadow parallx-manifest.json files.** They are dead
   copies of builtinManifests.ts that mislead (I updated explorer's this
   week purely to keep the lie consistent). Trivial, zero runtime risk.
2. **notesWidget onto a command seam.** Dashboard's notesWidget
   value-imports canvas's editor class — dashboard cannot load without
   canvas. Planner's WidgetRegistrar structural interface is the model.
   Small, well-bounded.
3. **Shared/RAG schema → core-owned migrations dir.** Canvas owns all 13
   shared-DB migrations including tables core services read. Move the
   migration list to core; canvas keeps only canvas tables. Caution:
   DB worker thread rules apply ([[project-db-worker-thread]]).
4. **Settings registry constructed by the workbench, not chat.** The
   delicate one — but it also FIXES the standing registration-order trap
   (services built in registerWorkbenchServices currently run before the
   registry exists). Chat becomes a consumer like everyone else.
5. **Autonomy runtime out of chat into core services** (cron, flags,
   rail, patterns, background prompt runner). Largest extraction;
   mechanical once 4 proves the pattern.
6. **widgetBox fully inverted behind the widget host** (drawers and
   renderer are still hard imports; the host is already
   command-resolved — finish the inversion).
7. **Editor per Decision 3.**
8. **Manifest `dependencies` declared and honored** (ordering
   constraints currently live in code comments on a literal array).
9. **Activation events per Decision 2** — eyes-on session.
10. **Real enablement:** `required: true` for the core set; the disable
    toggle becomes live for every other built-in, and disabling one
    degrades loudly and diagnosably (the Phase C journal + notifications
    already give us the loudly part).

Apply Decision 1 wherever it lands in the calendar — it is independent
of the sequence.

## Before any of it: the eyes-on probe pass

Three phases of shipped UI are verified only by tests and static
analysis. One session with the app open, roughly in this order: the
original Enter-creates-file scenario (focus the menu bar, type, hit
Enter); context menus dismissing on Escape/outside-click/window-blur;
widget and container box menus (watch the Activity panel — every choice
should journal as ONE command line with origin, no doubles); the
explorer context menu incl. background-click creates; saved-layouts
panel buttons; titlebar window controls; the dashboard drawers; the
Tool Gallery Runtime Status tab; `/doctor` showing the four workbench
checks; and `app__describe` from chat.

Added 2026-08-27 — the canvas table rebuild landed a new hover/gesture
surface that is verified only by tests, so fold it into the same pass:
hover a table (row/column grips and the two ✛ bars appear, nothing
shifts); click a grip (row highlights AND its menu opens); drag a grip
(drop line follows, row/column reorders, Escape mid-drag CANCELS it and
restores the cursor); the ✛ bars append a row/column; Ctrl+A / Escape
ladders inside a cell; Ctrl+D and Ctrl+Shift+Arrow acting on the ROW;
and dragging a table across the page leaving nothing behind.

## Budget shape (rough, for planning Saturday)

- Probe pass + field fixes: ~1 unit (a Phase-B-slice's worth)
- Steps 1–2: ~½ unit together
- Step 3: ~1 unit · Step 4: ~1–1½ units · Step 5: ~1½ units
- Steps 6–8: ~½–1 unit each · Steps 9–10: ~1 unit each + eyes-on
- Total: comparable to Phases A+B+C combined. Plan it as two or three
  sittings, each ending at a green, committed step boundary.
