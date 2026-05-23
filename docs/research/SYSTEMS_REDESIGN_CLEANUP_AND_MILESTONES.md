# Systems Redesign Cleanup and Milestone Plan

> Status: Draft plan
> Created: May 23, 2026
> Branch: `systems-redesign-planning`
> Checkpoint branch: `checkpoint-pre-systems-redesign-2026-05-23`

---

## 1. Purpose

This plan exists because the systems redesign is too large to begin by editing one subsystem. The first work must make the whole app visible, clean the documentation surface, and establish milestones that are honest about what is planned, partial, implemented, superseded, or archived.

The cleanup is not cosmetic. It is how we prevent local fixes from creating global regressions.

---

## 2. Branch and Checkpoint Strategy

Current local setup:

| Ref | Purpose |
|---|---|
| `checkpoint-pre-systems-redesign-2026-05-23` | Local checkpoint at commit `9b9a243`, before systems redesign planning docs were committed. |
| `systems-redesign-planning` | Dedicated branch for planning the cleanup and systems redesign. |

Recommended remote strategy:

1. Push the checkpoint branch to `origin` so rollback is available outside the local machine.
2. Push `systems-redesign-planning` to `origin` as the work branch.
3. Do not fast-forward `origin/master` until the user explicitly decides this branch is the new baseline.

Rollback:

```bash
git switch checkpoint-pre-systems-redesign-2026-05-23
```

or, after remote push:

```bash
git switch -c restore-pre-redesign origin/checkpoint-pre-systems-redesign-2026-05-23
```

---

## 3. Milestone Status Labels

Use these labels before moving files:

| Label | Meaning |
|---|---|
| `active` | The one milestone currently being executed. |
| `planning` | Draft plan, not yet accepted for execution. |
| `partial` | Some work shipped, remaining phases still open. |
| `implemented-unverified` | Appears implemented, but closeout verification is missing. |
| `implemented-verified` | Implemented and closeout evidence is present. |
| `superseded` | Replaced by a newer plan. |
| `archived` | Historical only; not source of truth. |

Root `docs/` should eventually contain only the current active milestone. All others should move to `docs/archive/milestones/` with labels preserved.

---

## 4. Current Milestone Triage

This table is based on the milestone headers and visible status notes only. It must be verified before files are moved.

| Milestone | Current visible status | Proposed label | Cleanup action |
|---|---|---|---|
| M64 | No explicit top status; M80 says README active line is stale | `implemented-unverified` or `superseded` | Verify; then archive. |
| M65 | Iterations 1-2 complete, likely closed later in file | `implemented-unverified` | Verify final status; then archive. |
| M66 | No quick closeout found in header | `partial` | Inspect and label accurately. |
| M67 | Substantially shipped; explicit open items | `partial` | Keep open-items summary; archive after superseded/open items moved. |
| M68 | MVP implemented; bake/tune ongoing | `partial` | Mark as partial/bake; decide whether remaining bake belongs in new roadmap. |
| M69 | Planning | `planning` | Mark planning; likely archive as superseded unless still wanted. |
| M70 | Implemented | `implemented-unverified` | Verify and archive. |
| M71 | Planning | `planning` | Decide keep/defer/supersede. |
| M72 | Planning | `planning` | Decide keep/defer/supersede. |
| M73 | Implemented | `implemented-unverified` | Verify and archive. |
| M74 | Implemented | `implemented-unverified` | Verify and archive. |
| M75 | Implemented | `implemented-unverified` | Verify and archive. |
| M76 | Planning | `planning` | Decide keep/defer/supersede. |
| M77 | Implemented with audit follow-ups | `implemented-verified` if tests still pass | Archive after link check. |
| M78 | Implemented; docs-only Phase 9 pending/complete note | `implemented-unverified` | Verify and archive. |
| M79 | Planning + execution underway | `partial` | Freeze and label; do not continue during cleanup unless user prioritizes it. |
| M80 | Planning; awaiting sign-off; claims active | `planning` | Freeze and label; do not treat as active during systems cleanup unless user chooses it. |

Immediate issue: [docs/README.md](../README.md) says active milestone is M64, while M80 says that line is stale. The cleanup branch should replace that with a clear "Milestones are under systems-redesign triage" note until one active milestone is selected.

---

## 5. Documentation Cleanup Plan

Do not delete historical docs. Move them to archive after labeling.

### Keep as Canonical

Keep these at root or one level deep, after verification:

- `docs/USER_GUIDE.md`
- `docs/MCP_SERVERS_USER_GUIDE.md`
- `docs/ai/AI_USER_GUIDE.md`
- `docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md`
- `docs/PARALLX_MCP_SERVER_AUTHORING_FOR_AI.md`
- `docs/PARALLX_WORKSPACE_SCHEMA.md`
- `docs/SETTINGS_REGISTRY.md`
- `docs/PARALLX_MANIFEST.md`
- `docs/canvas/CANVAS_STRUCTURAL_MODEL.md`
- `docs/canvas/BLOCK_REGISTRY.md`
- `docs/canvas/ICON_REGISTRY.md`
- `docs/canvas/BLOCK_INTERACTION_RULES.md`, if still accurate after review

