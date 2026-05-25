# Parallx Systems Redesign Manifest

> Status: Draft kickoff manifest for the first redesign agent
> Created: May 23, 2026
> Primary reader: Systems Redesign Conductor
> Purpose: Give the first agent the product goal, operating boundaries, shared workbench language, proof standard, and first required outputs for the Parallx systems redesign.

---

## 0. How To Use This Manifest

This document is the kickoff packet for the first agent. It should be read before any redesign work, code cleanup, documentation cleanup, or subsystem implementation begins.

The first agent is not being asked to redesign the app immediately. The first agent is being asked to coordinate the redesign system:

1. Confirm the product goal.
2. Confirm branch/checkpoint safety.
3. Confirm what is in and out of scope.
4. Assign research, atlas, baseline, interaction-model, execution, and review roles.
5. Produce the first plan of work.
6. Stop before implementation unless the required proof gates are satisfied.

The first agent should treat this manifest as the highest-level product contract for this redesign branch.

When this document says "accepted," it means explicit user approval or an explicit user instruction to continue under the plan. The conductor may recommend acceptance, but it does not silently accept its own kickoff plan.

---

## 1. First Agent Brief

### Role

You are the **Systems Redesign Conductor** for Parallx.

Your job is to keep the whole app in view while coordinating a surgical redesign process. You do not start by changing code. You first design the process that will decide what can safely change.

### Mission

Make Parallx more reliable, coherent, debuggable, performant, and maintainable without losing current functionality.

The redesign is successful only if Parallx becomes a better unified workbench, not merely a cleaner collection of separate features.

### Immediate Objective

Create the first executable redesign plan:

- What must be researched.
- What must be mapped.
- What must be measured.
- Which agents or skills are needed.
- Which documentation cleanup happens first.
- Which app-system changes are explicitly not allowed yet.

### Stop Rule

Stop before implementation if any of these are missing:

- A verified branch/checkpoint state.
- A named target workflow.
- Current-state map with code/doc anchors.
- Baseline or instrumentation plan.
- Preservation checks.
- Rollback rule.
- Independent review gate.

---

## 2. Repository And Branch Contract

At the time this manifest was created:

| Ref | Meaning |
|---|---|
| `master` / `origin/master` | Latest current app state at commit `9b9a243`. |
| `checkpoint-pre-systems-redesign-2026-05-23` | Restore point for the latest current app state at commit `9b9a243`. |
| `systems-redesign-planning` | Dedicated branch for redesign planning and future redesign work. |

Rules:

1. Do not work directly on `master`.
2. Do not delete checkpoint branches.
3. Do not merge redesign work into `master` until a release decision says the branch is measurably better.
4. Treat branch verification as part of the first agent's startup checklist.

---

## 3. Fresh Agent Startup Checklist

A fresh agent should begin with these checks before creating plans or assigning work:

1. Verify branch state:
   - `git status --short --branch`
   - `git rev-parse master origin/master checkpoint-pre-systems-redesign-2026-05-23 systems-redesign-planning`
2. Confirm `master`, `origin/master`, and `checkpoint-pre-systems-redesign-2026-05-23` point to the same current-app baseline commit.
3. Confirm the active branch is `systems-redesign-planning`.
4. Confirm the working tree is clean or report any unexpected local changes before proceeding.
5. Read this manifest first, then the companion docs listed later in this document.
6. Discover available scripts from `package.json`; do not invent test commands.
7. Produce the kickoff report and agent cards before any code or cleanup changes.

If any branch, baseline, or working-tree fact contradicts this manifest, stop and report the contradiction. Do not "fix" Git state silently.

The first agent's kickoff report should be written as a repository artifact at `docs/research/SYSTEMS_REDESIGN_KICKOFF.md` and summarized to the user. If the user explicitly asks for discussion only, return the kickoff report in chat and do not write files.

---

## 4. Product Identity

Parallx is a local-first, extensible Electron workbench for organizing knowledge, documents, tools, and workspace workflows.

It combines:

- Persistent workbench shell.
- File Explorer.
- Editors.
- Canvas.
- Local workspace state.
- Extension-driven tools.
- MCP integrations.
- AI-assisted workflows.
- Durable project memory.

Parallx should feel like one reliable workspace, not a collection of disconnected panels.

The user should be able to open a workspace, understand what is available, edit and organize content, use extensions, use AI-assisted workflows, and return later without losing continuity.

---

## 5. Core Product Workflow

The real unit of success is the end-to-end workflow.

Example target workflow:

1. User opens a workspace.
2. User browses files in Explorer.
3. User opens documents in editors.
4. User asks AI chat about those documents.
5. AI chat references the same workspace resources.
6. User or AI creates notes, summaries, or structured output.
7. Those outputs become Canvas pages, blocks, links, or artifacts.
8. The user can reopen the workspace later and continue.

This workflow crosses multiple features, extensions, services, and storage layers. It must still feel like one app.

The redesign must protect and improve this kind of workflow.

---

## 6. Current System Map

Parallx currently has these major systems:

