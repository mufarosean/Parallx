# Parallx Systems Redesign Kickoff

> Status: Draft — awaiting user acceptance
> Author: Systems Redesign Conductor (kickoff role)
> Branch: `systems-redesign-planning`
> Parent baseline: `9b9a243` (also `checkpoint-pre-systems-redesign-2026-05-23`)
> Created: May 23, 2026
> Manifest: [PARALLX_MANIFEST.md](../PARALLX_MANIFEST.md)

This is the kickoff packet required by [PARALLX_MANIFEST.md §26](../PARALLX_MANIFEST.md). It defines the redesign system itself before any app system is redesigned. No app code has changed.

---

## 1. Product Goal

Make Parallx more reliable, coherent, debuggable, performant, and maintainable as a **unified Electron workbench** — without losing existing user workflows, workspaces, canvas content, extensions, or settings.

Success is measured by improvement in cross-tool composability (Explorer ↔ editors ↔ AI chat ↔ Canvas ↔ extensions ↔ MCP ↔ persistence), not by individual feature polish.

---

## 2. Current Branch State

| Ref | Commit | Notes |
|---|---|---|
| `master` | `9b9a243` | Current-app baseline |
| `origin/master` | `9b9a243` | In sync with `master` |
| `checkpoint-pre-systems-redesign-2026-05-23` | `9b9a243` | Restore point |
| `systems-redesign-planning` (HEAD) | `ea6e540` | 11 commits ahead of `master`, all docs-only |
| Working tree | clean | `[ahead 1]` of `origin/systems-redesign-planning` |

Linearity confirmed via `git rev-list --left-right --count master...HEAD` → `0    11`. No app code on this branch yet — every commit is a manifest/process document.

**Git boundary status:** safe. The 11 ahead commits are recoverable; `master` is untouched; the checkpoint branch is intact.

---

## 3. In Scope

- Workbench-level architecture and contribution model.
- Cross-tool interaction model (the unified workbench language).
- Documentation truth and milestone status cleanup.
- System Atlas with verified code/doc anchors.
- Startup/lifecycle readiness model.
- Persistence ownership map.
- IPC contracts.
- Extension contribution and capability model.
- Canvas and AI chat **participation** in shared workbench workflows.
- Background work, tasks, cancellation, workspace fences.
- Metrics, diagnostics, fitness gates.

## 4. Out Of Scope

- Rewriting Parallx from scratch.
- Redesigning AI chat internals.
- Redesigning OpenClaw internals.
- Replacing Claude/OpenClaw behavior.
- Breaking extension APIs without a documented migration plan.
- Removing workflows because they are inconvenient.
- Any app-code refactor before System Atlas + baseline exist.

---

## 5. Primary End-To-End Workflow

The first workflow this redesign must protect and improve (from [PARALLX_MANIFEST.md §5](../PARALLX_MANIFEST.md)):

1. User opens a workspace.
2. User browses files in Explorer.
3. User opens documents in editors.
4. User asks AI chat about those documents.
5. AI chat references the same workspace resources.
6. User or AI creates notes/summaries/structured output.
7. Those outputs become Canvas pages, blocks, links, or artifacts.
8. The user reopens the workspace later and continues without loss.

Secondary workflows that must keep working through every slice:
- Extension activation, contribution, settings, and packaging.
- MCP integrations.
- Workspace switch + restore.
- Save / interrupted-save recovery.

---

## 6. Risks If We Start Too Locally

- A workbench-level improvement that fixes one surface (e.g. Canvas links) but bypasses the shared resource/context layer entrenches the one-off bridges we are trying to remove.
- Documentation cleanup done in isolation can mis-label active milestones and create false "source of truth" claims.
- Touching IPC, persistence ownership, or extension API surface without a baseline risks silent regressions in workspaces and extensions already in user hands.
- Touching `master`, the checkpoint, or rewriting branch history is **irreversible** and breaks the rollback contract.
- Beginning code work before agents are instantiated collapses the role separation that the manifest requires (conductor / executor / reviewer / git steward).

---

## 7. Agents Needed First

Minimum first-generation roster (see [PARALLX_MANIFEST.md §13](../PARALLX_MANIFEST.md)):

