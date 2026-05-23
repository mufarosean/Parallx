# Parallx Manifest

> Status: Draft baseline manifest for systems redesign
> Created: May 23, 2026
> Purpose: Define what Parallx is today, what "working well" means, and what must be preserved during cleanup and systems redesign.

---

## 1. Product Identity

Parallx is a local-first, extensible Electron workbench for organizing knowledge, documents, tools, and workspace workflows. It combines a persistent workbench shell, a rich canvas editor, local workspace state, extension-driven tools, MCP integrations, and durable project memory into one app.

Parallx should feel like a reliable workspace, not a collection of disconnected panels. The user should be able to open a workspace, understand what is available, edit and organize content, use extensions, and return later without losing continuity.

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
| Documentation | User guides, authoring guides, reference docs, research docs, many active-looking milestone docs, and historical archives. |
| Tests/evals | Broad unit tests, e2e tests, eval harnesses, architecture compliance tests, and feature-specific regressions. |

Scope note: AI chat/OpenClaw exists as part of the app, but this systems redesign does not redesign that runtime. It should be treated as an existing subsystem with its own architecture unless a future user request explicitly reopens it.

---

## 3. What Working Well Means

Parallx works well when:

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

## 4. Non-Negotiable Preservation Rules

Do not break:

- Existing workspaces.
- Canvas page content and block graph.
- Extension manifests and common extension APIs.
- User settings.
- Keybindings and command IDs unless explicitly migrated.
- Layout restore behavior.
- File and folder behavior.
- Existing documented user workflows.

Any cleanup or redesign must include a rollback path.

---

## 5. Definition of "Better"

A redesign is better only if it improves one or more of these without regressing preservation rules:

| Dimension | Example proof |
|---|---|
| Debuggability | Clear owner, fewer files to trace, better logs/metrics, stronger error shape. |
| Startup performance | Lower time to interactive, fewer blocking tasks, fewer startup IPC calls. |
| Runtime performance | Fewer renderer long tasks, lower DB/query pressure, smoother foreground interaction. |
| Reliability | Fewer bug classes, better invariants, safer failure containment. |
| Recovery | Interrupted save/switch/startup restores to a consistent state. |
| Maintainability | Smaller contracts, fewer illegal imports, less duplicated state ownership. |
| User clarity | Docs and UI match what the app actually does. |

---

## 6. Documentation Truth Model

Going forward, docs should fall into one of four buckets:

| Bucket | Meaning | Examples |
|---|---|---|
| Canonical | Current truth users/developers can trust. | User guide, extension authoring guide, MCP server authoring guide, workspace schema, settings registry, canvas structural model, this manifest. |
| Active milestone | The one current execution plan. | A single root milestone file or clearly named active plan. |
| Research/planning | Forward-looking, not source of truth until accepted. | Systems redesign research, agent/skill operating model, cleanup plan. |
| Archive | Historical record only. | Closed milestones, old audits, superseded plans. |

Rule: if a doc is canonical, it must be accurate enough to act on. If it is not accurate, archive it or label it as draft/research.

---

## 7. Near-Term Target

Before any major systems redesign starts, Parallx needs a cleanup baseline:

1. Current app checkpoint exists.
2. Dedicated redesign branch exists.
3. Current milestone docs are labeled by status.
4. Canonical docs are identified.
5. Historical docs are moved to archive, not deleted.
6. A new System Atlas maps the app end to end.
7. Baseline measurements exist for startup, IPC, persistence, extensions, canvas, and background work.

Only after that should implementation milestones begin.

