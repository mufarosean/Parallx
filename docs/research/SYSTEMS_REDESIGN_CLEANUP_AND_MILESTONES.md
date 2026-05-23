# Systems Redesign Cleanup and Milestone Plan

> Status: Draft plan
> Created: May 23, 2026
> Branch: `systems-redesign-planning`
> Checkpoint branch: `checkpoint-pre-systems-redesign-2026-05-23`

---

## 1. Purpose

This plan exists because the systems redesign is too large to begin by editing one subsystem. The first work must make the whole app visible, clean the documentation surface, design the redesign operating system, and establish milestones that are honest about what is planned, partial, implemented, superseded, or archived.

The cleanup is not cosmetic. It is how we prevent local fixes from creating global regressions. The same systems-thinking rule applies to the process itself: before redesigning Parallx, define the system that will govern research, mapping, execution, checking, and rollback.

---

## 2. Branch and Checkpoint Strategy

Current local setup:

| Ref | Purpose |
|---|---|
| `master` / `origin/master` | Latest current app state at commit `9b9a243`. |
| `checkpoint-pre-systems-redesign-2026-05-23` / `origin/checkpoint-pre-systems-redesign-2026-05-23` | Named restore point at the same current app state, commit `9b9a243`. |
| `systems-redesign-planning` / `origin/systems-redesign-planning` | Dedicated branch for planning the cleanup and systems redesign. |

Completed remote strategy:

1. `origin/master` now reflects the latest current app state.
2. The checkpoint branch is pushed to `origin` so rollback is available outside the local machine.
3. `systems-redesign-planning` is pushed to `origin` as the isolated work branch.
4. Future redesign work stays on `systems-redesign-planning` until it proves better and is explicitly accepted for merge.

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

### Cleanup Schedule

Cleanup happens in phases. It does not all start at once.

Acceptance means explicit user approval or an explicit user instruction to continue under the proposed kickoff plan. The conductor may recommend acceptance, but it does not silently approve its own plan.

| Phase | When it starts | Owner | Allowed work | Blocked work |
|---|---|---|---|---|
| C0: Planning cleanup | Immediately after the kickoff report is accepted | Conductor + Milestone and Documentation Steward | Label docs in-place, update README truth notes, create milestone template, create agent cards, create artifact directories | Moving large sets of files, deleting files, app code changes |
| C1: Documentation truth cleanup | After milestone labels, archive rules, and README shape are accepted | Milestone and Documentation Steward + Git and Release Steward | Move stale milestone docs to archive, update README, mark canonical/research/archive status, preserve history | App-system refactors, extension/API changes |
| C2: System atlas cleanup | After C1 and repo discovery | System Atlas Cartographer | Create `SYSTEM_ATLAS.md`, document ownership gaps, identify duplicate or unclear contracts | Redesigning code to match the atlas |
| C3: Baseline/fitness cleanup | After target workflows are mapped | Baseline and Metrics Agent | Add or document characterization tests, missing instrumentation, baseline commands | Optimizing or refactoring behavior before baseline exists |
| C4: App-system cleanup | After atlas, baseline, workbench language, milestone, and review gates pass | Surgical Executor Agent | One accepted implementation slice at a time | Broad cleanup, opportunistic refactors, breaking compatibility |

The cleanup scheduled to start first is C0: Planning cleanup. It starts after the first agent produces the kickoff report and the user accepts it or instructs the conductor to proceed. Physical doc moves start in C1. App code cleanup starts only in C4.

The first scheduled cleanup milestone is `M81 / SR-1: Checkpoint, Manifest, Redesign System, and Documentation Triage`.

### Cleanup Start Gate

Before C0 begins:

- Branch graph is verified.
- Manifest is accepted as the kickoff contract.
- First agent has created the initial agent cards.
- Git and Release Steward has confirmed commit boundaries.

Before C1 begins:

- M64-M80 have proposed labels.
- README replacement shape is accepted.
- Archive destinations are listed.
- No delete operations are planned.

Before C4 begins:

- System Atlas exists for the target workflow.
- Baseline or instrumentation plan exists.
- Unified Workbench Language impact is documented.
- Active milestone has verification and rollback plans.
- Fitness and Review Agent has reviewed the design slice.

### Document Retention Matrix