| Agent | First duty |
|---|---|
| Systems Redesign Conductor | This kickoff; subsequent handoffs |
| Git and Release Steward | Branch governance note + linearity audits |
| Research Agent | Current-code research brief + external architecture brief |
| System Atlas Cartographer | Workbench atlas with code/doc anchors |
| Baseline and Metrics Agent | Baseline scorecard for the target workflow |
| Unified Workbench Interaction Agent | Shared-language proposal (after atlas + external research) |
| Milestone and Documentation Steward | M81 / SR-1 milestone doc + doc triage table |
| Fitness and Review Agent | Independent review of interaction model and (later) slices |
| Surgical Executor Agent | **Inactive** until a slice is accepted in C4 |

Environment note: this repo's agent roster (see workspace agents list) does not include redesign-specific roles. They must be created as **agent cards** in `docs/research/agents/` before delegation; the closest existing agent is `Explore` for read-only research. Specialist agent invocation will use card content as instruction. If the runtime cannot invoke specialists, manifest §13 requires explicit user approval to enter degraded single-agent mode — flagged in §22 below.

---

## 8. Agent Cards To Create

All nine cards live under `docs/research/agents/` (created in this kickoff commit):

- `systems-redesign-conductor.md`
- `git-and-release-steward.md`
- `research-agent.md`
- `system-atlas-cartographer.md`
- `baseline-and-metrics-agent.md`
- `unified-workbench-interaction-agent.md`
- `milestone-and-documentation-steward.md`
- `fitness-and-review-agent.md`
- `surgical-executor-agent.md` (inactive)

---

## 9. Sequential Handoff Plan

Mirrors [PARALLX_MANIFEST.md §14](../PARALLX_MANIFEST.md):

| # | Owner | Input | Output artifact |
|---|---|---|---|
| 1 | Git and Release Steward | This kickoff | `docs/research/git/BRANCH_GOVERNANCE.md` |
| 2 | Research Agent | Repo + manifest | `docs/research/WORKBENCH_CURRENT_CODE_RESEARCH_BRIEF.md` |
| 3 | System Atlas Cartographer | Discovery notes + source | `docs/architecture/SYSTEM_ATLAS.md` |
| 4 | Research Agent | Design questions from atlas | `docs/research/WORKBENCH_EXTERNAL_ARCHITECTURE_RESEARCH_BRIEF.md` |
| 5 | Baseline and Metrics Agent | Target workflow + atlas + tests | `docs/research/baselines/workbench-baseline.md` |
| 6 | Unified Workbench Interaction Agent | Atlas + external research + baseline plan | `docs/architecture/WORKBENCH_INTERACTION_MODEL.md` |
| 7 | Fitness and Review Agent | Proposed interaction model | `docs/research/WORKBENCH_INTERACTION_MODEL_REVIEW.md` |
| 8 | Milestone and Documentation Steward | Accepted plan | `docs/Parallx_Milestone_81.md` |
| 9 | Surgical Executor Agent | Accepted slice from M81 | First implementation patch (only after C4) |
| 10 | Fitness and Review Agent | Diff + tests + baseline | Keep/revise/rollback decision |
| 11 | Git and Release Steward | Accepted result | Commit + branch state record |

Steps 1–8 happen before app-code implementation.

---

## 10. Research Assignments

**Current-code research (Research Agent + System Atlas Cartographer):**
- Trace the primary workflow (§5) through `src/workbench`, `src/parts`, `src/views`, `src/editor`, `src/canvas` (located via `docs/canvas`), `src/contributions`, `src/commands`, `src/context`, `src/services`, `src/api`, `src/built-in`, `src/openclaw`, `electron/*.cjs`, `ext/*`.
- Inventory existing primitives: commands, contributions, context keys, selection, resource resolvers, tool registry, extension manifests, capability checks, event bus, IPC handlers, persistence owners.
- List duplicated state ownership, one-off bridges, hidden coupling, missing tests.

**External architecture research (Research Agent):**
- VS Code: contribution points, commands, context keys, menus/views, extension API, activation events, extension host boundary.
- One additional mature plugin/workbench platform (Eclipse extension points or JetBrains IntelliJ Platform actions/extensions).
- For each pattern: source link, what Parallx should learn, what Parallx should **not** copy, overengineering risk.

