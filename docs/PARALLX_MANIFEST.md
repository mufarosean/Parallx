# Parallx Manifest

> Status: Draft baseline manifest for systems redesign
> Created: May 23, 2026
> Purpose: Define what Parallx is today, what "working well" means, what unified workbench behavior must exist, and what must be preserved during cleanup and systems redesign.

---

## 1. Product Identity

Parallx is a local-first, extensible Electron workbench for organizing knowledge, documents, tools, and workspace workflows. It combines a persistent workbench shell, a rich canvas editor, local workspace state, extension-driven tools, MCP integrations, AI-assisted workflows, and durable project memory into one app.

Parallx should feel like one reliable workspace, not a collection of disconnected panels. The user should be able to open a workspace, understand what is available, edit and organize content, use extensions, and return later without losing continuity.

The real unit of success is the end-to-end workflow. A user may open files in Explorer, read or edit them in an editor, ask AI chat about them, and have notes or structured output documented in Canvas. Even when those capabilities are implemented by separate extensions, services, or workbench parts, the app should behave as one coherent system.

---

## 2. Current State

Parallx currently has these major systems:

| System | Current role |
|---|---|
| Workbench shell | Owns startup phases, layout, parts, views, editors, commands, context, and lifecycle. |
| Workspace model | Owns workspace identity, folders, restore/save, recent workspaces, and stale guards. |
| Canvas | Rich page/block editor with structural invariants and registry gates. |
| Persistence | Mix of SQLite, workspace JSON, global/workspace storage, extension DBs, migrations, and `.parallx` files. |
| Extension platform | Manifest-based tools with activation events, contributions, API bridges, settings, and packaging. |
| MCP/tool integrations | External process/tool bridge used by extensions and workspace workflows. |
| IPC layer | Renderer-main bridge for filesystem, database, storage, dialog, shell, terminal, document extraction, secrets, MCP, and lifecycle. |
| UI system | Shared UI primitives, workbench parts, views, editors, status bar, menus, and keybindings. |
| Unified workbench language | Emerging but not fully explicit. Commands, tools, views, links, selections, context, resources, and extension contributions exist, but the redesign must define the central model they all speak. |
| Documentation | User guides, authoring guides, reference docs, research docs, many active-looking milestone docs, and historical archives. |
| Tests/evals | Broad unit tests, e2e tests, eval harnesses, architecture compliance tests, and feature-specific regressions. |

Scope note: AI chat/OpenClaw exists as part of the app, but this systems redesign does not redesign that runtime. AI chat should still participate in the workbench-level contracts as a consumer and producer of resources, commands, tools, context, and artifacts. Its internals remain out of scope unless a future user request explicitly reopens them.

---

## 3. What Working Well Means

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

## 4. Unified Workbench Language

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
5. Any new cross-tool interaction must answer: resource, context, command/tool, capability, event, task, artifact, and test.
6. A redesign that improves one subsystem but weakens cross-tool composition is not better.

---

## 5. Non-Negotiable Preservation Rules

Do not break:

- Existing workspaces.
- Existing cross-tool workflows, including file Explorer to editor to AI chat to Canvas flows.
- Canvas page content and block graph.
- Extension manifests and common extension APIs.
- User settings.
- Keybindings and command IDs unless explicitly migrated.
- Layout restore behavior.
- File and folder behavior.
- Existing documented user workflows.

Any cleanup or redesign must include a rollback path.

---

## 6. Definition of "Better"

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

---

## 7. Redesign System Requirement

Before redesigning Parallx's app system, we must design the redesign system itself.

That means the process needs:

- A conductor/orchestrator that always holds the product goal, redesign goal, exclusions, proof gates, and current branch state.
- A research agent that studies successful workbench and extension systems, especially VS Code-style contribution points, command registries, context keys, extension APIs, and comparable mature app architectures.
- A system atlas agent that maps current Parallx behavior before proposing changes.
- A baseline/metrics agent that defines what "better" means for each flow before implementation.
- A unified workbench interaction agent that defines the common language between Explorer, editors, Canvas, chat, extensions, commands, tools, IPC, and persistence.
- A surgical executor that makes one scoped change only after the design and proof gate are accepted.
- A checker/review agent that independently decides whether the change is safer, faster, easier to debug, less bug-prone, and still compatible.

No implementation milestone should begin until this operating model is accepted and the first target flow has baseline evidence.

---

## 8. Documentation Truth Model

Going forward, docs should fall into one of four buckets:

| Bucket | Meaning | Examples |
|---|---|---|
| Canonical | Current truth users/developers can trust. | User guide, extension authoring guide, MCP server authoring guide, workspace schema, settings registry, canvas structural model, this manifest. |
| Active milestone | The one current execution plan. | A single root milestone file or clearly named active plan. |
| Research/planning | Forward-looking, not source of truth until accepted. | Systems redesign research, agent/skill operating model, cleanup plan. |
| Archive | Historical record only. | Closed milestones, old audits, superseded plans. |

Rule: if a doc is canonical, it must be accurate enough to act on. If it is not accurate, archive it or label it as draft/research.

---

## 9. Near-Term Target

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