Cleanup must use this matrix before moving files. If a file is not listed here, the Milestone and Documentation Steward must classify it before C1 starts.

#### Must Stay Canonical

These docs stay in place. They may be edited for accuracy, but they are not archive candidates during this cleanup:

- `docs/README.md`
- `docs/PARALLX_MANIFEST.md`
- `docs/USER_GUIDE.md`
- `docs/MCP_SERVERS_USER_GUIDE.md`
- `docs/ai/AI_USER_GUIDE.md`
- `docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md`
- `docs/PARALLX_MCP_SERVER_AUTHORING_FOR_AI.md`
- `docs/PARALLX_WORKSPACE_SCHEMA.md`
- `docs/SETTINGS_REGISTRY.md`

#### Verify Then Keep Or Repair

These appear to be current reference/user workflow docs, but the steward must verify accuracy and fix labels/links before treating them as canonical:

- `docs/WORKFLOWS.md`
- `docs/canvas/CANVAS_STRUCTURAL_MODEL.md`
- `docs/canvas/BLOCK_REGISTRY.md`
- `docs/canvas/ICON_REGISTRY.md`
- `docs/canvas/BLOCK_INTERACTION_RULES.md`
- `docs/ai/AUTONOMY_RUNTIME_CONTRACTS.md`
- `docs/ai/AUTONOMY_TASK_RAIL.md`
- `docs/ai/CANVAS_BLOCK_API.md`
- `docs/ai/GMAIL_MCP_INTEGRATION.md`

Rule: if one of these is current, keep it and link it from `docs/README.md`. If it is not current, mark it draft/research or archive it with a replacement pointer.

#### Keep As Active Planning During This Branch

These stay while `systems-redesign-planning` is active:

- `docs/research/SYSTEMS_THINKING_FOR_PARALLX.md`
- `docs/research/SYSTEMS_REDESIGN_AGENTS_AND_SKILLS.md`
- `docs/research/SYSTEMS_REDESIGN_CLEANUP_AND_MILESTONES.md`

Planned artifacts that should stay once created:

- `docs/research/SYSTEMS_REDESIGN_KICKOFF.md`
- `docs/research/agents/*.md`
- `docs/research/git/BRANCH_GOVERNANCE.md`
- `docs/research/baselines/*.md`
- `docs/architecture/SYSTEM_ATLAS.md`
- `docs/architecture/WORKBENCH_INTERACTION_MODEL.md`

#### Review For Archive Or Supersession

These are not automatically deleted. They must be labeled, summarized if needed, and moved only during C1 after the archive destination is explicit:

- Root milestone files `docs/Parallx_Milestone_64.md` through `docs/Parallx_Milestone_80.md`
- `docs/M70_DEDUP_AUDIT.md`
- `docs/Future_Improvements.md`, after still-relevant items are moved into the new milestone roadmap
- `docs/research/INTERACTION_LAYER_ARCHITECTURE.md`, if superseded by `WORKBENCH_INTERACTION_MODEL.md`
- `docs/research/Living_UI_Ideas.md`
- `docs/research/Living_UI_Research.md`
- Old research docs that are not canonical to the current app
- Point-in-time improvement plans
- Completed audits and trackers

#### Archive-Only Rule

Do not delete documentation during cleanup. Use `git mv` into the appropriate archive folder and preserve enough context for a future reader to understand why the document moved.

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

### M81 / SR-1: Checkpoint, Manifest, Redesign System, and Documentation Triage

Goal: create the stable baseline and define the operating system for redesign before changing the app.

Deliverables:

- `origin/master` reflects the latest current app.
- Remote checkpoint branch pushed.
- `PARALLX_MANIFEST.md` accepted.
- Agent roster accepted: conductor, research, atlas, baseline, unified interaction, milestone/documentation steward, executor, checker.
- Skill list accepted.
- Milestone docs labeled.
- Milestone template includes agents, research, baseline, verification, commit plan, rollback, and closeout evidence.
- README updated to reflect true active/planning/archive state.
- No docs deleted; archive-only moves.

Proof gate:

- Branch graph is verified.
- All links in canonical docs resolve or are marked for repair.
- User can identify what docs are current in under one minute.
- The redesign process has named roles, artifacts, commit rules, proof gates, verification rules, and rollback rules.
- The bug-prevention rule is explicit: users are not the QA plan.

