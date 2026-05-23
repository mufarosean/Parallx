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

## 3. Product Identity

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

## 4. Core Product Workflow

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

## 5. Current System Map

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

## 6. Scope

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

## 7. What Working Well Means

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

## 8. Unified Workbench Language

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

## 9. Non-Negotiable Preservation Rules

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

## 10. Definition Of Better

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

## 11. Redesign Operating System

Before redesigning Parallx's app system, design the redesign system itself.

Required roles:

| Role | Purpose | First responsibility |
|---|---|---|
| Systems Redesign Conductor | Holds product goal, redesign goal, scope, branch state, handoffs, proof gates, and final decision. | Produce the kickoff plan. |
| External Architecture Research Agent | Researches successful workbench and extension systems. | Study VS Code-style contribution points, commands, context keys, extension APIs, and comparable mature systems. |
| System Atlas Cartographer | Maps current Parallx behavior with code/doc anchors. | Create the atlas skeleton and first cross-tool workflow map. |
| Baseline and Metrics Agent | Defines measurable current behavior. | Decide which baselines or instrumentation are required before implementation. |
| Unified Workbench Interaction Agent | Defines the shared language between Explorer, editors, Canvas, chat, extensions, commands, tools, IPC, and persistence. | Draft the first interaction model. |
| Surgical Executor Agent | Implements one approved slice only after proof gates are met. | Wait; no execution until conductor approves a slice. |
| Fitness and Review Agent | Independently decides keep, revise, or roll back. | Define review criteria before the first implementation slice. |

Required first artifacts:

- Branch/checkpoint verification.
- Documentation truth plan.
- Milestone triage plan.
- System Atlas skeleton.
- External architecture research brief.
- Unified Workbench Language skeleton.
- Baseline/metrics plan.
- First accepted execution milestone.

---

## 12. Companion Documents

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

## 13. Documentation Truth Model

Docs fall into four buckets:

| Bucket | Meaning | Examples |
|---|---|---|
| Canonical | Current truth users/developers can trust. | User guide, extension authoring guide, MCP server authoring guide, workspace schema, settings registry, canvas structural model, this manifest. |
| Active milestone | The one current execution plan. | A single root milestone file or clearly named active plan. |
| Research/planning | Forward-looking, not source of truth until accepted. | Systems redesign research, agent/skill operating model, cleanup plan. |
| Archive | Historical record only. | Closed milestones, old audits, superseded plans. |

Rule: if a doc is canonical, it must be accurate enough to act on. If it is not accurate, archive it or label it as draft/research.

---

## 14. First Agent Required Output

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

## Research Assignments

## System Atlas Assignments

## Baseline And Metrics Assignments

## Unified Workbench Language Questions

## Documentation And Milestone Cleanup Plan

## First Milestone Recommendation

## Stop Rules

## Next Action
```

The first agent should not produce code changes as its first output.

---

## 15. Near-Term Target

Before any major systems redesign starts, Parallx needs a cleanup baseline:

1. Current app checkpoint exists.
2. Dedicated redesign branch exists.
3. Current milestone docs are labeled by status.
4. Canonical docs are identified.
5. Historical docs are moved to archive, not deleted.
6. The redesign operating model is accepted.
7. A new System Atlas maps the app end to end.
8. A unified workbench language map exists.
9. Baseline measurements exist for startup, IPC, persistence, extensions, canvas, chat participation, and background work.

Only after that should implementation milestones begin.