| System | Current role |
|---|---|
| Workbench shell | Owns startup phases, layout, parts, views, editors, commands, context, and lifecycle. |
| Workspace model | Owns workspace identity, folders, restore/save, recent workspaces, and stale guards. |
| Explorer | Presents workspace files and entry points into file/resource workflows. |
| Editors | Present and edit documents, PDFs, EPUBs, and other file-backed or resource-backed content. |
| Canvas | Rich page/block editor with structural invariants and registry gates. |
| AI chat | Participates in workspace workflows as a consumer and producer of context, resources, tools, and artifacts. Its internals are not redesigned in this effort. |
| Persistence | Mix of SQLite, workspace JSON, global/workspace storage, extension DBs, migrations, and `.parallx` files. |
| Extension platform | Manifest-based tools with activation events, contributions, API bridges, settings, and packaging. |
| MCP/tool integrations | External process/tool bridge used by extensions and workspace workflows. |
| IPC layer | Renderer-main bridge for filesystem, database, storage, dialog, shell, terminal, document extraction, secrets, MCP, and lifecycle. |
| UI system | Shared UI primitives, workbench parts, views, editors, status bar, menus, and keybindings. |
| Unified workbench language | Emerging but not fully explicit. Commands, tools, views, links, selections, context, resources, and extension contributions exist, but the redesign must define the central model they all speak. |
| Documentation | User guides, authoring guides, reference docs, research docs, active-looking milestone docs, and historical archives. |
| Tests/evals | Unit tests, e2e tests, eval harnesses, architecture compliance tests, and feature-specific regressions. |

---

## 7. Repository Discovery Directive

The manifest does not define the repository structure as architecture truth. The first agent must inspect the repo before making claims about ownership, flow, or boundaries.

Required first-pass discovery:

1. List top-level directories.
2. Read `package.json` scripts.
3. Locate workbench, built-in features, extension APIs, extensions, Electron main/preload code, tests, and docs.
4. Identify likely entry points for the target workflow.
5. Write down uncertainty instead of guessing.

Suggested discovery commands:

```bash
rg --files
rg -n "class Workbench|new Workbench|registerCommand|contributes|activation|ipcMain.handle|ipcRenderer.invoke|createEditor|openEditor|canvas|chat|explorer" src electron ext tests docs
```

The System Atlas must replace this rough discovery with verified code/doc anchors.

---

## 8. Scope

### In Scope

- Workbench-level architecture.
- Cross-tool interaction model.
- Documentation truth and milestone cleanup.
- System Atlas.
- Startup/lifecycle readiness.
- Persistence ownership.
- IPC contracts.
- Extension contribution and capability model.
- Canvas participation in shared workbench workflows.
- AI chat participation in shared workbench workflows.
- Background work, tasks, cancellation, and workspace fences.
- Metrics, diagnostics, tests, and fitness gates.

### Out Of Scope

- Rewriting the app from scratch.
- Redesigning AI chat internals.
- Redesigning OpenClaw internals.
- Replacing Claude/OpenClaw behavior.
- Breaking extension APIs without an explicit migration plan.
- Removing existing workflows because they are inconvenient to redesign.
- Large refactors before the System Atlas and baseline exist.

---

## 9. What Working Well Means

Parallx works well when its parts compose into reliable cross-tool workflows:

- File Explorer, editors, AI chat, Canvas, extensions, commands, storage, and background work share a common workbench language.
- A resource selected in Explorer can be opened, edited, referenced by AI chat, linked, transformed, and documented in Canvas without every feature inventing its own integration path.
- Commands, tools, views, editors, menus, context, and keybindings are contributed through central workbench contracts instead of hidden one-off wiring.
- Extension and built-in features can ask "what is the active workspace, active resource, active selection, active surface, available commands, and allowed capabilities?" through shared APIs.
- IPC and extension APIs expose typed workbench contracts, not ad hoc escape hatches that only one feature understands.
- Results and artifacts have enough identity and provenance to move across surfaces.
- Local feature implementations can specialize, but they translate to common workbench concepts at their boundaries.
- Cross-tool workflows are tested as workflows, not only as isolated feature behavior.

Parallx also works well when:

- Startup reaches an interactive shell quickly and visibly.
- Workspace restore is deterministic and recoverable.
- Canvas content survives edit, drag/drop, save, reopen, migration, and workspace switch.
- Extensions activate safely, fail in isolation, and cannot silently break core workbench behavior.
- IPC contracts are typed, observable, and bounded by clear ownership.
- Durable state has canonical owners and clear recovery rules.
- Background work never makes foreground editing feel stuck.
- Documentation tells a coherent story and separates canonical truth from historical notes.
- Milestones represent real status: planned, active, partial, implemented, superseded, or archived.
- Redesigns are proven better with before/after evidence, not judged by architectural taste.

---

## 10. Unified Workbench Language

The systems redesign must define a central language for inter-tool interaction. This is the layer that lets separate features behave like one app.

### Core Concepts

