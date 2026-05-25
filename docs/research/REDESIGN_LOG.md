# Parallx Redesign Running Log

> Format: append-only. Newest iteration at top. Each entry has a date and a
> commit hash where applicable. The agent updates this every iteration. The
> user reads this to monitor progress without sitting at the keyboard.

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
