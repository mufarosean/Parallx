# Milestone 70 — App Command Control

> **Status:** Implemented (commits `e71615e`, `31c43ca`). Both tools shipped
> with the AI Hub toggle, denylist, and ~89 opted-in commands. See verification
> at the bottom of this doc.

## Why

Parallx has 160+ commands accessible via the command palette. Users who remember
they exist still have to navigate menus or recall keyboard shortcuts. The AI
assistant is already answering questions about the app — it should be able to
*act* on those answers too.

The goal is to let a user say "switch to dark theme", "open the workspace graph",
or "activate the budget tool" and have the AI do it, without filling the context
window with hundreds of tool definitions and without creating ambiguity with the
AI's existing task tools.

## Design Gates (must pass before code is written)

### Gate 1 — Deduplication audit

Every existing AI tool (`read_file`, `write_file`, `create_page`, `run_command`,
`webSearch`, etc.) must be cross-checked against the full command palette. Any
command that duplicates an existing tool's action is **not** exposed as an app
command — the existing tool is the canonical path.

Output of the audit: a list of commands cleared for opt-in, a list explicitly
excluded, and a note on any grey areas.

### Gate 2 — Exclusion list

The following categories are permanently excluded regardless of opt-in status:

- Any command that modifies AI settings, model selection, or approval strictness
- Package installation / tool uninstallation
- Workspace deletion or reset
- Authentication or secret management

## Architecture

### Two tools, always small

The context window impact is two small tool schemas, regardless of how many
commands are registered. The 160+ command descriptions never appear in the prompt.

| Tool | Color gate | Purpose |
|---|---|---|
| `app__find_commands` | Green | Natural language → returns 3–5 matching annotated commands with IDs and descriptions. Never executes anything. |
| `app__run_command` | Blue | Executes a specific command ID. Hard-validates ID is in the opt-in registry before calling. |

Blue classification for `app__run_command` is intentional: app state changes
(theme, layout, tool activation) are mutations that should gate after a red tool
turn, matching the same logic as file writes.

### Naming convention

The `app__` prefix follows the existing `mcp__` double-underscore convention.
Local models can pattern-match the prefix before reading the description. All
opt-in command IDs are surfaced with this prefix in search results so the AI
always knows it is looking at an app control result.

### Opt-in annotation

Commands are not AI-invocable by default. The command registration API gains an
optional `aiInvocable` flag:

```typescript
commandService.registerCommand({
  id: 'theme.setDark',
  title: 'Switch to Dark Theme',
  aiInvocable: true,
  aiDescription: 'Switch the Parallx color theme to dark mode.',
});
```

`aiDescription` is separate from `title` because command palette titles are
written for human scanning ("Workspace Graph: Refresh") while AI descriptions
need to be phrased as capability statements ("Refresh the workspace graph
visualization"). Both are required when `aiInvocable: true`.

Extension commands opt in via their manifest `contributes.commands` entries.

### Workspace-level enable toggle

Neither tool is injected into the chat context unless the workspace has opted in:

```json
// .parallx/config.json
{ "ai.workbenchControl": true }
```

When the toggle is off there is zero context window footprint.

### Local model safety

Both tool descriptions include explicit trigger conditions. `app__find_commands`:

> *Call this ONLY when the user is explicitly asking to do something TO the
> Parallx application — change a setting, open a view, activate a tool, switch a
> theme. Do NOT call this for file operations, code tasks, or data queries.*

`app__run_command` validates the commandId against the live opt-in registry
before calling. If the model hallucinates an ID it gets a clean error it can
relay back to the user. The find → validate → execute two-step prevents one-shot
ID hallucination.

## Scope

**In scope:**

- Deduplication audit document
- `aiInvocable` and `aiDescription` additions to command registration API
- `app__find_commands` tool — text search over annotated commands
- `app__run_command` tool — validated execution
- Workspace-level enable toggle wired into chat tool injection
- Batch opt-in annotation for built-in commands (post-audit)
- Extension manifest support for `aiInvocable` on contributed commands

**Out of scope:**

- AI settings commands
- Commands with complex argument shapes (file paths, page IDs) — phase two
- Semantic / vector search for `app__find_commands` (text search is sufficient for MVP)
- Command argument collection via the AI (MVP is zero-arg or single-string-arg commands only)

## Existing pieces to build on

| Piece | Location |
|---|---|
| Command registration | `src/services/serviceTypes.ts` — `ICommandService` |
| Tool injection into chat | `src/built-in/chat/main.ts` — tool registration at activation |
| Tool color gate | `src/openclaw/openclawToolPolicy.ts` — `BLUE_TOOLS` set |
| Workspace config | `src/services/parallxConfigService.ts` |

## Success criteria

- User can say "switch to dark theme" and the AI does it in one exchange
- User can say "open the workspace graph" and the AI does it
- Saying "read my settings file" does NOT trigger `app__find_commands` — existing `read_file` tool handles it
- A hallucinated command ID produces a clear error, not a silent no-op
- Context window overhead when feature is enabled: two small schemas only