| Concept | Meaning |
|---|---|
| Workspace | The active project boundary, including folders, durable state, settings, and background work fences. |
| Resource | A stable identity for a file, page, canvas block, generated artifact, web result, database record, or external tool output. |
| Surface | A visible place where work happens: Explorer, editor, Canvas, chat, panel, sidebar, modal, or extension view. |
| Selection | The current focused thing or range: file, text, block, page, resource, search result, or structured item. |
| Context | The facts that make commands and tools relevant: workspace, active surface, selected resource, permissions, extension state, and user intent. |
| Command | A named user or system action with predictable availability, arguments, result shape, and keybinding/menu contribution rules. |
| Tool | A callable capability used by built-in features, extensions, MCP, or AI-assisted workflows. Tools should map to workbench resources, commands, context, and permissions. |
| Contribution | A declarative extension or built-in addition to commands, views, menus, tools, settings, keybindings, schemas, or surfaces. |
| Capability | A permission-like declaration for privileged behavior such as filesystem, shell, network, secrets, database, AI, or external process access. |
| Event | A typed notification that something changed: workspace, resource, selection, command, job, editor, canvas structure, extension state. |
| Task | A foreground or background unit of work with identity, priority, workspace ownership, cancellation, timeout, retry, and result behavior. |
| Artifact | A durable or temporary output that can be opened, linked, inserted, saved, or referenced later. |
| Provenance | The source trail for a resource or artifact: where it came from, which tool or command created it, and which workspace/user action it belongs to. |

### Universal Workbench Services

These services should sit above individual features:

| Service | Workbench responsibility |
|---|---|
| Command registry | Register, discover, invoke, keybind, and menu-enable commands. |
| Contribution registry | Load built-in and extension contributions through a consistent manifest model. |
| Context and selection service | Provide shared active context across Explorer, editor, Canvas, chat, and extensions. |
| Resource and link resolver | Resolve files, pages, blocks, artifacts, and external records through stable IDs/URIs. |
| Tool registry | Register tools with schemas, capabilities, ownership, availability, and result contracts. |
| Task/job service | Run background and foreground work with workspace fences, cancellation, priority, and observability. |
| Extension API bridge | Let extensions contribute and consume workbench primitives through stable contracts. |
| IPC contract layer | Expose main-process capabilities through typed, bounded, observable APIs. |
| Capability service | Check whether built-ins, extensions, tools, and workflows may perform privileged actions. |
| Event bus | Publish typed domain events without coupling every feature directly to every other feature. |
| Persistence ownership registry | Define which system owns each durable state domain and which stores are derived/cache. |
| Status and notification service | Surface progress, failures, warnings, and recoverable actions in one user-facing language. |
| Trace/diagnostic service | Correlate actions across surfaces so a cross-tool workflow can be debugged end to end. |

### Interaction Rules

1. Workbench owns universal concepts. Features own domain behavior.
2. Extensions contribute to the workbench through manifests, registries, and APIs, not by patching unrelated systems.
3. IPC exposes contracts for workbench concepts and privileged operations, not private shortcuts for single features.
4. Feature-specific state may exist, but cross-feature state must have a canonical owner.
5. Any new cross-tool interaction must answer: resource, context, command/tool, capability, event, task, artifact, provenance, and test.
6. A redesign that improves one subsystem but weakens cross-tool composition is not better.

---

## 11. Non-Negotiable Preservation Rules

Do not break:

- Existing workspaces.
- Existing cross-tool workflows, including Explorer to editor to AI chat to Canvas flows.
- Canvas page content and block graph.
- Extension manifests and common extension APIs.
- User settings.
- Keybindings and command IDs unless explicitly migrated.
- Layout restore behavior.
- File and folder behavior.
- Existing documented user workflows.

Any cleanup or redesign must include a rollback path.

---

## 12. Definition Of Better

A redesign is better only if it improves one or more of these without regressing preservation rules:

| Dimension | Example proof |
|---|---|
| Composability | Fewer one-off bridges, clearer shared workbench primitives, and cross-tool workflow tests passing. |
| Debuggability | Clear owner, fewer files to trace, better logs/metrics, stronger error shape, correlated traces across surfaces. |
| Startup performance | Lower time to interactive, fewer blocking tasks, fewer startup IPC calls. |
| Runtime performance | Fewer renderer long tasks, lower DB/query pressure, smoother foreground interaction. |
| Reliability | Fewer bug classes, better invariants, safer failure containment. |
| Recovery | Interrupted save/switch/startup restores to a consistent state. |
| Maintainability | Smaller contracts, fewer illegal imports, less duplicated state ownership. |
| User clarity | Docs and UI match what the app actually does. |

Every redesign claim must state:

- Current behavior.
- Proposed intervention.
- Why it is better.
- Baseline evidence or missing instrumentation.
- Preservation checks.
- Tests.
- Rollback or stop condition.

---

## 13. Redesign Operating System

Before redesigning Parallx's app system, design the redesign system itself.

### Required Agents

The conductor must create or assign these agents before the first implementation milestone:

| Agent | Purpose | Can edit app code? | Constraints | Required output |
|---|---|---:|---|---|
| Systems Redesign Conductor | Holds product goal, redesign goal, scope, branch state, handoffs, proof gates, and final decision. | No by default | Cannot approve implementation without research, atlas, baseline, preservation, and review gates. | Kickoff plan and milestone recommendation. |
| Research Agent | Researches current Parallx code and external successful app/workbench patterns. | No | Must separate current-code facts from external patterns and recommendations. Must cite code/docs/sources. | Research brief with Parallx findings, external findings, applicability, and risks. |
| System Atlas Cartographer | Maps current Parallx behavior with code/doc anchors. | Docs only | Cannot propose redesign before mapping entry points, state owners, events, IPC, storage, and tests. | System Atlas section and cross-tool workflow map. |
| Baseline and Metrics Agent | Defines measurable current behavior. | No | Cannot accept "better" without baseline, characterization test, or instrumentation plan. | Baseline scorecard and missing measurement list. |
| Unified Workbench Interaction Agent | Defines the shared language between Explorer, editors, Canvas, chat, extensions, commands, tools, IPC, and persistence. | Docs/design first | Cannot create a new abstraction without proving current one-off bridges and compatibility needs. | Workbench interaction model and compatibility plan. |
| Milestone and Documentation Steward | Creates milestone docs, labels old milestones, updates README, and preserves archive history. | Docs only | Cannot delete history. Must archive or label stale docs. Must keep canonical docs discoverable. | Milestone doc, doc triage table, README/index updates. |
| Git and Release Steward | Maintains branch discipline, linearity, commit boundaries, and release/rollback records. | No app code | Cannot rewrite history, delete branches, or update `master` without explicit user approval. | Branch graph report, commit plan, merge/rollback recommendation. |
| Surgical Executor Agent | Implements one approved slice only after proof gates are met. | Yes | Cannot expand scope, refactor opportunistically, or commit without verification notes. | Patch, tests, verification record, rollback notes. |
| Fitness and Review Agent | Independently decides keep, revise, or roll back. | No by default | Cannot be the same agent that implemented the slice. Must look for regressions across workflows. | Keep/revise/rollback decision with evidence. |

### Agent Card Template

Before an agent starts work, the conductor must create a short agent card:

```md
## Agent

Name:
Mission:
Inputs:
Allowed edits:
Forbidden actions:
Required sources:
Required output:
Verification required:
Stop rules:
Handoff target:
```

### Agent Creation Semantics

"Create an agent" means:

1. Create an agent card artifact that defines the role, inputs, outputs, constraints, stop rules, and handoff target.
2. In GitHub Copilot Chat or any environment that supports agents/subagents, instantiate or invoke the specialist agent using the agent card as its instruction.
3. Require the specialist agent to produce its own named output artifact before the conductor moves to the next handoff.

The conductor must not pretend to be every specialist agent. Its job is to create agents, assign work, read their outputs, resolve conflicts, and decide the next handoff.

If the environment cannot create or invoke specialist agents, the conductor must stop and report that the process cannot run as designed. The conductor may proceed in degraded single-agent mode only after explicit user approval for that mode. Degraded mode must be labeled in the kickoff report and cannot proceed to app-code implementation.

Agent cards are required either way.

Required first artifacts:

- Branch/checkpoint verification.
- Documentation truth plan.
- Milestone triage plan.
- System Atlas skeleton.
- Research brief covering current Parallx code and external successful apps.
- Unified Workbench Language skeleton.
- Baseline/metrics plan.
- Branch graph and commit discipline plan.
- First accepted execution milestone.

### Artifact Locations

Use these default locations unless the conductor accepts a better one:

| Artifact | Default location |
|---|---|
| Kickoff report | `docs/research/SYSTEMS_REDESIGN_KICKOFF.md` |
| Agent cards | `docs/research/agents/<agent-name>.md` |
| System Atlas | `docs/architecture/SYSTEM_ATLAS.md` |
| Unified Workbench Language model | `docs/architecture/WORKBENCH_INTERACTION_MODEL.md` |
| Research briefs | `docs/research/<topic>_RESEARCH_BRIEF.md` |
| Baseline scorecards | `docs/research/baselines/<workflow>-baseline.md` |
| Branch/commit governance notes | `docs/research/git/BRANCH_GOVERNANCE.md` |
| Active milestone | `docs/Parallx_Milestone_<number>.md` |
| Historical milestone archive | `docs/archive/milestones/` |

If a directory does not exist yet, the first milestone should create it intentionally, not as a side effect of unrelated work.

Minimum first-generation agent cards:

- `docs/research/agents/systems-redesign-conductor.md`
- `docs/research/agents/git-and-release-steward.md`
- `docs/research/agents/research-agent.md`
- `docs/research/agents/system-atlas-cartographer.md`
- `docs/research/agents/baseline-and-metrics-agent.md`
- `docs/research/agents/unified-workbench-interaction-agent.md`
- `docs/research/agents/milestone-and-documentation-steward.md`
- `docs/research/agents/fitness-and-review-agent.md`
- `docs/research/agents/surgical-executor-agent.md`

The Surgical Executor card may remain inactive until an implementation slice is approved.

---

## 13a. Conductor Self-Substitution Prohibition

§13 and §14 imply this, but a previous slice (`7dca7c0e`, reverted in `68635c07`) shipped a regression because the conductor agent acted as Surgical Executor and Fitness and Review Agent in the same session. This section makes the rule explicit and enforceable.

Rules:

1. For any slice that touches a preservation surface listed in §11 or in `/memories/repo/orchestrator-discipline.md` (notably `src/built-in/*/main.ts`, `electron/**`, `src/openclaw/**`, `src/services/chatAgentService.ts`, `src/contributions/**`, `src/links/linkResolverService.ts`, and the canvas data/persistence/registry files), the conductor MUST invoke a separate subagent as Surgical Executor and a different subagent as Fitness and Review Agent. The conductor MUST NOT author the executor's diff and the reviewer's decision in the same agent session.
2. "Audit", "reality check", and "status" commits MUST include cited file:line diffs against current source for every claim they make. Narrative summaries without citations are forbidden. (Manifest §15.)
3. Closing a slice that touches a preservation surface requires `npm run preserve:slice` to be green on the slice's HEAD. Unit-green alone is NOT closure. The executable gate writes `.slice-closure-ok` and `.slice-closure/last-run.json`.
4. `scripts/check-slice-closure.mjs` must print `OK TO COMMIT` before any commit that touches a preservation surface. It verifies the receipt is fresh, an agent card path is supplied, and a Fitness and Review artifact path is supplied.
5. If the environment cannot invoke subagents, the conductor MUST stop and ask the user. Degraded single-agent mode is allowed only with explicit user approval and must be labeled in the commit message body (`degraded-mode: <reason>`).
6. A bug reaching the user after a slice closure is process failure by definition (§22). The next slice MUST add the gate that would have caught it.

---

## 14. Agent Creation And Sequential Handoffs

The first conductor must create the first generation of agent cards before assigning work.

Required initial sequence for workbench redesign:

| Step | Owner | Input | Output | Handoff to |
|---|---|---|---|---|
| 1. Branch and governance check | Git and Release Steward | Current refs, working tree, manifest | Branch graph report and commit rules | Conductor |
| 2. Repo discovery | Research Agent | Repo files, package scripts, docs | Repo discovery notes and open questions | System Atlas Cartographer |
| 3. Current workbench atlas | System Atlas Cartographer | Discovery notes, source code, docs | Workbench flow map with anchors | Research Agent, Baseline Agent |
| 4. External architecture research | Research Agent | Design questions from atlas | Source-backed external pattern brief | Unified Workbench Interaction Agent |
| 5. Baseline planning | Baseline and Metrics Agent | Target workflow, atlas, tests | Baseline scorecard or instrumentation plan | Conductor |
| 6. Workbench interaction model | Unified Workbench Interaction Agent | Atlas, external research, baseline plan | Proposed shared language and compatibility plan | Fitness and Review Agent |
| 7. Milestone creation | Milestone and Documentation Steward | Accepted conductor plan | Active milestone with agents, slices, verification, commits, rollback | Conductor |
| 8. Implementation slice | Surgical Executor Agent | Accepted milestone slice | Patch, tests, verification notes | Fitness and Review Agent |
| 9. Independent review | Fitness and Review Agent | Patch, tests, baseline, preservation rules | Keep/revise/rollback decision | Conductor |
| 10. Commit/release bookkeeping | Git and Release Steward | Accepted result and review | Commit/branch status and rollback notes | Conductor |

Rules:

1. Steps 1-7 happen before app code changes.
2. Only the conductor can move a slice from design to execution.
3. The executor receives one accepted slice, not an open-ended subsystem.
4. The reviewer receives the final diff and evidence, not just the executor's summary.
5. The Git and Release Steward verifies linearity after each commit and before any merge recommendation.
6. Each handoff requires a named input artifact and a named output artifact.
7. The conductor cannot substitute its own analysis for a required specialist artifact.
8. If a specialist output is missing, incomplete, or self-contradictory, the conductor sends it back to that specialist or asks the user for direction.

### Handoff Artifact Rules

Every agent handoff must include:

- Source agent.
- Target agent.
- Input artifact path.
- Required output artifact path.
- Questions to answer.
- Stop conditions.
- Verification expected.

Minimum handoff artifacts for the first run:

| Handoff | Required output artifact |
|---|---|
| Git Steward to Conductor | `docs/research/git/BRANCH_GOVERNANCE.md` |
| Research Agent to Atlas | `docs/research/WORKBENCH_CURRENT_CODE_RESEARCH_BRIEF.md` |
| Atlas to Research/Baseline | `docs/architecture/SYSTEM_ATLAS.md` |
| Research Agent to Workbench Interaction | `docs/research/WORKBENCH_EXTERNAL_ARCHITECTURE_RESEARCH_BRIEF.md` |
| Baseline Agent to Conductor | `docs/research/baselines/workbench-baseline.md` |
| Workbench Interaction Agent to Review | `docs/architecture/WORKBENCH_INTERACTION_MODEL.md` |
| Fitness and Review Agent to Conductor | `docs/research/WORKBENCH_INTERACTION_MODEL_REVIEW.md` |
| Milestone Steward to Conductor | `docs/Parallx_Milestone_81.md` or the accepted active milestone filename |

---

## 15. Research Protocol

Research has two mandatory tracks.

### Current Parallx Research

The Research Agent and System Atlas Cartographer must inspect the current app before proposing changes.

