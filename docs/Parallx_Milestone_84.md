---
Status: planning — drafted by Conductor 2026-05-23 as M83 successor; pending user acceptance before research/baseline gates open (Manifest §2, §14, §17)
Milestone: M84 / SR-4: System Fitness Harness
Branch: systems-redesign-planning
Created: 2026-05-23
Parent baseline: master @ 9b9a243 (checkpoint-pre-systems-redesign-2026-05-23)
Predecessors: M81 / SR-1, M82 / SR-2, M83 / SR-3 (all implemented-verified 2026-05-23)
Supersedes: None
Manifest: docs/PARALLX_MANIFEST.md (§5 product goal, §11 preservation, §14 sequential handoffs, §17 milestone lifecycle, §22 verification contract)
Interaction model: docs/architecture/WORKBENCH_INTERACTION_MODEL.md (§2.6 Command, §2.10 Event, §2.11 Task) — required citation per M83 §9.6
Atlas: docs/architecture/SYSTEM_ATLAS.md (§1 entry points, §3 primary workflow, §7 test coverage map, §8 uncertainty markers)
Baseline: docs/research/baselines/workbench-baseline.md (§3 missing-measurement inventory, §4 proposed characterization tests, §8 missing-measurement catalog)
Governance: docs/research/git/BRANCH_GOVERNANCE.md
Conductor: Systems Redesign Conductor
---

# Parallx Milestone 84 / SR-4: System Fitness Harness

## 1. Goal

Make "better" **measurable before refactoring**.

M84 promotes the existing baseline scorecard ([docs/research/baselines/workbench-baseline.md](docs/research/baselines/workbench-baseline.md)) — which is currently a descriptive document — into a **runnable measurement harness** that produces before/after evidence for every subsequent redesign milestone.

The roadmap deliverables ([SYSTEMS_REDESIGN_CLEANUP_AND_MILESTONES.md §M84](docs/research/SYSTEMS_REDESIGN_CLEANUP_AND_MILESTONES.md) L295–L308) are:

1. Add `npm run test:system-fitness` (or equivalent documented command). Not assumed to exist before M84.
2. Startup timing baseline.
3. IPC count / duration baseline.
4. Cross-tool workflow baseline.
5. Canvas mixed-operation baseline.
6. Extension activation failure baseline.
7. Persistence / workspace switch recovery baseline.

**Proof gate (canonical):** a redesign PR cannot merge without before/after evidence from the harness, or an explicit "instrumentation first" exception recorded in the milestone doc.

## 2. User Workflows Protected

Same primary workflow as M81–M83 ([PARALLX_MANIFEST.md §5](docs/PARALLX_MANIFEST.md)):

> User opens a workspace → AI chat references workspace resources → user or AI creates Canvas pages/blocks → reopens workspace.

The six baselines listed in §1 each measure one segment of this workflow. **No user-visible behaviour changes**: M84 adds instrumentation, not features.

## 3. Scope

### In scope (this milestone)

- **New npm script**: `npm run test:system-fitness`. Composes the six baselines into a single command. Output is a structured JSON report under `data/fitness-reports/<date>.json` (path TBD; finalized during research gate).
- **Six measurement modules** under `tests/fitness/` (new directory):
  - `startup.fitness.ts` — measures cold-start time to interactive state (workspace open, first editor visible).
  - `ipc.fitness.ts` — counts IPC round-trips during the primary workflow and records p50/p95 duration.
  - `cross-tool.fitness.ts` — exercises Explorer → editor → chat → Canvas → save → reopen and records timing for each surface transition.
  - `canvas-mixed.fitness.ts` — measures mixed read/write operations on a populated canvas (M64 hot path).
  - `extension-activation-failure.fitness.ts` — exercises the M81 ContributionRegistry per-processor try/catch isolation under deliberately-failing manifests and asserts isolation is preserved.
  - `persistence-recovery.fitness.ts` — measures workspace switch + restore time and verifies state integrity.