---

## 11. System Atlas Assignments

System Atlas Cartographer must deliver `docs/architecture/SYSTEM_ATLAS.md` containing:
- Entry points for the primary workflow.
- Owner per system (file anchor table).
- Cross-tool flow diagram with anchors.
- Duplicate-contract inventory.
- Uncertainty markers (assumptions that need verification).
- Test coverage map (which tests exercise which flow edges).

---

## 12. Baseline And Metrics Assignments

Baseline and Metrics Agent must deliver `docs/research/baselines/workbench-baseline.md` covering:
- Time-to-interactive (cold start, warm start).
- Workspace restore time and failure modes.
- Extension activation time and failure isolation behavior.
- Editor open + AI chat response time for the primary workflow.
- Canvas page open/save round-trip.
- IPC call volume and long-task counts during startup.
- Save-during-rebuild latency (FTS / autonomy / index rebuilds).
- Missing-measurement list with proposed instrumentation.

No baseline = no "better" claim. Slices without a baseline cannot proceed to C4.

---

## 13. Unified Workbench Language Questions

Open questions the Unified Workbench Interaction Agent must answer:
1. What is the canonical `Resource` identity? Path? URI? Stable ID?
2. How do `Surface`, `Selection`, and `Context` propagate today across Explorer, editor, Canvas, chat?
3. Which contribution points exist implicitly (hardcoded) vs. declaratively (manifest)?
4. What capability gates exist for filesystem, shell, network, secrets, DB, AI, external process?
5. Which events are typed vs. ad-hoc?
6. Where is provenance lost when an artifact crosses surfaces?
7. What is the migration path for existing extension APIs?

The interaction model must propose answers with compatibility guarantees, not greenfield abstractions.

---

## 14. Documentation And Milestone Cleanup Plan

Phase **C0 (planning cleanup)** starts only after user accepts this kickoff. C0 produces:
- Status labels on all milestone docs `M64..M80`.
- Archive moves for superseded milestones (preserving history under `docs/archive/milestones/`).
- README.md doc index update reflecting the four-bucket truth model.
- Created directories: `docs/research/agents/`, `docs/research/git/`, `docs/research/baselines/`, `docs/architecture/`.

Phase C1 (documentation truth) follows. C2/C3/C4 are gated as defined in [PARALLX_MANIFEST.md §25](../PARALLX_MANIFEST.md).

Current state observation: 17 milestone docs `M64..M80` exist; none carry a status label compliant with manifest §17. The Milestone and Documentation Steward must label each as `planning / active / partial / implemented-unverified / implemented-verified / superseded / archived` based on evidence — not assumed.

---

## 15. Commit And Branch Plan

| Phase | Commit purpose | Scope |
|---|---|---|
| Kickoff (this commit) | `docs: add systems redesign kickoff and first-gen agent cards` | Kickoff report + 9 agent cards only |
| C0.1 | `docs: scaffold redesign artifact directories` | Empty/index `.md` placeholders only if needed |
| C0.2 | `docs: label milestones M64..M80 with status` | Status frontmatter only |
| C0.3 | `docs: archive superseded milestones` | `git mv` to `docs/archive/milestones/`, no deletions |
| C1 | `docs: rewrite README doc index for truth model` | README + canonical/research/archive labels |
| C2 | `docs: add system atlas` | `docs/architecture/SYSTEM_ATLAS.md` |
| C3 | `test: characterize <workflow>` | Characterization tests; no app behavior change |
| C4 | `feat(<area>): <slice>` | One accepted slice; rollback note in commit body |

Rules (manifest §19, §20):
- One commit, one clear purpose.
- No mixing docs cleanup, atlas, app code, tests in one commit.
- No `master` updates without explicit user approval.
- No history rewrite, no checkpoint deletion.
- Every C4 commit includes a rollback note in the message body.

---

## 16. Git Boundary Report

