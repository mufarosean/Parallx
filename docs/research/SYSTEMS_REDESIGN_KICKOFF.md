# Parallx Systems Redesign Kickoff

> Status: Active. Self-accepted under §0 of the autonomous-iteration manifest.
> Produced 2026-05-25 by the Systems Redesign Conductor after the manifest
> was updated to remove user-gating Stop Rules. Replaces the May 23 draft
> (which expected user acceptance) and reflects the current branch state at
> HEAD `33a5d8fa`.

---

## Product Goal

Make Parallx a more reliable, coherent, debuggable, performant, and
maintainable second-brain workbench without losing existing
functionality. Success is measured against §12 Definition Of Better
and §9 What Working Well Means. The redesign is successful only if
Parallx becomes a better unified workbench, not merely a cleaner
collection of separate features.

## Current Branch State

| Ref | SHA | Meaning |
|---|---|---|
| `master` | `9b9a2431` | Latest current app state. |
| `origin/master` | `9b9a2431` | Matches `master`. |
| `checkpoint-pre-systems-redesign-2026-05-23` | `9b9a2431` | Matches `master`. Checkpoint integrity intact. |
| `systems-redesign-planning` (HEAD) | `33a5d8fa` | Working branch after the autonomous-iteration contract commit. |
| `origin/systems-redesign-planning` | `33a5d8fa` | Pushed. |

Working tree clean except `e2e-results.json` (untracked test output).
Commits ahead of `master`: 398 (every previous redesign session up to
and including M86 W1–W12). They will not be merged to `master` until
the consolidation milestone decides the branch is measurably better.

## In Scope (manifest §8)

Workbench-level architecture; cross-tool interaction model;
documentation truth; System Atlas; startup/lifecycle; persistence
ownership; IPC contracts; extension contribution and capability model;
canvas + AI chat participation as workbench consumers/producers;
background work; metrics, diagnostics, tests, fitness gates.

## Out Of Scope

- Rewriting the app from scratch.
- **AI chat infrastructure**: `src/openclaw/**`,
  `src/services/chatAgentService.ts`, the chat agent loop, tool-call
  interpreter, participant/skill plumbing. Off-limits this cycle.
- Replacing Claude/OpenClaw behavior.
- **Breaking** existing extension APIs, settings, keybindings, or
  saved data without a provably better replacement + migration.
- Removing workflows without a measurably better replacement.

## Primary End-To-End Workflow (manifest §5)

1. Open a workspace. 2. Browse files in Explorer. 3. Open documents in
editors. 4. Ask AI chat about those documents. 5. AI chat references
the same workspace resources. 6. Create notes, summaries, structured
output. 7. Those outputs become Canvas pages, blocks, links,
artifacts. 8. Reopen the workspace later and continue without loss.

Every implementation slice must answer: does this protect or improve
this workflow, and is the §22 verification tied to it?

## Risks If The Redesign Starts Too Locally

1. **Repeat of M86 failure pattern.** Shipping infrastructure
   scaffolds without an atlas leads to dead code that adds maintenance
   load without changing the running app. M86 produced ~5 commits of
   scaffolding for ~3 user-visible wins.
2. **Hidden coupling.** Cross-feature contracts (Explorer ↔ editor ↔
   canvas ↔ chat ↔ extensions) live across many files; without the
   atlas, refactors break them invisibly.
3. **Persistence ownership drift.** SQLite, workspace JSON,
   `.parallx/`, global storage, extension DBs already exist. Without
   an ownership registry, every new feature adds another store.
4. **Performance regression invisibility.** No baseline for startup
   time, IPC traffic, foreground responsiveness → regressions ship as
   "feels slower" reports weeks later.
5. **AI chat side-effects.** Chat consumes workspace context.
   Changes to context, resource resolution, retrieval, or tool
   registration can break chat without touching `src/openclaw/**`.
   The atlas must mark the chat boundary explicitly.

## Agents Needed First