- **Reusable measurement utilities** under `tests/fitness/_shared/` (timer wrappers, IPC counter, JSON report writer). Single-responsibility helpers only; no new abstractions.
- **Documentation**:
  - Update `docs/research/baselines/workbench-baseline.md` §2 with the first concrete numbers produced by the harness.
  - New `docs/research/baselines/FITNESS_HARNESS.md` describing how to run the harness, interpret reports, and integrate before/after evidence into milestone closeout commits.
- **Proof-gate enforcement**: amend the milestone-document template referenced in Manifest §17 to require a "Fitness Evidence" subsection (or an explicit "instrumentation first" exception) in §15 Closeout Evidence. This is a manifest-level governance change.

### Out of scope (explicitly deferred)

- Actually **improving** any of the measured numbers. M84 is instrumentation; M85 / SR-5 (Startup and Lifecycle Control Plane) is the first milestone that consumes harness output as before/after evidence.
- Continuous-integration wiring (running the harness on every push). Local-only invocation is sufficient for M84; CI integration is a future operational decision.
- AI-eval performance measurement. The existing `npm run test:ai-eval` already covers that surface; M84 does not subsume it.
- Modifying anti-list files (`electron/*`, `src/openclaw/*`, `src/built-in/canvas/canvasDataService.ts`, `src/built-in/canvas/canvasPersistence.ts`, `src/built-in/canvas/config/blockRegistry.ts`, `src/services/chatAgentService.ts`). The harness **observes** these paths; it must not instrument them by modifying their source. Measurement points are added at boundary call-sites (preload, IPC bridge entry, surface bootstraps) only.
- New runtime services. Measurement utilities live under `tests/fitness/` and do not ship in the renderer or main bundle.

## 4. Out Of Scope — Anti-List (cannot be touched without explicit user approval)

- `electron/*` (main, preload, IPC bridges) — measurement must happen at the test harness layer, not by editing the bridge source. If timing needs an in-source hook, the Conductor must surface the request to the user before implementation.
- `src/openclaw/*`
- `src/built-in/canvas/canvasDataService.ts`
- `src/built-in/canvas/canvasPersistence.ts`
- `src/built-in/canvas/config/blockRegistry.ts`
- `src/services/chatAgentService.ts`
- Any file in `src/contributions/` introduced by M81 — read-only for M84.

## 5. Agents Assigned

