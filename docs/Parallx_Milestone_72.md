# Milestone 72 — AI Ecosystem Cohesion ("The AI Knows You")

> **Status:** Planning.

## Why

Parallx has sophisticated AI infrastructure — SOUL.md, MEMORY.md, conversation
summaries, user preferences, agent configs, workspace digests — but none of it
connects into something that feels alive. The AI starts each workspace session
without a clear understanding of who it is talking to, and users have to run an
`/init` command to create the scaffolding the AI needs. After months of use the
AI still asks clarifying questions it should already know the answers to.

The root problem is a design inversion: the current system asks the **user** to
set up files so the **AI** can read them. The right design is the opposite — the
AI reads what already exists, infers what it can, writes what it learns, and
never asks the user to do setup work on its behalf.

### How Claude Code handles this (the model to follow)

Claude Code operates on three layers that exist before any conversation:

1. **A global user file** — `~/.claude/CLAUDE.md` captures preferences, working
   style, and identity facts that the user has told Claude over many sessions.
   Claude writes to it proactively the moment it learns something worth keeping.

2. **Project-level context** — `CLAUDE.md` at the repo root gives the AI the
   project's conventions, architecture, and constraints. It is read automatically
   on every session start. The user does not have to invoke anything.

3. **Proactive writes, not reactive requests** — when Claude learns "this user
   prefers no trailing summaries" or "this is a TypeScript project, avoid JS",
   it writes that to memory immediately without being asked. The knowledge
   accumulates across sessions silently.

The design principle: **the AI adapts to the world as it finds it, writes what
it learns, and never asks the user to set up scaffolding for it.**

## What currently exists and what is wrong with it

| Component | Current state | Problem |
|---|---|---|
| `SOUL.md` | Hardcoded in `src/built-in/chat/defaults/` | Cannot be customised per user or per workspace |
| `persona.*` settings | UI fields in unified config | Dead code — LLM never reads them (F11 regression) |
| `USER.md` | Does not exist | The AI has no structured understanding of who it is talking to |
| User preferences | Regex-detected after 2+ passive mentions | Cold start problem; most new users' preferences never surface |
| Memory (`MEMORY.md`) | Exists but requires user action to populate | No proactive AI writing; no UI to see what the AI knows |
| `/init` command | Required to create `.parallx/` scaffold | User does setup work the AI should do itself |
| Agent definitions | Typed in config; no UI to create or switch them | Feature exists but is invisible |
| `unifiedConfigTypes.ts` | ~40% of fields are dead code (F11 regressions) | Users configure things that do nothing; erodes trust |

## Design principles for M72

1. **No init command.** The AI reads what exists and creates what it needs on
   first use. The user never runs a setup command.

2. **Global then local.** A user-level directory (`~/.parallx/`) holds identity
   facts that apply across every workspace. Workspace-level files (`.parallx/`)
   hold project-specific context. Both are read automatically.

3. **Proactive writes.** When the AI learns something about the user or the
   project, it writes it immediately. The user does not ask for this.

4. **Every config field that exists must work.** Dead fields are removed or
   wired. The settings UI shows only controls that have real effect.

5. **The user can see and edit everything.** Memory, profile, SOUL overlay —
   all are plain markdown files in known locations, plus a UI surface to view
   and edit them without touching files directly.

## File system design

### Global layer — `~/.parallx/`

Applies to every workspace on the machine. Created on first Parallx launch.

```
~/.parallx/
  USER.md          ← who the user is (name, role, expertise, style)
  MEMORY.md        ← durable facts the AI has learned about the user
  SOUL.md          ← optional: user-level AI personality overlay
```

### Workspace layer — `.parallx/` (existing location)

Project-specific context. Created on first AI interaction in a new workspace,
not by a user command.