```
Branch:        systems-redesign-planning (HEAD)
Upstream:      origin/systems-redesign-planning  [ahead 1]
Baseline:      9b9a243 (master == origin/master == checkpoint-pre-systems-redesign-2026-05-23)
Ahead of master: 11 commits (docs only)
Behind master:   0
Working tree:  clean
Recent commits:
  ea6e540 docs: require specialist agent delegation
  6f193e1 docs: clarify kickoff acceptance and agent creation
  904a0bc docs: define cleanup document retention matrix
  439ba05 docs: schedule phased cleanup gates
  69d135e docs: add git steward and handoff runbook
  17f0c84 docs: add fresh-agent manifest onboarding
  a58e0c0 docs: define end-to-end redesign operating contract
  c05f3cd docs: structure manifest as redesign kickoff
```

The Git and Release Steward inherits this report as its first input.

---

## 17. Verification And Bug Prevention Plan

Verification surface confirmed against `package.json`:
- `npm run build` — type-check + renderer build.
- `npm run test:unit` — Vitest.
- `npm run test:e2e` — Playwright e2e.
- `npm run test:ai-eval` — AI eval scenarios (only when an active milestone requires them).
- `npm run dev` — Electron launch for manual verification.

Rules:
- Kickoff itself (docs only) requires no behavior tests; link check + status clarity only.
- No C4 implementation slice proceeds without:
  1. Baseline evidence or characterization test for the workflow it touches.
  2. Preservation checks for workspaces, canvas content, extension APIs, settings, keybindings.
  3. Workflow preservation test in the patch or referenced from it.
  4. Rollback note in the commit.
- If a user-visible bug appears after a slice ships, the next milestone must add a test/trace/guard that would have caught it (manifest §22).

---

## 18. Artifact Locations To Create

This commit creates:
- `docs/research/SYSTEMS_REDESIGN_KICKOFF.md` (this file)
- `docs/research/agents/` (directory with 9 cards)

Subsequent commits will create:
- `docs/research/git/`
- `docs/research/baselines/`
- `docs/architecture/`
- `docs/archive/milestones/` (already exists as `docs/archive/milestones/` per workspace listing)

---

## 19. Decisions Needed From User

The conductor cannot move past this kickoff without explicit user direction on:

1. **Acceptance** of this kickoff plan (yes / revise / reject).
2. **Agent invocation mode**: full multi-agent (preferred — each card invoked as a specialist via `runSubagent`) or degraded single-agent mode (manifest §13 requires explicit approval for degraded mode).
3. **Specialist agent identity**: this workspace's pre-existing agent roster (see `<agents>`) is OpenClaw/Foundry-centric and does not include `Systems Redesign Conductor` etc. Confirm whether to (a) use generic `Explore` for research handoffs and run the redesign roles as documented agent cards, or (b) add new agent definitions to the workspace.
4. **C0 start**: may the Milestone and Documentation Steward begin labeling `M64..M80` and creating `M81 / SR-1`?
5. **Branch policy reaffirmation**: keep all redesign commits on `systems-redesign-planning`, never touch `master` or the checkpoint without explicit per-action approval — confirm.

No file beyond the kickoff package will be created until these are answered.

---

## 20. Cleanup Start Phase

**C0 — Planning cleanup.** Begins only after this kickoff is accepted.

C0 deliverables (in order, separate commits):
1. Artifact directory scaffolding.
2. Milestone status labels.
3. Archive moves for superseded milestones.

C1 (doc truth), C2 (atlas), C3 (baselines), C4 (app code) are gated and not yet authorized.

---

## 21. Stop Rules

The conductor stops here until the user answers §19. Per manifest §1:

> Stop before implementation if any of these are missing: verified branch/checkpoint state; named target workflow; current-state map with code/doc anchors; baseline or instrumentation plan; preservation checks; rollback rule; independent review gate.

Currently satisfied: branch state, target workflow.
Not yet satisfied: current-state map, baseline plan, preservation tests for proposed slices, independent review gate (no slice exists yet). Therefore **no implementation may start.**

---

## 22. Next Action

Wait for user response to §19. On acceptance:
1. Git and Release Steward writes `docs/research/git/BRANCH_GOVERNANCE.md`.
2. Research Agent begins current-code research brief.
3. Milestone and Documentation Steward begins C0 milestone labels.

No further changes will be made to app code, `master`, the checkpoint branch, or any milestone doc body until §19 is answered.