| # | Agent | Active iteration 1? |
|---|---|---|
| 1 | Systems Redesign Conductor | Yes (this agent) |
| 2 | Git and Release Steward | Yes — branch state verified above |
| 3 | Research Agent | Yes — repo discovery |
| 4 | System Atlas Cartographer | Yes — atlas skeleton |
| 5 | Baseline and Metrics Agent | Yes — baseline scorecard |
| 6 | Unified Workbench Interaction Agent | Yes — interaction model draft |
| 7 | Milestone and Documentation Steward | Yes — README/index updates |
| 8 | Surgical Executor Agent | Iteration 2+ |
| 9 | Fitness and Review Agent | Iteration 2+ |

Runtime instantiation: I'll use the workspace's existing subagents
(`Explore`, `Source Analyst`, `Architecture Mapper`, `Code Executor`,
`Verification Agent`, `UX Guardian`) as the actual subagent calls,
mapped to the manifest roles above.

## Agent Cards To Create

`docs/research/agents/`:

- `systems-redesign-conductor.md`
- `git-and-release-steward.md`
- `research-agent.md`
- `system-atlas-cartographer.md`
- `baseline-and-metrics-agent.md`
- `unified-workbench-interaction-agent.md`
- `milestone-and-documentation-steward.md`
- `fitness-and-review-agent.md`
- `surgical-executor-agent.md`

## Sequential Handoff Plan (Iteration 1)

1. Git and Release Steward verifies branch state. → DONE above.
2. Research Agent does repo discovery (Explore subagent). →
   `docs/research/WORKBENCH_CURRENT_CODE_RESEARCH_BRIEF.md`.
3. System Atlas Cartographer maps the workbench. →
   `docs/architecture/SYSTEM_ATLAS.md`.
4. Research Agent compares with VS Code / Eclipse / JetBrains. →
   `docs/research/WORKBENCH_EXTERNAL_ARCHITECTURE_RESEARCH_BRIEF.md`.
5. Baseline and Metrics Agent defines measurable behavior. →
   `docs/research/baselines/workbench-baseline.md`.
6. Unified Workbench Interaction Agent drafts the model. →
   `docs/architecture/WORKBENCH_INTERACTION_MODEL.md`.
7. Fitness and Review Agent reviews the model (separate subagent
   session per §13a).
8. Milestone Steward creates the first implementation milestone.

## Research Assignments

| Assignment | Owner | Output |
|---|---|---|
| Repo discovery: every cross-cutting workbench primitive (commands, contributions, services, IPC channels, persistence stores, extension API methods, context keys, event bus calls) | Research Agent | Current code brief |
| External: VS Code contribution points, commands, context keys, menus, extension API surface, activation events, extension host boundary | Research Agent | External brief |
| External: Eclipse extension points, JetBrains action system | Research Agent | External brief 2 |

## System Atlas Assignments

For each system in manifest §6:

- Entry points (file:line).
- Public contracts (types, IPC channel names, command IDs, service interfaces).
- Durable state (files/tables owned).
- Events published/subscribed.
- Tests that protect it.
- Known pain (cross-references to `/memories/repo/*` and historical milestone docs).
- Boundary with adjacent systems.

## Baseline And Metrics Assignments

| Signal | Measure today | Instrumentation needed |
|---|---|---|
| Time to interactive | Manual + `runPhase` logs | Phase timing events (partial) |
| IPC handler count | `grep ipcMain.handle electron/**` | None additional |
| IPC channel surface area | Static analysis of preload | Typed registry coverage report (W6 partial) |
| Renderer long tasks | DevTools Performance | PerformanceObserver longtask reporter |
| Test counts (tier-0/tier-1/e2e) | `vitest run --reporter=json`, `playwright list` | None |
| Build size | `dist/renderer/**` bytes | None |
| localStorage call sites | `grep -r localStorage src/` | None |
| Direct fs:* call sites | `grep ipcRenderer.invoke.*fs: src/` | None |
| SQLite DB count / paths | `Get-ChildItem data -Recurse -Filter *.db` | None |
| Extension API method count | Public exports in `parallx.d.ts` (W10) | Usage coverage |

## Unified Workbench Language Questions (manifest §10)

