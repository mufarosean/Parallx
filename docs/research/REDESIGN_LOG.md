# Parallx Redesign Running Log

> Format: append-only. Newest iteration at top. Each entry has a date and a
> commit hash where applicable. The agent updates this every iteration. The
> user reads this to monitor progress without sitting at the keyboard.

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
