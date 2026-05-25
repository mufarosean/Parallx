# Parallx Redesign Running Log

> Format: append-only. Newest at top within each iteration. Each entry has a
> timestamp and a commit hash where possible. The agent updates this every
> iteration. The user reads this to monitor token spend and progress without
> sitting at the keyboard.

---

## Iteration 0 — Manifest & Contract (2026-05-25)

**Status:** in progress.

**Goal:** Make the manifest enforceable from per-turn agent context and remove
user-gating blockers so the agent can iterate continuously.

**Done:**
- Manifest §0/§1 stop rule replaced with autonomous iteration mandate.
- Manifest §8 clarifies AI chat infrastructure (`src/openclaw/**`,
  `src/services/chatAgentService.ts`, the chat agent runtime) is off-limits;
  surrounding API surfaces are in scope.
- Manifest §13a rule 5 rewritten: agent routes around subagent invocation
  failure with a fresh-context re-read pass, never stops for user approval.
- Manifest §18 Decision Rights rewritten: commit and push allowed on the
  working branch; only `master`, force-push, branch deletion, archive-vs-delete,
  extension-API breaks without migration, and accepted regressions need user.
- Manifest §25 cleanup schedule reframed as natural sequencing guidance, not
  a pause-and-wait gate.
- `.github/instructions/parallx-instructions.instructions.md` set to
  `applyTo: '**'` so it auto-loads every turn in this workspace. Prepended a
  six-rule READ-FIRST preamble above the verbatim manifest body.

**Next:** commit contract changes, push to remote, begin iteration 1.

**Commits this iteration:** _pending_

---

## Iteration 1 — Foundational Artifacts (planned)

**Goal:** Produce the manifest's required first artifacts that were skipped
in the 48 hours leading up to M86. Without these, every implementation slice
is blind.

**Planned outputs:**
- `docs/research/SYSTEMS_REDESIGN_KICKOFF.md` — §26 shape, with verified
  branch state, scope, decisions needed, cleanup phase, next action.
- `docs/research/agents/*.md` — 9 agent cards (§13 roster).
- `docs/architecture/SYSTEM_ATLAS.md` — every major subsystem with code
  anchors, owners, public contracts, known pain, missing tests. Produced via
  `Explore` subagent passes over `src/`, `electron/`, `ext/`, `tests/`.
- `docs/research/baselines/workbench-baseline.md` — what's measurable today
  (startup time, IPC handler count, test counts, build size) + what needs
  new instrumentation.
- `docs/architecture/WORKBENCH_INTERACTION_MODEL.md` (first draft) — the
  unified language from §10 (resource, surface, selection, context, command,
  tool, contribution, capability, event, task, artifact, provenance) mapped
  to actual current code locations.
- `docs/research/WORKBENCH_CURRENT_CODE_RESEARCH_BRIEF.md` — code findings.
- `docs/research/WORKBENCH_EXTERNAL_ARCHITECTURE_RESEARCH_BRIEF.md` —
  VS Code / Eclipse / JetBrains comparison.

**Subagents I'll use:** `Explore` (read-only repo discovery, parallel),
later iterations use `Source Analyst`, `Architecture Mapper`, `Code Executor`,
`Verification Agent`, `UX Guardian` as defined in the workspace agent roster.

**Stop conditions:** none other than §18 user-reserved items.

---

## Iteration 2+ — Subsystem slices (planned)

After the atlas exists, slice priority is decided by code state, not milestone
docs. Likely first targets based on what I already know from repo memories:
- IPC contract layer (typed registry exists in W6 but coverage is partial;
  many handlers untouched).
- Persistence ownership (mix of SQLite, workspace JSON, global/workspace
  storage, extension DBs — no canonical ownership registry).
- Extension manifest/capability model (the `parallx.d.ts` from W10 is unused
  and incomplete).
- Workbench startup phases (W2 `runPhase` invariant exists in
  `_initializeServices` but other phases haven't migrated).

Each slice will follow §16 work-definition + separate Executor and Reviewer
subagents + §22 verification.

---

## Repo memory audit (continuous)

`/memories/repo/*` contains ~30 files of past decisions and bug patterns. As
I touch each subsystem, I audit the relevant memory files for staleness and
update them. Stale notes get re-written or marked superseded. Fresh
discoveries get added.

---