- Canonical Resource identity today? Likely no — files, canvas pages,
  blocks, generated artifacts, web results, db records, extension
  outputs have separate IDs.
- Single command registry? Likely yes (`src/contributions/commandRegistry.ts`),
  but tools, MCP tools, AI tools, built-in keybindings register
  through different paths.
- Single context/selection service? Likely no.
- Typed event bus? `src/events/` exists; coverage unclear.
- Central capability/permission gate? Partial only.
- Task/job service? Unclear.
- Persistence ownership registry? No.

Atlas + research brief must answer with code anchors.

## Documentation And Milestone Cleanup Plan

Per manifest §24:

- **Canonical**: `docs/USER_GUIDE.md`, `docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md`,
  `docs/PARALLX_MCP_SERVER_AUTHORING_FOR_AI.md`,
  `docs/PARALLX_WORKSPACE_SCHEMA.md`, `docs/SETTINGS_REGISTRY.md`,
  `docs/PARALLX_MANIFEST.md`, this kickoff.
- **Active**: first implementation milestone (created iteration 2).
- **Research/planning**: `docs/research/`.
- **Archive**: `docs/Parallx_Milestone_64.md` through
  `docs/Parallx_Milestone_86.md` (24 milestone files). The Steward
  labels them and moves the closed ones to `docs/archive/milestones/`
  in iteration 1 (C1 cleanup). No deletes — archive only.

## Commit And Branch Plan

- Iteration 1: ~5–7 commits (kickoff+cards, atlas, baseline,
  interaction model, research briefs, doc archive).
- Iteration 2+: one commit per slice per §16/§22 + separate Reviewer
  fixes if any.
- Push to `origin/systems-redesign-planning` after each artifact
  group.
- `master` not touched.

## Git Boundary Report

- Branch: `systems-redesign-planning`. Upstream: `origin/systems-redesign-planning`.
- Baseline: `9b9a2431`. Ahead of master: 398. Working tree clean.
- Force-push / branch deletion / history rewrite: forbidden (§19/§18).
- Merge to master: forbidden until consolidation milestone.

## Verification And Bug Prevention Plan

- Iteration 1 = docs only; verification is read-through + internal consistency.
- Iteration 2+: every slice runs `npm run build` + `npm run test:unit`
  + slice-specific tests. Preservation-surface slices also run
  `npm run preserve:slice` per §13a.
- Performance baselines from iteration 1 become regression gates.

## Artifact Locations To Create

| Path | Purpose |
|---|---|
| `docs/research/SYSTEMS_REDESIGN_KICKOFF.md` | This file. |
| `docs/research/agents/*.md` | 9 agent cards. |
| `docs/research/REDESIGN_LOG.md` | Running log (already created). |
| `docs/research/WORKBENCH_CURRENT_CODE_RESEARCH_BRIEF.md` | Current-code research. |
| `docs/research/WORKBENCH_EXTERNAL_ARCHITECTURE_RESEARCH_BRIEF.md` | External research. |
| `docs/research/baselines/workbench-baseline.md` | Baseline scorecard. |
| `docs/architecture/SYSTEM_ATLAS.md` | System atlas. |
| `docs/architecture/WORKBENCH_INTERACTION_MODEL.md` | Interaction model. |
| `docs/archive/milestones/` | Archive directory. |

## Decisions Needed From User

None. The autonomous-iteration contract authorizes iteration 1.
User-reserved items (§18) are not triggered.

## Cleanup Start Phase

C0 + C1 + C2 + C3 run in parallel in iteration 1. C4 (app-system
implementation) begins iteration 2 once the atlas covers the first
chosen subsystem.

## Stop Rules

I stop only on:

- §18 user-reserved decision needed.
- §13a Fitness and Review subagent returns a rollback I cannot resolve.
- Verification fails and cannot be made green in the slice.
- §11 preservation rule would be violated without a net-positive
  replacement.

## Next Action

Write the 9 agent cards in this iteration, then invoke the Explore
subagent for repo discovery, then produce the System Atlas skeleton.
All in this same iteration, no user check-in between artifacts.