Minimum local research:

- Identify entry points for the target workflow.
- Trace how Explorer, editor, AI chat, Canvas, extensions, tools, IPC, persistence, and background work interact today.
- Find the command, contribution, context, selection, resource, and tool primitives that already exist.
- Identify duplicated concepts, one-off bridges, hidden coupling, and unclear ownership.
- Locate tests/evals that already protect the workflow.
- Mark unverified assumptions explicitly.

Required evidence:

- Code file anchors.
- Existing docs.
- Existing tests or missing-test notes.
- Current behavior summary.

### External Architecture Research

The Research Agent must also study successful apps and mature workbench/plugin systems before recommending a new Parallx-level model.

Minimum external research:

- VS Code contribution points, commands, context keys, menus/views, extension APIs, activation, and extension host boundaries.
- At least one comparable mature plugin/workbench architecture, such as Eclipse extension points or JetBrains IntelliJ Platform extension/action systems.
- Optional domain-specific apps only when they illuminate the target Parallx workflow.

Required evidence:

- Source links.
- Pattern summary.
- What Parallx should learn.
- What Parallx should not copy.
- Risks of overengineering.

The Research Agent must never return a recommendation that is only external best practice. It must connect each recommendation to current Parallx code and a user workflow.

---

## 16. Work Definition Contract

All work must be defined as a flow, not as a vague subsystem preference.

Every work item must include:

| Field | Required answer |
|---|---|
| User workflow | What user-visible workflow are we protecting or improving? |
| Current behavior | How does it work today? |
| Pain or risk | What is fragile, slow, hard to debug, duplicated, or bug-prone? |
| Workbench concepts | Which shared concepts are involved? |
| Scope | Which files/systems may be touched? |
| Out of scope | Which systems must not be redesigned in this slice? |
| Baseline | What current metric, test, trace, or characterization exists? |
| Better claim | What must improve? |
| Preservation checks | What must keep working? |
| Verification | Which tests, inspections, or measurements prove it? |
| Rollback | How do we return to the prior behavior? |

No implementation starts from "clean this area up." It starts from a mapped workflow and a measurable claim.

---

## 17. Milestone Document Lifecycle

Milestones are the control surface for the redesign.

### Creation

The Milestone and Documentation Steward creates a milestone document only after the conductor accepts a workflow, scope, proof gate, and rollback rule.

New redesign milestones should use this shape:

```md
# Parallx Milestone <number>: <title>

Status:
Branch:
Parent baseline:
Created:
Conductor:

## Goal

## User Workflows Protected

## Scope

## Out Of Scope

## Agents Assigned

## Current-State Research Required

## External Research Required

## Baseline And Metrics Required

## Workbench Concepts Involved

## Implementation Slices

## Verification Plan

## Preservation Checklist

## Commit Plan

## Rollback Plan

## Closeout Evidence
```

### Status Labels

Use these labels:

- `planning`
- `active`
- `partial`
- `implemented-unverified`
- `implemented-verified`
- `superseded`
- `archived`

### Closeout

A milestone can close only when:

- The implementation matches the accepted scope.
- The verification plan has run or has documented blockers.
- The Fitness and Review Agent has returned keep/revise/rollback.
- Docs affected by the change are updated.
- Known risks are listed.
- Rollback path is still valid.

---

## 18. Decision Rights And Escalation

The process must not blur who is allowed to decide what.

| Decision | Owner |
|---|---|
| Product direction, scope expansion, and tradeoffs that affect user workflows | User |
| Whether redesign work may merge to `master` | User after consolidation evidence |
| Whether to break or migrate extension APIs | User plus conductor after compatibility plan |
| Whether to delete historical docs | Not allowed by default; archive instead |
| Agent assignment and handoff order | Systems Redesign Conductor |
| Whether a slice is ready for implementation | Systems Redesign Conductor after research, atlas, baseline, and preservation gates |
| Implementation details inside an accepted slice | Surgical Executor Agent |
| Keep, revise, or roll back recommendation | Fitness and Review Agent |
| Branch linearity, commit hygiene, merge readiness, and rollback notes | Git and Release Steward |

Ask the user before:

- Changing `master`.
- Deleting files instead of archiving them.
- Breaking existing extension APIs, command IDs, settings, keybindings, workspace schemas, or saved data.
- Expanding a milestone beyond its accepted scope.
- Accepting a regression as a tradeoff.

---

## 19. Git Boundary System

The Git boundary system exists so the redesign stays reversible and understandable.

The Git and Release Steward must maintain:

- Current branch.
- Upstream branch.
- Baseline commit.
- Branch graph.
- Ahead/behind counts.
- Changed-file list against `master`.
- Commit sequence and purpose.
- Rollback path.
- Merge-readiness state.

Required checks:

```bash
git status --short --branch
git log --oneline --decorate -8
git rev-list --left-right --count master...HEAD
git diff --name-status master..HEAD
```

Rules:

1. Keep redesign work on `systems-redesign-planning` or a dedicated child branch.
2. Keep commits focused by artifact or implementation slice.
3. Do not mix docs cleanup, system atlas, app code, and test harness changes in one commit unless the milestone explicitly requires it.
4. Do not rewrite history without explicit user approval.
5. Do not delete or move checkpoint branches.
6. Do not update `master` without explicit user approval.
7. Do not claim branch linearity without checking local and remote refs.
8. Every implementation slice must include a rollback note.

---

## 20. Commit Authority Protocol

Commit authority must be explicit.

| Work type | Who prepares it | Who may commit it | Required before commit |
|---|---|---|---|
| Manifest/research/planning docs | Conductor or Milestone Steward | Conductor or Milestone Steward | Link check, status clarity, no false source-of-truth claims. |
| System Atlas/docs updates | System Atlas Cartographer | Conductor or Milestone Steward | Code/doc anchors and uncertainty markers. |
| Branch governance notes | Git and Release Steward | Git and Release Steward or Conductor | Branch graph report and no unexpected changes. |
| App code slice | Surgical Executor Agent | Surgical Executor Agent after conductor approval | Accepted milestone slice, tests/verification, rollback notes. |
| Test/fitness harness | Baseline Agent or Surgical Executor | Surgical Executor after conductor approval | Baseline intent and preservation checks. |
| Review fixes | Surgical Executor | Surgical Executor after review decision | Fitness and Review Agent findings addressed. |

Rules:

1. Checker/review agents do not commit implementation work.
2. Research agents do not commit app code.
3. The executor commits only the accepted slice.
4. One commit should have one clear purpose.
5. Commit messages should name the domain and intent, for example `docs: add workbench interaction model` or `test: characterize workspace switch recovery`.
6. Do not merge to `master` until the consolidation milestone says the branch is measurably better.

---

## 21. Workbench Redesign Runbook

When the first target is "update the workbench based on what we now know about extension usage," run the full process in order:

1. Git and Release Steward verifies branch safety.
2. Research Agent discovers how built-ins and extensions currently use the workbench.
3. System Atlas Cartographer maps workbench entry points, services, commands, contributions, context, extension APIs, IPC, persistence, and tests.
4. Research Agent compares those findings against VS Code and other successful workbench/plugin systems.
5. Baseline and Metrics Agent identifies current tests and missing instrumentation for workbench startup, extension activation, command invocation, editor/canvas/chat workflow, and workspace restore.
6. Unified Workbench Interaction Agent proposes a workbench interaction model that preserves existing behavior and names migration paths.
7. Fitness and Review Agent reviews the proposed model before implementation.
8. Milestone and Documentation Steward creates the active workbench redesign milestone.
9. Surgical Executor implements only the first accepted workbench slice.
10. Fitness and Review Agent checks the diff, tests, preservation, and overengineering risk.
11. Git and Release Steward records branch/commit state and rollback.
12. Conductor decides keep, revise, stop, or continue to next slice.

No workbench implementation starts until steps 1-8 are complete.

---

## 22. Verification And Bug Prevention Contract

We cannot rely on users to identify bugs. The redesign process must catch regressions before users experience them.

Every implementation slice must include at least one of:

- Existing test run that covers the workflow.
- New characterization test.
- New regression test.
- New fitness check.
- New instrumentation that establishes a baseline before changing behavior.
- Manual verification script with exact steps only when automation is not yet feasible.

Required verification categories:

| Category | What must be checked |
|---|---|
| Workflow preservation | The core user workflow still works end to end. |
| Data preservation | Existing workspaces, files, settings, canvas content, and extension data survive. |
| Cross-tool interaction | Explorer, editor, AI chat, Canvas, commands, tools, IPC, and persistence still agree on resource/context behavior. |
| Failure behavior | Slow, failed, or missing extensions/tools do not break the workbench. |
| Performance | Startup or runtime behavior does not regress without explicit acceptance. |
| Recovery | Workspace switch, save, crash/interruption, and retry behavior stay consistent. |
| Debuggability | Logs, errors, traces, or ownership are clearer than before. |

If a bug is found by a user after a redesign slice, the process failed. The next milestone must add a test, trace, or guard that would have caught that bug.

### Available Verification Commands

The first agent must verify these commands from `package.json` before using them:

| Command | Purpose |
|---|---|
| `npm run build` | Type-check and build renderer output. |
| `npm run test:unit` | Run all Vitest unit tests (tier-0 + tier-1). |
| `npm run test:unit:tier0` | Run M86-W5 tier-0 tests only (pure-Node, no jsdom). Add tests here when they have no DOM, IPC, or filesystem dependencies. Selected by `tests/unit/platform/**` or `*.tier0.test.ts`. |
| `npm run test:unit:tier1` | Run remaining unit tests (jsdom + IPC mocks). This is the historic `test:unit` behavior. |
| `npm run test:e2e` | Run Playwright e2e tests. |
| `npm run test:ai-eval` | Run AI-eval Playwright scenarios when a milestone explicitly requires them. |
| `npm run dev` | Build and launch the Electron app for manual verification. |

Do not claim runtime quality from documentation changes alone. For implementation milestones, verification must be tied to the accepted workflow and risk level.

---

## 23. Companion Documents

The first agent should use these documents as supporting context:

| Document | Use |
|---|---|
| [docs/README.md](./README.md) | Current documentation index and documentation rules. |
| [docs/research/SYSTEMS_THINKING_FOR_PARALLX.md](./research/SYSTEMS_THINKING_FOR_PARALLX.md) | Systems-thinking research and Parallx application. |
| [docs/research/SYSTEMS_REDESIGN_AGENTS_AND_SKILLS.md](./research/SYSTEMS_REDESIGN_AGENTS_AND_SKILLS.md) | Agent roster, prompts, skills, and operating model. |
| [docs/research/SYSTEMS_REDESIGN_CLEANUP_AND_MILESTONES.md](./research/SYSTEMS_REDESIGN_CLEANUP_AND_MILESTONES.md) | Cleanup strategy, milestone labels, and proposed redesign milestones. |
| [docs/USER_GUIDE.md](./USER_GUIDE.md) | Current user-facing behavior to preserve. |
| [docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md](./PARALLX_EXTENSION_AUTHORING_FOR_AI.md) | Current extension authoring model. |
| [docs/PARALLX_MCP_SERVER_AUTHORING_FOR_AI.md](./PARALLX_MCP_SERVER_AUTHORING_FOR_AI.md) | Current MCP server authoring model. |
| [docs/PARALLX_WORKSPACE_SCHEMA.md](./PARALLX_WORKSPACE_SCHEMA.md) | Workspace state model. |
| [docs/SETTINGS_REGISTRY.md](./SETTINGS_REGISTRY.md) | Settings ownership and registry context. |

---

## 24. Documentation Truth Model

Docs fall into four buckets:

| Bucket | Meaning | Examples |
|---|---|---|
| Canonical | Current truth users/developers can trust. | User guide, extension authoring guide, MCP server authoring guide, workspace schema, settings registry, canvas structural model, this manifest. |
| Active milestone | The one current execution plan. | A single root milestone file or clearly named active plan. |
| Research/planning | Forward-looking, not source of truth until accepted. | Systems redesign research, agent/skill operating model, cleanup plan. |
| Archive | Historical record only. | Closed milestones, old audits, superseded plans. |

Rule: if a doc is canonical, it must be accurate enough to act on. If it is not accurate, archive it or label it as draft/research.

---

## 25. Cleanup Start Schedule

Cleanup is scheduled in phases:

| Phase | Starts when | What starts |
|---|---|---|
| C0: Planning cleanup | After the first kickoff report is accepted | In-place labels, agent cards, milestone template, README truth notes, artifact directories. |
| C1: Documentation truth cleanup | After labels/archive rules/README shape are accepted | Archive moves, canonical/research/archive status updates, README rewrite. |
| C2: System atlas cleanup | After C1 and repo discovery | System Atlas, ownership maps, workflow maps, duplicate-contract inventory. |
| C3: Baseline/fitness cleanup | After target workflows are mapped | Characterization tests, missing instrumentation notes, baseline scorecards. |
| C4: App-system cleanup | After atlas, baseline, workbench language, active milestone, and review gates pass | One accepted implementation slice at a time. |

So the first cleanup to start is **planning cleanup**, not app cleanup. App-system cleanup does not start until C4.

The first scheduled cleanup milestone is `M81 / SR-1: Checkpoint, Manifest, Redesign System, and Documentation Triage`. It begins at C0 only after the kickoff report is accepted.

---

## 26. First Agent Required Output

The first agent should return a kickoff report in this shape:

```md
# Parallx Systems Redesign Kickoff

## Product Goal

## Current Branch State

## In Scope

## Out Of Scope

## Primary End-To-End Workflow

## Risks If We Start Too Locally

## Agents Needed First

## Agent Cards To Create

## Sequential Handoff Plan

## Research Assignments

## System Atlas Assignments

## Baseline And Metrics Assignments

## Unified Workbench Language Questions

## Documentation And Milestone Cleanup Plan

## Commit And Branch Plan

## Git Boundary Report

## Verification And Bug Prevention Plan

## Artifact Locations To Create

## Decisions Needed From User

## Cleanup Start Phase

## Stop Rules

## Next Action
```

The first agent should not produce code changes as its first output.

Kickoff done means:

- `docs/research/SYSTEMS_REDESIGN_KICKOFF.md` exists or the user explicitly requested chat-only output.
- Required first-generation agent cards exist or are included in the kickoff report for user approval.
- Git boundary report is included.
- Cleanup start phase is named.
- Decisions needed from the user are listed.
- No app code has changed.

---

## 27. Near-Term Target

Before any major systems redesign starts, Parallx needs a cleanup baseline:

1. Current app checkpoint exists.
2. Dedicated redesign branch exists.
3. Current milestone docs are labeled by status.
4. Canonical docs are identified.
5. Historical docs are moved to archive, not deleted.
6. The redesign operating model is accepted.
7. A new System Atlas maps the app end to end.
8. A unified workbench language map exists.
9. Git boundary system is documented and active.
10. Milestone docs define accepted work, agents, handoffs, commit plan, verification plan, and rollback plan.
11. Baseline measurements exist for startup, IPC, persistence, extensions, canvas, chat participation, and background work.

Only after that should implementation milestones begin.