### Keep as Active Planning During This Branch

- `docs/research/SYSTEMS_THINKING_FOR_PARALLX.md`
- `docs/research/SYSTEMS_REDESIGN_AGENTS_AND_SKILLS.md`
- `docs/research/SYSTEMS_REDESIGN_CLEANUP_AND_MILESTONES.md`

### Archive Candidates

- Root milestone files M64-M80 after labeling.
- Old research docs that are not canonical to the current app.
- Point-in-time improvement plans.
- Completed audits and trackers.

### README Replacement

Rewrite `docs/README.md` around:

1. Product manifest.
2. User docs.
3. Author docs.
4. Canonical reference.
5. Active systems redesign docs.
6. Archive.
7. Documentation rules.

---

## 6. New Milestone Sequence

These are proposed new milestones for the systems redesign branch. Numbering can use M81+ or a separate `SR-*` prefix. The important part is sequence and proof gates.

### M81 / SR-1: Checkpoint, Manifest, and Documentation Triage

Goal: create the stable baseline before changing the app.

Deliverables:

- Remote checkpoint branch pushed.
- `PARALLX_MANIFEST.md` accepted.
- Milestone docs labeled.
- README updated to reflect true active/planning/archive state.
- No docs deleted; archive-only moves.

Proof gate:

- All links in canonical docs resolve or are marked for repair.
- User can identify what docs are current in under one minute.

### M82 / SR-2: System Atlas and Baseline Scorecards

Goal: see the whole app end to end.

Deliverables:

- `docs/architecture/SYSTEM_ATLAS.md`
- Startup flow map.
- Workspace switch flow map.
- Persistence ownership map.
- IPC channel inventory.
- Extension lifecycle map.
- Canvas structural flow map.
- Background work inventory.

Proof gate:

- Each major flow has owner, state, failure modes, and tests.
- Missing measurements are listed as first-class work.

### M83 / SR-3: System Fitness Harness

Goal: make "better" measurable before refactoring.

Deliverables:

- `npm run test:system-fitness`
- Startup timing baseline.
- IPC count/duration baseline.
- Canvas mixed-operation baseline.
- Extension activation failure baseline.
- Persistence/workspace switch recovery baseline.

Proof gate:

- A redesign PR cannot merge without before/after evidence or an explicit "instrumentation first" exception.

### M84 / SR-4: Startup and Lifecycle Control Plane

Goal: reach interactive state faster and with clearer readiness.

Deliverables:

- Explicit readiness states.
- Startup task inventory.
- Required vs deferrable task split.
- Startup timing events.
- Visible-editor-first restore plan or implementation.

Proof gate:

- Time to interactive improves or debugging visibility improves without breaking restore.

### M85 / SR-5: Persistence and IPC Contracts

Goal: make durable state and renderer-main communication safer.

Deliverables:

- State ownership table enforced by docs/tests.
- Migration invariant checks.
- Workspace switch fences.
- IPC contract table.
- Error normalization policy.

Proof gate:

- Interrupted switch/save tests produce consistent recovery.
- IPC pressure is measurable and bounded for startup/restore.

### M86 / SR-6: Extension Isolation and Capability Model

Goal: make extensions powerful but contained.

Deliverables:

- Activation timeout policy.
- Extension failure state.
- Capability checks in warn-only mode.
- API compatibility tests.
- Extension authoring docs updated.

Proof gate:

- Broken/slow extension cannot block workbench startup.
- Existing extensions still work during warn-only rollout.

### M87 / SR-7: Canvas and Background Work Hardening

Goal: protect the editing experience while workspaces scale.

Deliverables:

- Canvas mixed-operation fitness tests.
- Background job inventory.
- Workspace-scoped job cancellation.
- Job coalescing/backpressure design.
- Foreground responsiveness checks.

Proof gate:

- Canvas invariants survive repeated mixed operations.
- Background work cannot write into the wrong workspace after switch.

### M88 / SR-8: Consolidation and Release Decision

Goal: decide whether the redesign branch is better enough to become baseline.

Deliverables:

- Before/after scorecard.
- Known regressions.
- Remaining debt list.
- Docs final cleanup.
- Merge/rollback recommendation.

Proof gate:

- Fitness suite passes.
- User-visible workflows are preserved.
- At least one measurable improvement is demonstrated in startup, debugging, recovery, performance, or bug prevention.

---

## 7. First Execution Rule

The first implementation task is not startup, persistence, IPC, or canvas. The first implementation task is documentation truth:

1. Label milestone docs.
2. Create/accept the manifest.
3. Rewrite README.
4. Archive stale docs without deletion.
5. Create System Atlas skeleton.

Only then should app-system implementation begin.