### M82 / SR-2: Whole-App Atlas and Cross-Tool Workflow Map

Goal: see the whole app end to end before proposing subsystem changes.

Deliverables:

- `docs/architecture/SYSTEM_ATLAS.md`
- Explorer to editor to AI chat to Canvas workflow map.
- Startup flow map.
- Workspace switch flow map.
- Persistence ownership map.
- IPC channel inventory.
- Extension lifecycle map.
- Command/context/tool contribution inventory.
- Canvas structural flow map.
- Background work inventory.

Proof gate:

- Each major flow has owner, state, failure modes, and tests.
- Cross-tool workflows identify resources, surfaces, selections, context, commands, tools, capabilities, events, tasks, artifacts, and provenance.
- Missing measurements and missing bug-catching tests are listed as first-class work.

### M83 / SR-3: Unified Workbench Language and Extension Interaction Model

Goal: define the central language that lets separate features behave like one workbench.

Deliverables:

- `docs/architecture/WORKBENCH_INTERACTION_MODEL.md`
- External research notes for VS Code contribution points, commands, context keys, extension APIs, and at least one comparable mature plugin/workbench architecture.
- Workbench-level concept model: workspace, resource, surface, selection, context, command, tool, contribution, capability, event, task, artifact, provenance.
- Universal service map: command registry, contribution registry, context/selection service, resource/link resolver, tool registry, task/job service, extension API bridge, IPC contract layer, capability service, event bus, persistence ownership registry, status/notification, trace/diagnostics.
- Compatibility plan for existing built-ins and extensions.
- Exception policy for one-off bridges.

Proof gate:

- Explorer, editor, AI chat, Canvas, and extension workflows can be described using the shared model.
- No new cross-tool interaction is approved without naming its workbench concepts and tests.
- Existing extension behavior has a migration or compatibility path.

### M84 / SR-4: System Fitness Harness

Goal: make "better" measurable before refactoring.

Deliverables:

- Add `npm run test:system-fitness` or an equivalent documented system-fitness command. This command is planned; it is not assumed to exist before M84.
- Startup timing baseline.
- IPC count/duration baseline.
- Cross-tool workflow baseline.
- Canvas mixed-operation baseline.
- Extension activation failure baseline.
- Persistence/workspace switch recovery baseline.

Proof gate:

- A redesign PR cannot merge without before/after evidence or an explicit "instrumentation first" exception.

### M85 / SR-5: Startup and Lifecycle Control Plane

Goal: reach interactive state faster and with clearer readiness.

Deliverables:

- Explicit readiness states.
- Startup task inventory.
- Required vs deferrable task split.
- Startup timing events.
- Visible-editor-first restore plan or implementation.

Proof gate:

- Time to interactive improves or debugging visibility improves without breaking restore.

### M86 / SR-6: Persistence and IPC Contracts

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

### M87 / SR-7: Extension Isolation and Capability Model

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

### M88 / SR-8: Canvas, Chat Participation, and Background Work Hardening

Goal: protect the editing experience and cross-tool workflows while workspaces scale.

Deliverables:

- Canvas mixed-operation fitness tests.
- AI chat participation checks for shared workbench resources/context/artifacts, without redesigning AI chat internals.
- Background job inventory.
- Workspace-scoped job cancellation.
- Job coalescing/backpressure design.
- Foreground responsiveness checks.

Proof gate:

- Canvas invariants survive repeated mixed operations.
- AI chat can participate in shared workbench workflows through accepted contracts.
- Background work cannot write into the wrong workspace after switch.

### M89 / SR-9: Consolidation and Release Decision

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
- At least one measurable improvement is demonstrated in startup, debugging, recovery, performance, composability, or bug prevention.

---

## 7. First Execution Rule

The first implementation task is not startup, persistence, IPC, canvas, chat, or extensions. The first implementation task is redesign-system truth:

1. Label milestone docs.
2. Create/accept the manifest.
3. Accept the redesign operating model: conductor, research, atlas, baseline, unified interaction, executor, checker.
4. Rewrite README.
5. Archive stale docs without deletion.
6. Create System Atlas skeleton.
7. Research mature workbench/plugin systems.
8. Define the unified workbench language skeleton.

Only then should app-system implementation begin.