```
.parallx/
  CONTEXT.md       ← replaces the old AGENTS.md; project conventions, stack, constraints
  SOUL.md          ← optional: workspace-level AI personality overlay
  memory/
    MEMORY.md      ← durable facts about this project
    YYYY-MM-DD.md  ← daily session notes (existing)
  sessions/        ← existing
  permissions.json ← existing
```

### Merge order (lowest to highest priority)

```
Base SOUL.md (shipped default)
  ← ~/.parallx/SOUL.md (user overlay)
    ← .parallx/SOUL.md (workspace overlay)

~/.parallx/USER.md (always injected)
~/.parallx/MEMORY.md (always injected, trimmed to token budget)
.parallx/CONTEXT.md (project context, replaces AGENTS.md)
.parallx/memory/MEMORY.md (project memory)
```

## Phase 1 — Clean up dead code and make config truthful (Week 1)

The trust gap: users configure things in AI Settings that do nothing. Fix this
before building anything new.

- Remove or clearly stub every dead field in `IUnifiedAIConfig` and the settings
  UI: `persona.name`, `persona.description`, `persona.avatar`, `chat.systemPrompt`
  (the field that was supposed to let users customise the prompt but was never
  wired), legacy model fields, retrieval fields marked F11.
- Wire `persona.name` properly: if the user has named the AI, that name appears
  in SOUL.md injection so the LLM calls itself by that name.
- The settings UI becomes a contract: if a control is visible, it works.

## Phase 2 — USER.md and first-use bootstrap (Week 1–2)

Introduce the global `~/.parallx/USER.md` file as the primary "who I am"
document. The AI reads this on every session start and treats it as ground truth
about the user.

**First-use flow (no init command):**

On the very first AI interaction in a new workspace, if `~/.parallx/USER.md`
does not exist, the AI asks a small number of questions in a focused onboarding
message — not a command, just a conversational prompt:

> "Before we start — I don't have a profile for you yet. What's your name, and
> what kind of work do you mainly do in Parallx? (You can always update this
> later with `/profile`.)"

The AI writes the answers to `~/.parallx/USER.md` immediately. On subsequent
workspaces the file already exists and no questions are asked.

**File format:**

```markdown
# User Profile
Name: Mufaro
Role: Solo developer
Focus: Building Parallx — an Electron + TypeScript AI workbench
Expertise: Systems architecture, Electron, TypeScript
New to: React fine details in this codebase
Communication style: Direct. Skip boilerplate. Prefer examples over explanations.
Updated: 2026-05-16
```

**Injection:** Injected into every system prompt after SOUL.md, before workspace
context. Token budget: capped at 300 tokens.

**UI surface:** A `/profile` command opens a panel showing the current
`~/.parallx/USER.md` with an inline editor. The AI can also update it
proactively: "I noticed you mentioned you prefer TypeScript — I've added that to
your profile."

## Phase 3 — SOUL.md becomes customisable (Week 2)

The base `SOUL.md` remains the shipped default but is no longer the final word.

- `~/.parallx/SOUL.md` — user-level overlay, appended after the base. "Always
  use metric units. Be more concise than the default."
- `.parallx/SOUL.md` — workspace-level overlay. "In this project, focus on
  Electron internals. Avoid web framework suggestions."

Overlays are additive — they do not replace the base, they extend it. The
settings UI exposes a textarea for each level. The `/soul` command shows the
merged result so the user can see exactly what the AI's personality configuration
is for the current session.

## Phase 4 — Proactive memory writing (Week 2–3)

The AI writes to memory during conversation without being asked.

**Triggers for proactive writes:**

- User states a preference explicitly → written to `~/.parallx/MEMORY.md`
- User corrects the AI on a fact about the project → written to
  `.parallx/memory/MEMORY.md`
- A session produces a meaningful decision or convention → written to the daily
  log and flagged for MEMORY.md promotion

**Memory promotion:** The daily log (`YYYY-MM-DD.md`) is ephemeral. The AI
identifies facts worth keeping and promotes them to `MEMORY.md` automatically at
the end of a session, or when explicitly asked (`/remember that...`).