| Slice | Agent | Card |
|---|---|---|
| Plan acceptance | Systems Redesign Conductor | [docs/research/agents/systems-redesign-conductor.md](docs/research/agents/systems-redesign-conductor.md) |
| Current-state research (existing timing/IPC instrumentation; what's measurable today without source modification) | Research Agent → `docs/research/M84_FITNESS_HARNESS_AUDIT.md` | [docs/research/agents/research-agent.md](docs/research/agents/research-agent.md) |
| External reference (VS Code's `test/smoke`, `test/integration`, `extension-test-runner` patterns; Electron `--enable-precise-memory-info` and `console.time`/Perf API conventions) | Research Agent → appended to audit | same |
| Baseline measurement methodology | Baseline and Metrics Agent → updates `docs/research/baselines/workbench-baseline.md` and new `docs/research/baselines/FITNESS_HARNESS.md` | [docs/research/agents/baseline-and-metrics-agent.md](docs/research/agents/baseline-and-metrics-agent.md) |
| Slice A: shared utilities + first baseline (startup) | Surgical Executor | [docs/research/agents/surgical-executor-agent.md](docs/research/agents/surgical-executor-agent.md) |
| Slices B–F: remaining five baselines | Surgical Executor | same |
| Per-slice fitness review | Fitness and Review Agent → `docs/research/M84_SLICE_<A..F>_REVIEW.md` | [docs/research/agents/fitness-and-review-agent.md](docs/research/agents/fitness-and-review-agent.md) |
| Branch/commit/rollback bookkeeping | Git and Release Steward | [docs/research/agents/git-and-release-steward.md](docs/research/agents/git-and-release-steward.md) |

## 6. Current-State Research Required (before Slice A) — PENDING

Audit must answer:

1. What timing instrumentation already exists in the codebase (search for `performance.now`, `console.time`, `Date.now()` call sites in `src/**` and `electron/**`)?
2. Which IPC handlers expose call-count / duration today? Which need wrapping at the harness layer?
3. Which existing tests under `tests/unit/`, `tests/playwright/`, and `tests/ai-eval/` already cover any of the six measurement targets — to avoid duplication?
4. What test fixtures already produce a populated workspace suitable for the canvas-mixed and cross-tool baselines?
5. Is the M82 extension-activation H15 baseline (`tests/unit/extensionActivationSync.test.ts`) directly reusable as the extension-activation-failure baseline, or does it need a parallel deliberately-failing-manifest variant?

Audit lands at `docs/research/M84_FITNESS_HARNESS_AUDIT.md` before any code is written.

## 7. External Research Required (before Slice A) — PENDING

Compare:

- VS Code's `test/smoke/` harness shape and how it records timings.
- Electron's recommended performance-measurement APIs (`performance.mark`, `performance.measure`, `--enable-precise-memory-info`).
- At least one comparable Electron/desktop-app fitness harness (Obsidian's QA pipeline, Logseq's perf suite, or similar) for cross-tool baseline shape.

Findings append to the same audit doc with explicit "adopt / don't adopt" verdicts.

## 8. Baseline And Metrics Required (before Slice A) — PENDING

The harness IS the baseline. But before authoring the harness, the Baseline Agent must:

- Confirm `docs/research/baselines/workbench-baseline.md` §3 missing-measurement inventory and §8 missing-measurement catalog still match the six required baselines exactly. Adjust list if drift detected.
- Define numeric tolerances per baseline (the +/-5% ceiling from M82 may not generalize; some baselines may need wider bands).
- Define the JSON report schema so before/after diffing is mechanical.

## 9. Workbench Concepts Involved

Per M83 §9.6 (required citation):

- **Command** ([WORKBENCH_INTERACTION_MODEL.md §2.6](docs/architecture/WORKBENCH_INTERACTION_MODEL.md)) — `test:system-fitness` is invoked as a top-level npm command; baseline modules invoke workbench commands to drive the workflow.
- **Event** ([§2.10](docs/architecture/WORKBENCH_INTERACTION_MODEL.md)) — measurement hooks observe `onDidChange*` events from `Workspace`, `SelectionService`, and surface lifecycle to mark transitions.
- **Task** ([§2.11](docs/architecture/WORKBENCH_INTERACTION_MODEL.md)) — each fitness module is itself a Task: parameterized, idempotent, produces an Artifact (the JSON report).
- **Artifact** ([§2.12](docs/architecture/WORKBENCH_INTERACTION_MODEL.md)) — fitness reports are persisted under `data/fitness-reports/` with timestamps.
- **Provenance** ([§2.13](docs/architecture/WORKBENCH_INTERACTION_MODEL.md)) — every report records `{ git_head, node_version, electron_version, host_os }` so before/after comparisons are reproducible.

## 10. Implementation Slices

Six slices, executed in order. Each is a single Surgical Executor commit followed by a fitness review.

| Slice | Scope | Commit prefix |
|---|---|---|
| A | Shared utilities (`tests/fitness/_shared/`) + npm script wiring + startup baseline | `feat(fitness): shared utilities and startup baseline (M84 Slice A)` |
| B | IPC count/duration baseline | `feat(fitness): IPC instrumentation baseline (M84 Slice B)` |
| C | Cross-tool workflow baseline | `feat(fitness): cross-tool workflow baseline (M84 Slice C)` |
| D | Canvas mixed-operation baseline | `feat(fitness): canvas mixed-op baseline (M84 Slice D)` |
| E | Extension activation failure baseline | `feat(fitness): extension activation failure baseline (M84 Slice E)` |
| F | Persistence / workspace switch recovery baseline + manifest §17 template amendment + FITNESS_HARNESS.md | `feat(fitness): persistence recovery baseline and closeout governance (M84 Slice F)` |

Each commit body must include: target workflow segment, measurement methodology, baseline numbers captured, tolerance band, and rollback note (`Rollback: git revert HEAD.`).

## 11. Verification Plan

- **Per slice:** new fitness module runs cleanly via `npm run test:system-fitness -- --only <module>`. JSON report shape matches schema. Run twice; variance within tolerance.
- **Across slices:** full `npm run test:system-fitness` invocation produces one consolidated report. No slice's module degrades a prior slice's number outside tolerance.
- **Suite gate:** existing 3203/1-skip vitest suite must remain green after every slice. Existing `npm run test:e2e` and `npm run test:ai-eval` unchanged.
- **Anti-list gate:** `git diff <slice-base>..HEAD --stat` audited per slice to confirm no anti-list file touched.

## 12. Preservation Checklist

- ✅ Manifest §11 preservation: instrumentation lives in `tests/fitness/`, not in `src/**` or `electron/**`.
- ✅ Manifest §5 primary workflow: harness exercises the workflow; does not modify it.
- ✅ Manifest §22 verification contract: this milestone is the verification mechanism for SR-5+.
- ✅ Anti-list (canvasDataService, canvasPersistence, blockRegistry, chatAgentService, electron/*, openclaw/*): observation only, no source modification.
- ✅ External extensions, MCP servers, AI tools: unaffected.

## 13. Commit Plan

One commit per slice. Six slice commits + one closeout commit that updates the milestone doc Status Trail to `implemented-verified`. Manifest §17 template amendment lands in Slice F (atomic with the policy it codifies).

Every commit footer: `Rollback: git revert HEAD.`

## 14. Rollback Plan

Per-slice revert is safe because each slice adds files under `tests/fitness/` only (one `package.json` scripts entry from Slice A, one `docs/PARALLX_MANIFEST.md` template amendment in Slice F). No state migration, no schema change, no runtime behaviour change.

Whole-milestone rollback: `git revert <closeout>..<slice-A-base>` reverts the chain. The baseline numbers recorded in `docs/research/baselines/workbench-baseline.md` are content additions that can also be reverted in the same operation.

## 15. Closeout Evidence

To be populated at milestone end:

- Six slice commits + slice reviews.
- One consolidated baseline run with all six modules green.
- Updated `workbench-baseline.md` §2 with concrete numbers.
- Manifest §17 template amendment.
- `docs/research/baselines/FITNESS_HARNESS.md` authored.
- Full vitest / playwright / ai-eval suite green.

## 16. Stop / Escalation Conditions

The Surgical Executor must stop and surface to the user if any of:

- A baseline cannot be measured without modifying an anti-list file (in particular: if startup or IPC timing requires `electron/preload.cjs` hooks). Conductor must seek explicit user approval for a precisely-scoped anti-list edit.
- A measured baseline reveals a regression vs. the prior baseline scorecard (workbench-baseline.md §2 has numbers from May 2026). Stop and surface; do NOT silently fix the regression as part of M84.
- A slice's tolerance band cannot be defined because variance exceeds 25% across three runs.
- The Manifest §17 template amendment in Slice F materially changes how prior milestones (M81–M83) would be evaluated. Surface for user confirmation.

## 17. Status Trail

| Date | Status | Change | Commit |
|---|---|---|---|
| 2026-05-23 | `planning` | Drafted by Conductor as M83 successor. Six SR-4 deliverables scoped into six slices. All five planning gates (research, atlas, baseline methodology, preservation, review) pending. Pending user acceptance per Manifest §2, §17. | (this commit) |