**Preferences fix:** The 2-confirmation threshold for preference injection is
removed. A detected preference is injected immediately and confirmed once (not
twice). The `global-auto` source (removed in M67 Phase 4.5) is replaced by a
proper preference confidence model.

**Explicit commands:**
- `/remember <fact>` — writes immediately to the appropriate MEMORY.md
- `/forget <fact>` — removes it
- `/memory` — shows a readable summary of what the AI currently knows

## Phase 5 — Memory health (Week 3)

- **Memory dashboard view:** A dedicated panel (or dashboard cell — integrates
  with M71) showing the contents of both MEMORY.md files in a readable,
  editable format. Not raw markdown — a list of facts with timestamps and a
  delete button.
- **Memory eviction:** The eviction code in `memoryService.ts` exists but is not
  wired to any scheduler. Wire it. Session memories older than 90 days at low
  decay score are pruned automatically.
- **Memory size cap:** Each MEMORY.md is capped at 500 lines. When the cap is
  reached, the AI summarises the oldest 100 entries into a single compressed
  paragraph before pruning them.

## Phase 6 — Agent configuration UI (Week 3–4)

Agent definitions are already typed in `openclawAgentConfig.ts` and stored in
unified config. They are invisible to the user.

- Add an Agents panel in settings: a list of configured agents with their name,
  model, and system prompt overlay.
- Users can create, rename, duplicate, and delete agents.
- Each agent has: name, model override, system prompt overlay textarea, tool
  allow/deny list.
- The chat toolbar agent picker becomes functional — not just "Chat / Workspace /
  Canvas" but any user-defined agent.

## `CONTEXT.md` — replacing `AGENTS.md`

The existing `AGENTS.md` bootstrap file served as the project context document
but its name confused users ("agents" sounds like AI agents, not project docs).
M72 renames the concept to `CONTEXT.md` and gives it a cleaner format:

```markdown
# Project Context
## What this is
Parallx — an Electron + TypeScript desktop workbench for local AI workflows.

## Stack
Electron 32, TypeScript 5.5, Vite, SQLite (better-sqlite3), sqlite-vec

## Conventions
- ESM throughout; no CommonJS in src/
- Services registered via DI container (ServiceCollection)
- Extension API surface in src/api/

## What to avoid
- Do not suggest cloud APIs; everything runs locally
- Do not modify electron/main.cjs without flagging the security implications
```

The AI creates `.parallx/CONTEXT.md` on first interaction in a new workspace if
it does not exist, inferring content from `package.json`, `README.md`, and the
file tree. The user reviews and edits it. This replaces the `/init` command
entirely.

## Scope

**In scope:**

- `~/.parallx/` global directory: `USER.md`, `MEMORY.md`, optional `SOUL.md`
- First-use onboarding flow (no `/init` command)
- `CONTEXT.md` replacing `AGENTS.md` with AI-inferred first draft
- `SOUL.md` overlay system (global + workspace)
- Proactive memory writes during conversation
- `/profile`, `/remember`, `/forget`, `/memory`, `/soul` commands
- Memory eviction wired to a scheduler
- Memory dashboard panel
- Dead config field cleanup in `unifiedConfigTypes.ts` and settings UI
- `persona.name` properly wired to SOUL.md injection
- Agent configuration UI in settings

**Out of scope:**

- Multi-user or shared memory (single user per machine)
- Memory encryption at rest (existing workspace security model applies)
- Memory sync across machines
- Agent marketplace or sharing

## Success criteria

- A brand-new workspace gets a working AI context without the user running any command
- After one session, the AI remembers the user's name and role in the next session
- A user who sets `persona.name = "Aria"` sees the AI call itself Aria in responses
- Every control visible in AI Settings has a measurable effect
- `/memory` shows a human-readable list of what the AI knows, with working delete buttons
- The AI proactively says "I've added that to your profile" at least once in a natural session
