# Milestone 11: Second Brain — From Chat Widget to Jarvis

## Research Document — March 2, 2026

---

## Table of Contents

1. [Vision](#vision)
2. [Non-Negotiables](#non-negotiables)
3. [Research: How Others Do It](#research-how-others-do-it)
4. [Current Parallx State — What We Have](#current-parallx-state--what-we-have)
5. [Transformation Map — OpenClaw → Parallx](#transformation-map--openclaw--parallx)
6. [Skills & Prompt File Specification](#skills--prompt-file-specification)
7. [Security Model](#security-model)
8. [Capability Map](#capability-map)
9. [Architecture Decisions](#architecture-decisions)
10. [Task Tracker](#task-tracker)
11. [Implementation Order](#implementation-order)

---

## Vision

**What Parallx should feel like:**

> You open your workspace. Parallx already knows every file, every structure, every pattern. You ask "what does the auth system do?" and it pulls the relevant files, explains the architecture, and offers to improve it. You say "add rate limiting to the API routes" and it reads the codebase, writes the code, shows you a diff, and applies it when you approve. You paste a terminal error and it diagnoses it instantly using your actual code. It never touches anything outside your workspace. It never phones home. It's YOUR brain extension, running on YOUR hardware.

**What Parallx is NOT:**

- Not a cloud service — everything runs locally via Ollama
- Not an autonomous agent with unsupervised access — every destructive action requires user approval
- Not a data collector — zero telemetry, zero external calls (unless user explicitly enables cloud models)
- Not an OpenClaw integration — we learn from OpenClaw's architecture, just as we learned from VS Code and Notion. Parallx is its own product.

---

## Non-Negotiables

These are architectural decisions that are final and not up for debate:

| # | Decision | Rationale |
|---|----------|-----------|
| **NN-1** | **Adopt OpenClaw-style skills system** — agent capabilities are defined as skills, each with a `SKILL.md` manifest, structured exactly like OpenClaw's skill files | This is the industry-proven pattern. Skills are composable, discoverable, user-editable, and self-documenting. |
| **NN-2** | **Adopt OpenClaw-style prompt files** — `AGENTS.md` at workspace root for agent orientation, `SOUL.md` for personality, `TOOLS.md` for tool instructions. All plain markdown. | User owns the prompt. Everything is a file. No hidden magic. Matches both OpenClaw (AGENTS.md/SOUL.md/TOOLS.md) and Cursor (.cursorrules) patterns. |
| **NN-3** | **`.parallx/` workspace directory** as the configuration root — skills, rules, commands, permissions all live here as plain files | Following Continue.dev (.continue/) and Cursor (.cursor/) patterns. User can version-control their AI config. |
| **NN-4** | **Local-first, Ollama-only** — no cloud models unless user explicitly opts in | Core identity of Parallx. Non-negotiable since M10. |
| **NN-5** | **Workspace sandbox** — AI cannot read, write, or execute outside the workspace root | Security foundation. Already enforced by `WorkspaceBoundaryService`. |
| **NN-6** | **No integration with OpenClaw** — we study and adapt their patterns, we do not depend on their software | Parallx is a standalone product. We learn from OpenClaw like we learned from VS Code. |

---

## Research: How Others Do It

### VS Code Copilot (GitHub Copilot Chat)

**Architecture:**
- Cloud-based — sends code to GitHub/OpenAI servers
- Uses GPT-4/Claude via API, not local models
- Tight editor integration via VS Code extension API

**Key patterns we adopt:**

| Feature | How VS Code Does It | What Parallx Takes |
|---|---|---|
| `@workspace` | Embeds workspace files, uses RAG to find relevant code | ✅ We have indexing + retrieval — need to wire it into chat |
| `@file` mentions | User types `@filename.ts`, content is injected into prompt | Adopt this pattern for explicit context injection |
| System prompt | Hidden system prompt with workspace info, capabilities, formatting rules | ✅ We have `buildSystemPrompt()` — needs layering |
| Slash commands | `/explain`, `/fix`, `/test`, `/doc` — structured intents | Adopt as `.parallx/commands/` |
| Streaming | Token-by-token rendering with cursor animation | ✅ Working via Ollama NDJSON |
| Multi-turn context | Conversation history maintained per session, RAG re-queried per turn | ✅ Sessions exist, need per-turn RAG re-query |
| Content exclusion | `.copilotignore` | Adopt as `.parallxignore` |

**What we deliberately skip:** Cloud everything, participant extension API (future M12+).

### Cursor

**Architecture:**
- Fork of VS Code with deeply integrated AI
- Uses cloud models (GPT-4, Claude) + local model support
- Custom diff/apply engine

**Key patterns we adopt:**

| Feature | How Cursor Does It | What Parallx Takes |
|---|---|---|
| Codebase indexing | Embeds entire repo, re-indexes on file change | ✅ Already implemented in M10 |
| `@codebase` | Semantic search across workspace, injects top-K chunks | Wire our retrieval into chat context |
| `@file`, `@folder` | Explicit context injection | Adopt this mention syntax |
| Apply button | Parses code blocks, computes diff, shows unified diff view | Implement diff review UI |
| `.cursorrules` | User-defined rules file injected into every prompt | Adopt as `AGENTS.md` (OpenClaw-style, richer) |
| Context pills | Visual chips showing what's in context | Implement for transparency |

**What we deliberately skip:** Composer (multi-file AI-driven refactor — future), tab completion (no code editor), Cmd+K inline edit (no editor).

### Continue.dev (Open Source)

**Architecture:**
- Open-source VS Code extension, model-agnostic, local-first
- Ollama integration out of the box

**Key patterns we adopt:**

| Feature | How Continue Does It | What Parallx Takes |
|---|---|---|
| Local-first | Ollama integration | ✅ Already our foundation |
| `.continue/config.json` | Full configuration — models, context providers, slash commands | Adopt as `.parallx/config.json` |
| `.continue/rules/` | Directory of rule files, each scoped to file patterns | Adopt as `.parallx/rules/` |
| Custom slash commands | User-defined in config, reference prompt templates | Adopt as `.parallx/commands/` |
| Prompt files (`.prompt`) | Markdown with frontmatter defining reusable prompts | Adopt via skills system |
| Context providers | Pluggable system — files, URLs, terminal, Git diff | Influences our skill architecture |

**What we deliberately skip:** Proprietary indexing server (we use our own sqlite-vec pipeline).

### OpenClaw (github.com/openclaw/openclaw)

**Stats:** 248K stars, 47.8K forks, 1,018 contributors, MIT licensed, TypeScript (86%).

**What it is:** A personal AI assistant you self-host. Gateway-based architecture with WebSocket control plane. Connects to 22+ messaging channels (WhatsApp, Telegram, Slack, Discord, etc.) and device nodes (macOS, iOS, Android). It is messaging-first, not workspace-first. The mascot is a lobster named Molty.

**Architecture:**
```
Messaging Channels (WhatsApp / Telegram / Slack / Discord / ...)
               │
               ▼
┌───────────────────────────────────┐
│        Gateway (control plane)    │
│       ws://127.0.0.1:18789       │
└──────────────┬────────────────────┘
               │
               ├─ Pi agent (RPC)     ← AI brain
               ├─ CLI (openclaw …)
               ├─ WebChat UI
               ├─ macOS app
               └─ iOS / Android nodes
```

**Key patterns we adopt (THIS IS THE GOLD STANDARD for skills + prompt files):**

| Feature | How OpenClaw Does It | What Parallx Takes |
|---|---|---|
| **Skills system** | Folder-based: `skills/<name>/SKILL.md` — each skill is a self-contained capability with a markdown manifest | **Non-negotiable adoption.** Our tools become skills with `SKILL.md` manifests. |
| **`AGENTS.md`** | Workspace-level prompt file injected into every conversation — tells the agent about the project, conventions, file structure | **Non-negotiable adoption.** Replaces our `.parallx/prompt.md` concept. Lives at workspace root. |
| **`SOUL.md`** | Personality/identity prompt — how the agent should behave, tone, constraints | **Non-negotiable adoption.** Our core identity layer, user-editable. |
| **`TOOLS.md`** | Tool-specific instructions — tells the agent how to use its tools effectively | **Non-negotiable adoption.** Ships with Parallx defaults, user can override. |
| **Permission model** | "Allow once" / "Allow for session" / "Always allow" per tool per action | Adopt 3-tier permission system (already have binary `requiresConfirmation`) |
| **`/init` command** | Scans codebase, auto-generates `AGENTS.md` (was CLAUDE.md) | Adopt — auto-generate `AGENTS.md` on first workspace open |
| **`/compact` command** | Summarizes old context to free up token window | Adopt — we already have LLM-based history summarization |
| **ClawHub (skills registry)** | 5,400+ community skills, searchable, installable | Future vision — `.parallx/skills/` with installable skill packs |
| **Multi-agent routing** | Route different channels to isolated agent sessions with separate workspaces | Future M12+ — multiple specialized agents |
| **Max turns** | Configurable limit on autonomous tool-call iterations | Adopt — we have 10-iteration limit, make it configurable |
| **Session model** | Main session for direct chats, group isolation, activation modes | Maps to our existing `IChatSession` with chat modes |
| **Cost/usage tracking** | Shows API cost per conversation | We show tokens — keep this, add token-per-tool breakdown |

**What we deliberately DO NOT adopt from OpenClaw:**
- Gateway WebSocket architecture (we're Electron-based, IPC is our control plane)
- Multi-channel messaging (WhatsApp/Telegram/Slack — we're a desktop workbench)
- Device nodes (camera, screen recording, location — out of scope)
- Voice wake / talk mode (future, not M11)
- Browser control (CDP headless Chrome — out of scope for M11)
- Canvas A2UI (we have our own canvas system)
- Docker sandboxing for non-main sessions (single-user desktop app)

**Key insight:** OpenClaw is messaging-native (reach you on any channel). Parallx is workspace-native (understand your project deeply). They solve different slices of the "Jarvis" problem. We adopt OpenClaw's **skill/prompt patterns** (proven at scale) while keeping Parallx's **workspace intelligence** (RAG, indexing, project context) as our differentiator.

---

## Current Parallx State — What We Have

Before defining what to build, here's what M10 already shipped. This is critical context — we're transforming a working system, not building from scratch.

### Already Implemented (Reuse As-Is)

| Component | File(s) | What It Does | M11 Impact |
|---|---|---|---|
| **Agentic loop** | `defaultParticipant.ts` | 10-iteration tool call → execute → feed back cycle | **Keep** — this IS our agent runtime |
| **Tool registry** | `languageModelToolsService.ts` | Register, invoke, confirm tools. `getToolDefinitions()` for Ollama | **Extend** — becomes the skill executor |
| **11 built-in tools** | `builtInTools.ts` | `search_workspace`, `read_page`, `read_file`, `list_files`, `create_page`, etc. | **Wrap** — each becomes a skill with `SKILL.md` |
| **Confirmation gates** | `chatTypes.ts` → `requiresConfirmation` | Binary per-tool confirmation prompts | **Upgrade** — to 3-tier permission model |
| **Workspace sandbox** | `workspaceBoundaryService.ts` | `assertUriWithinWorkspace()` path validation | **Keep** — already enforces our security boundary |
| **File service** | `fileService.ts` | Full CRUD: `readFile`, `writeFile`, `stat`, `readdir`, `exists`, `rename`, `delete`, `mkdir`, `copy`, `watch` | **Keep** — has everything we need for file tools |
| **RAG pipeline** | `indexingPipeline.ts` + `vectorStoreService.ts` + `embeddingService.ts` + `chunkingService.ts` + `retrievalService.ts` | Full embed → chunk → index → hybrid search → inject | **Keep** — already production quality |
| **System prompt** | `chatSystemPrompts.ts` | Mode-aware (Ask/Edit/Agent), workspace stats, tool list | **Transform** — overlay with AGENTS.md/SOUL.md/TOOLS.md |
| **Memory system** | `memoryService.ts` | Session summaries + preference learning, stored as vectors | **Keep** — unique advantage over most competitors |
| **Ollama provider** | `ollamaProvider.ts` | Streaming, tool calls, context length detection, thinking support | **Keep** — battle-tested |
| **Chat persistence** | `chatSessionPersistence.ts` | SQLite save/load/delete sessions | **Keep** |
| **Context assembly** | `defaultParticipant.ts` → `_buildMessages()` | System prompt → history → implicit context → RAG → explicit attachments | **Transform** — add prompt file layers, token budget manager |
| **Chat modes** | `ChatMode` enum (Ask/Edit/Agent) | Different tool access per mode | **Extend** — modes align with permission tiers |

### Needs Enhancement (Transform)

| Component | Current State | What M11 Adds |
|---|---|---|
| **System prompt** | Single `buildSystemPrompt()` function, hardcoded | Layered: core Parallx prompt → `SOUL.md` → `AGENTS.md` → `TOOLS.md` → `.parallx/rules/*.md` → RAG context |
| **Permission model** | Binary (`requiresConfirmation: boolean`) | 3-tier: always-allowed / requires-approval / never-allowed. Per-tool config in `.parallx/permissions.json` |
| **Context budget** | Simple `chars/4` estimation + overflow summarization | Priority-based token budget manager with slots: system (10%), RAG (30%), history (30%), user (30%) |
| **Tool definitions** | Tools defined as objects in `builtInTools.ts` | Each tool wrapped in a skill folder with `SKILL.md` manifest |
| **`.parallxignore`** | Hardcoded `SKIP_DIRS` set in indexing pipeline | Configurable `.parallxignore` file (git-style patterns) for both indexing AND AI file access |

### Net New (Build)

| Component | Description | Complexity |
|---|---|---|
| **`.parallx/` directory structure** | `AGENTS.md`, `SOUL.md`, `TOOLS.md` at workspace root; `.parallx/` for skills, rules, commands, config | Medium |
| **Skill loader** | Reads `skills/<name>/SKILL.md` manifests, registers as tools | Medium |
| **Prompt file loader** | Reads and layers `AGENTS.md` → `SOUL.md` → `TOOLS.md` → `rules/*.md` | Low |
| **`write_file` tool/skill** | Write content to file with diff preview + approval | High |
| **`edit_file` tool/skill** | Search-replace or line-range edits with diff preview | High |
| **Diff review UI** | Accept/reject overlay for file write proposals | High |
| **`@file` / `@folder` mentions** | Parse `@` syntax in chat input, inject content | Medium |
| **`/init` command** | Scan workspace, auto-generate `AGENTS.md` | Medium |
| **`/compact` command** | Summarize conversation, free context window | Low (summarization exists) |
| **Terminal integration** | xterm.js panel + `run_command` tool/skill | High |
| **Context pills UI** | Visual chips showing what's in the prompt + token counts | Medium |

---

## Transformation Map — OpenClaw → Parallx

This section maps every OpenClaw concept to its Parallx equivalent, noting what we keep, transform, or build new.

### Prompt Files

| OpenClaw | Parallx | Status | Notes |
|----------|---------|--------|-------|
| `AGENTS.md` (workspace root) | `AGENTS.md` (workspace root) | **BUILD** — adopt exact convention | Project description, architecture, conventions, important files. Auto-generated by `/init`, user-editable. |
| `SOUL.md` (personality) | `SOUL.md` (workspace root) | **BUILD** — adopt exact convention | Agent personality, tone, constraints. Ships with Parallx defaults. |
| `TOOLS.md` (tool instructions) | `TOOLS.md` (workspace root) | **BUILD** — adopt exact convention | How to use each tool, best practices. Auto-generated from skill manifests. |
| `~/.openclaw/openclaw.json` (global config) | `.parallx/config.json` (per-workspace) | **BUILD** | Model settings, context budget, RAG params, permission defaults |

### Skills System

| OpenClaw | Parallx | Status | Notes |
|----------|---------|--------|-------|
| `~/.openclaw/workspace/skills/<skill>/SKILL.md` | `.parallx/skills/<skill>/SKILL.md` | **BUILD** | Each skill is a folder with a `SKILL.md` manifest. Built-in skills ship with Parallx. |
| Bundled skills (built-in, always available) | Built-in skills (search, read, page ops) | **TRANSFORM** — wrap existing tools as skills | 11 existing tools get `SKILL.md` manifests |
| Managed skills (installed via ClawHub) | Installable skills (future M12+) | **FUTURE** | Community skill registry |
| Workspace skills (project-specific) | Custom skills in `.parallx/skills/` | **BUILD** | User-defined skills per workspace |
| Skill install gating | Permission tiers | **BUILD** | Skills declare their permission requirements in manifest |

### Agent Runtime

| OpenClaw | Parallx | Status | Notes |
|----------|---------|--------|-------|
| Pi agent (RPC) | `defaultParticipant.ts` agentic loop | **KEEP** | Our 10-iteration tool loop IS the agent runtime |
| Tool streaming | Ollama NDJSON streaming | **KEEP** | Already working via `ollamaProvider.ts` |
| Tool call → execute → feed back | `IChatTool` → `invokeTool()` → response | **KEEP** | Already implemented in `languageModelToolsService.ts` |
| Max turns config | Hardcoded 10 iterations | **TRANSFORM** — make configurable | Add to `.parallx/config.json` |
| `/compact` session pruning | `summarizeHistory()` in defaultParticipant | **TRANSFORM** — expose as slash command | Logic exists, needs command trigger |

### Security

| OpenClaw | Parallx | Status | Notes |
|----------|---------|--------|-------|
| Permission prompt per action | `requiresConfirmation` boolean | **TRANSFORM** — upgrade to 3-tier | Allow once / Allow for session / Always allow |
| Workspace sandbox | `WorkspaceBoundaryService` | **KEEP** | Already enforces path boundaries |
| `.clawignore` | `.parallxignore` | **BUILD** | Git-style patterns for AI exclusion |
| Allowed/blocked command patterns | `.parallx/permissions.json` | **BUILD** | Configurable per-tool permission overrides |
| DM pairing (messaging security) | N/A | **SKIP** | We're single-user desktop, not multi-channel messaging |
| Docker sandboxing | N/A | **SKIP** | Single-user desktop app |

### What Parallx Has That OpenClaw Doesn't

| Parallx Advantage | Description | OpenClaw Equivalent |
|---|---|---|
| **Workspace-native RAG** | Full indexing pipeline: embed → chunk → sqlite-vec → hybrid search → RRF ranking | OpenClaw has no workspace RAG — it's a messaging assistant, not a codebase assistant |
| **Canvas system** | Rich TipTap-based pages with blocks, databases, tables — indexed and searchable | OpenClaw has a different Canvas (A2UI) for visual output, not knowledge storage |
| **Memory system** | Session summaries + preference learning, stored as embeddings | OpenClaw has memory via AGENTS.md (manual), no auto-learning |
| **Multi-mode agent** | Ask/Edit/Agent modes with different tool access per mode | OpenClaw has session modes but not specialized tool-access tiers |
| **Local embedding** | `nomic-embed-text` via Ollama — zero data leaves machine | OpenClaw uses cloud models primarily |

---

## Skills & Prompt File Specification

### Overview

This is the **non-negotiable** architectural specification for Parallx's skill and prompt file system, directly inspired by OpenClaw's proven patterns at scale (248K stars, 5,400+ skills).

### Prompt File Convention

Three markdown files at the **workspace root** (not inside `.parallx/`):

```
workspace-root/
├── AGENTS.md          ← Project description, architecture, conventions (user-editable)
├── SOUL.md            ← Agent identity, personality, tone (user-editable, ships with defaults)
├── TOOLS.md           ← Tool usage instructions (auto-generated from skills, user can override)
├── .parallx/
│   ├── config.json    ← Workspace AI settings
│   ├── ignore         ← .parallxignore patterns
│   ├── permissions.json ← Per-skill permission overrides
│   ├── rules/
│   │   ├── typescript.md
│   │   └── testing.md
│   ├── commands/
│   │   ├── explain.md
│   │   └── review.md
│   └── skills/
│       └── custom-skill/
│           └── SKILL.md
└── ... (rest of workspace)
```

### AGENTS.md Specification

**Purpose:** Tell the agent about the project. This is the most important prompt file — it gives the AI its workspace context.

**Location:** Workspace root (e.g., `/path/to/my-project/AGENTS.md`)

**Auto-generated by:** `/init` command (scans file tree, README, package.json, etc.)

**Example:**
```markdown
# Project: Parallx

Parallx is a second-brain workbench — VS Code's architecture repurposed as a
tool platform. Electron app with TypeScript throughout.

## Architecture
- `src/services/` — Core services (DI-based, VS Code service pattern)
- `src/built-in/` — Built-in tools (canvas, editor, explorer, chat)
- `src/api/` — Public tool API (`parallx.*` mirrors `vscode.*`)
- `electron/` — Main process (database, IPC, file system)

## Conventions
- TypeScript strict mode, camelCase files, PascalCase classes
- Services implement interfaces from `serviceTypes.ts`
- Tools register via `parallx.tools.registerTool()`
- Follow VS Code patterns — check DeepWiki and VS Code source

## Important Files
- `ARCHITECTURE.md` — System architecture overview
- `src/services/serviceTypes.ts` — All service interfaces
- `src/api/parallx.d.ts` — Public API surface

## Build & Run
- `pnpm install` → `pnpm dev` for development
- `pnpm test` for tests (vitest)
- Electron main process in `electron/`
```

### SOUL.md Specification

**Purpose:** Define the agent's personality. Controls tone, behavior, constraints.

**Location:** Workspace root

**Ships with Parallx defaults, user can customize:**

```markdown
# Parallx AI Assistant

You are Parallx, a local AI assistant running entirely on the user's machine.
You help the user understand and work with their project files.

## Personality
- Direct, concise, technical
- Explain your reasoning when asked
- Admit when you don't know something
- Never hallucinate file contents — read the actual file

## Constraints
- You can ONLY access files within this workspace
- You MUST ask permission before writing or modifying files
- You MUST NOT fabricate code or file contents
- When referencing files, always verify they exist first
- Keep responses focused — don't repeat the user's question back

## Response Style
- Use code blocks with language tags
- Reference file paths relative to workspace root
- When showing diffs, use unified diff format
- For long explanations, use headers and bullet points
```

### TOOLS.md Specification

**Purpose:** Tell the agent how to use its tools effectively.

**Location:** Workspace root

**Auto-generated from skill manifests.** User can override/extend.

```markdown
# Available Tools

## Workspace Skills
- **search_workspace** — Full-text search across all workspace files
- **search_knowledge** — Semantic (RAG) search using embeddings
- **read_file** — Read file contents (supports line ranges)
- **list_files** — List directory contents
- **write_file** — Write content to a file (requires approval)
- **edit_file** — Edit specific sections of a file (requires approval)

## Canvas Skills
- **read_page** — Read a canvas page by ID
- **read_page_by_title** — Find and read a page by title
- **list_pages** — List all canvas pages
- **create_page** — Create a new canvas page (requires approval)

## Tool Usage Guidelines
- Always read a file before editing it
- Use search_knowledge for conceptual questions ("how does auth work?")
- Use search_workspace for exact string matches ("where is handleLogin defined?")
- When editing files, make the smallest change necessary
- Explain what you're changing and why before proposing edits
```

### SKILL.md Manifest Specification

Each skill lives in a folder with a `SKILL.md` manifest file. The manifest describes the skill to both the agent and the system.

**Structure:**
```
.parallx/skills/<skill-name>/
├── SKILL.md            ← Manifest (required)
└── ... (optional support files)
```

**Manifest format:**
```markdown
---
name: write_file
description: Write content to a file within the workspace
version: 1.0.0
author: parallx
permission: requires-approval
parameters:
  - name: path
    type: string
    description: Relative path to the file from workspace root
    required: true
  - name: content
    type: string
    description: The full content to write to the file
    required: true
  - name: createDirectories
    type: boolean
    description: Create parent directories if they don't exist
    required: false
    default: false
tags: [filesystem, write]
---

# write_file

Write content to a file within the workspace. The file will be created if it
doesn't exist, or overwritten if it does.

## When to Use
- Creating new files (e.g., new components, tests, config files)
- Replacing entire file content when most of the file is changing

## When NOT to Use
- For small edits to existing files — use `edit_file` instead
- For files outside the workspace — this is forbidden
- For binary files — only text files are supported

## Security
- All paths are validated against the workspace root
- Files matching `.parallxignore` patterns are blocked
- User approval is required before any write operation
- A diff view is shown comparing current content vs proposed content

## Examples

### Create a new file
\```json
{
  "path": "src/utils/helpers.ts",
  "content": "export function formatDate(d: Date): string {\n  return d.toISOString().split('T')[0];\n}\n",
  "createDirectories": true
}
\```

### Overwrite existing file
\```json
{
  "path": "README.md",
  "content": "# My Project\n\nUpdated documentation.\n"
}
\```
```

### Built-In Skills (ship with Parallx)

These are the existing 11 tools, re-packaged as skills. They live in Parallx's source code (not in `.parallx/`) but follow the same `SKILL.md` pattern for self-documentation.

| Skill | Permission Tier | Current Tool | Transform Needed |
|-------|----------------|--------------|------------------|
| `search_workspace` | always-allowed | ✅ Exists | Add `SKILL.md` manifest |
| `search_knowledge` | always-allowed | ✅ Exists | Add `SKILL.md` manifest |
| `read_file` | always-allowed | ✅ Exists | Add `SKILL.md` manifest |
| `list_files` | always-allowed | ✅ Exists | Add `SKILL.md` manifest |
| `read_page` | always-allowed | ✅ Exists | Add `SKILL.md` manifest |
| `read_page_by_title` | always-allowed | ✅ Exists | Add `SKILL.md` manifest |
| `read_current_page` | always-allowed | ✅ Exists | Add `SKILL.md` manifest |
| `list_pages` | always-allowed | ✅ Exists | Add `SKILL.md` manifest |
| `get_page_properties` | always-allowed | ✅ Exists | Add `SKILL.md` manifest |
| `create_page` | requires-approval | ✅ Exists | Add `SKILL.md` manifest |
| `write_file` | requires-approval | ❌ New | Build tool + manifest |
| `edit_file` | requires-approval | ❌ New | Build tool + manifest |
| `delete_file` | requires-approval | ❌ New | Build tool + manifest |
| `run_command` | requires-approval | ❌ New | Build tool + manifest |
| `search_files` | always-allowed | ✅ Exists | Add `SKILL.md` manifest |

### Skill Loader Architecture

```
Startup Flow:

1. Parallx starts → discover skills:
   a. Built-in skills (hardcoded in source, always available)
   b. Workspace skills (scan .parallx/skills/*/SKILL.md)

2. For each skill:
   a. Parse SKILL.md frontmatter → extract name, parameters, permission tier
   b. Register with LanguageModelToolsService
   c. Validate permission tier against .parallx/permissions.json overrides

3. Generate TOOLS.md from all registered skill manifests
   (unless user has a custom TOOLS.md — then use theirs)

Runtime Flow:

1. User sends message
2. Context assembly reads AGENTS.md, SOUL.md, TOOLS.md
3. Tool definitions sent to Ollama with the request
4. LLM decides which tools to call
5. Tool invocation → permission check → execute → return result
6. Loop until LLM is done or max iterations reached
```

### `.parallx/config.json` Schema

```jsonc
{
  // AI model settings
  "model": {
    "chat": "qwen2.5:32b-instruct",      // Override default chat model
    "embedding": "nomic-embed-text",       // Override default embedding model
    "contextLength": null                  // null = auto-detect from model
  },

  // Agent behavior
  "agent": {
    "maxIterations": 10,                   // Max tool-call loop iterations
    "autoRag": true,                       // Auto-retrieve context per message
    "ragTopK": 10,                         // Number of RAG chunks per query
    "ragScoreThreshold": 0.3              // Minimum relevance score
  },

  // Context budget (percentages of context window)
  "contextBudget": {
    "systemPrompt": 10,                    // SOUL.md + AGENTS.md + TOOLS.md
    "ragContext": 30,                      // Auto-retrieved + @mentions
    "history": 30,                         // Conversation history
    "userMessage": 30                      // Current message + attachments
  },

  // Permission defaults (can be overridden per-skill)
  "permissions": {
    "fileWrite": "ask-every-time",         // "ask-every-time" | "ask-once-per-session" | "always-allow"
    "fileDelete": "ask-every-time",
    "terminalCommand": "ask-every-time"
  },

  // Indexing
  "indexing": {
    "autoIndex": true,
    "watchFiles": true,
    "maxFileSize": 262144,                 // 256KB
    "excludePatterns": []                  // Additional patterns beyond .parallxignore
  }
}
```

### `.parallx/rules/*.md` — Pattern-Scoped Rules

Each rule file applies to files matching a glob pattern:

```markdown
---
pattern: "*.test.ts"
---

When working with test files:
- Use vitest with describe/it syntax
- Use vi.mock() for mocking
- Test both success and error paths
- Use meaningful test descriptions
```

```markdown
---
pattern: "src/services/**"
---

Services follow the VS Code pattern:
- Interface in serviceTypes.ts, implementation in separate file
- Constructor takes dependency services via DI
- Always implement IDisposable if holding subscriptions
- Fire events via Emitter, expose as Event
```

### `.parallx/commands/*.md` — Slash Commands

User-defined prompt templates triggered by `/` in chat:

```markdown
---
name: review
description: Code review with checklist
---

Review the following code for:
1. Bugs and logic errors
2. Security vulnerabilities
3. Performance issues
4. Missing error handling
5. Naming and readability

{context}
```

```markdown
---
name: explain
description: Explain code in detail
---

Explain the following code. Include:
- What it does at a high level
- How the key parts work
- Any design patterns used
- Potential improvements

{context}
```

---

## Security Model

### Core Principle: Workspace Sandbox

The AI model MUST NOT:
- Read files outside the workspace root
- Write files outside the workspace root
- Execute commands that affect the system outside the workspace
- Make network requests (unless user explicitly enables cloud models)
- Access environment variables, credentials, or secrets
- Modify Parallx's own configuration without user approval

### Implementation: Three Permission Tiers

```
┌─────────────────────────────────────────────────┐
│         ALWAYS ALLOWED (no prompt)              │
│  Skills: search_workspace, search_knowledge,    │
│          read_file, list_files, read_page,      │
│          list_pages, get_page_properties,       │
│          read_current_page, read_page_by_title  │
│  Actions: Read files, search, list, RAG query   │
├─────────────────────────────────────────────────┤
│       REQUIRES APPROVAL (per action)            │
│  Skills: write_file, edit_file, delete_file,    │
│          create_page, run_command               │
│  Actions: Write/edit/delete files, terminal cmd │
│  UI: Diff preview → "Allow once" / "Allow for  │
│       session" / "Always allow"                 │
├─────────────────────────────────────────────────┤
│              NEVER ALLOWED                       │
│  • Access outside workspace root                │
│  • Access system files (/etc, C:\Windows, etc)  │
│  • Modify running processes                     │
│  • Network requests to arbitrary URLs           │
│  • Access other applications' data              │
│  • Read files matching .parallxignore           │
└─────────────────────────────────────────────────┘
```

### `.parallxignore`

Located at workspace root. Git-style patterns:
```
# Secrets
.env
.env.*
*.key
*.pem
*.p12
secrets/

# Dependencies
node_modules/
vendor/
.venv/

# Build output
dist/
build/
*.map

# Parallx internal
.parallx/permissions.json
```

### Path Validation

Every file operation passes through `WorkspaceBoundaryService.assertUriWithinWorkspace()` (already implemented). M11 adds `.parallxignore` pattern matching on top.

---

## Capability Map

### The 13 Capabilities

#### P0 — Critical (Chat is useless without these)

##### C1: RAG Context Injection into Chat

| Attribute | Value |
|---|---|
| **Status** | ⬜ Not started |
| **Priority** | P0 — #1 most important |
| **Complexity** | Medium |
| **Current state** | Indexing pipeline exists ✅, vector store exists ✅, `retrieveContext()` exists in `defaultParticipant.ts` ✅ but only used in some code paths |
| **Transform** | Wire `retrieveContext()` to execute on EVERY user message, not just when explicitly triggered. Format results as context with source attribution. |

**Implementation:**
1. In `_buildMessages()`, always call `retrieveContext(userMessage)` for the latest message
2. Format as: `"Relevant workspace context:\n\n--- File: path/to/file.ts ---\n{chunk}\n"`
3. Respect token budget (30% of context window for RAG)
4. De-duplicate against explicitly attached files
5. Show context pills in UI showing which files were auto-retrieved

---

##### C2: File Content Reading (Add Context works)

| Attribute | Value |
|---|---|
| **Status** | ⬜ Not started |
| **Priority** | P0 |
| **Complexity** | Low |
| **Current state** | `read_file` tool exists ✅, `FileService.readFile()` exists ✅, `readFileContent()` helper exists in defaultParticipant ✅ |
| **Transform** | Ensure "Add Context" button in chat UI fully reads file content (not just filename), inject with path header, show as removable pill |

---

##### C3: File Writing / Code Application

| Attribute | Value |
|---|---|
| **Status** | ⬜ Not started |
| **Priority** | P0 |
| **Complexity** | High |
| **Current state** | `FileService.writeFile()` exists ✅, `WorkspaceBoundaryService` exists ✅, no `write_file` or `edit_file` tools |
| **Transform** | Build `write_file` and `edit_file` skills with diff preview UI and 3-tier permission approval |

---

##### C4: System Prompt (Prompt File Layering)

| Attribute | Value |
|---|---|
| **Status** | ⬜ Not started |
| **Priority** | P0 |
| **Complexity** | Medium |
| **Current state** | `buildSystemPrompt()` exists ✅ — mode-aware, includes tool list and workspace stats. Single-layer, hardcoded. |
| **Transform** | Layer prompt files: Core Parallx prompt → `SOUL.md` → `AGENTS.md` → `TOOLS.md` → `.parallx/rules/*.md` (pattern-matched to active file). Build loader that reads these files and assembles the layered prompt. |

---

#### P1 — Important (Makes it genuinely useful)

##### C5: Conversation-Aware RAG (Re-retrieve per turn)

| Attribute | Value |
|---|---|
| **Status** | ⬜ Not started |
| **Priority** | P1 |
| **Complexity** | Medium |
| **Current state** | RAG retrieval exists but context may go stale across turns |
| **Transform** | Re-embed and re-search on EACH user message. Merge with previously injected context, de-duplicate. |

##### C6: @Mentions (`@file`, `@workspace`, `@folder`)

| Attribute | Value |
|---|---|
| **Status** | ⬜ Not started |
| **Priority** | P1 |
| **Complexity** | Medium |
| **Current state** | `@workspace` and `@canvas` participants exist ✅ but are separate participants, not inline mentions |
| **Transform** | Add `@` autocomplete in chat input → `@file:path`, `@folder:path`, `@workspace`, `@terminal`. Inject content inline. |

##### C7: Code Actions on Chat Responses

| Attribute | Value |
|---|---|
| **Status** | ⬜ Not started (only Copy exists) |
| **Priority** | P1 |
| **Current state** | Code blocks render with "Copy" button only |
| **Transform** | Add "Apply to File", "Create File", "Run in Terminal" buttons. Depends on C3 for Apply. |

##### C8: Terminal Integration

| Attribute | Value |
|---|---|
| **Status** | ⬜ Not started |
| **Priority** | P1 |
| **Complexity** | High |
| **Transform** | Phase 1: xterm.js terminal panel. Phase 2: `run_command` skill with approval dialog. |

##### C9: Streaming Token-by-Token Display

| Attribute | Value |
|---|---|
| **Status** | 🔶 Partially implemented |
| **Priority** | P1 |
| **Current state** | `_streamResponse()` exists, Ollama streaming works. Need to verify incremental UI rendering. |
| **Transform** | Verify token-by-token rendering, add typing indicator, stop button, progressive markdown. |

#### P2 — Polish (Makes it delightful)

| # | Capability | Notes |
|---|---|---|
| C10 | Conversation Search | Search across all past sessions by keyword or semantic similarity |
| C11 | Multi-File Context | Attach multiple files at once, token budget indicator per file |
| C12 | Prompt Templates / Slash Commands | `/explain`, `/fix`, `/test`, `/doc`, `/review` + user-defined in `.parallx/commands/` |
| C13 | Progress Indication | Typing indicator, elapsed time, token count, cancel button |

---

## Architecture Decisions

### AD1: Skill-Based Tool System (OpenClaw-inspired)

Rather than hardcoding capabilities, implement a **skill system** where each tool is a self-contained skill with a `SKILL.md` manifest.

```
                    ┌─────────────────────────────────────┐
                    │        Skill Registry                │
                    │   (LanguageModelToolsService)        │
                    │                                      │
                    │  ┌── Built-in Skills ──────────┐    │
                    │  │ search_workspace  read_file  │    │
                    │  │ list_files  read_page         │    │
                    │  │ search_knowledge  create_page │    │
                    │  │ write_file  edit_file          │    │
                    │  │ delete_file  run_command       │    │
                    │  └───────────────────────────────┘    │
                    │                                      │
                    │  ┌── Workspace Skills ─────────┐    │
                    │  │ .parallx/skills/*/SKILL.md   │    │
                    │  │ (user-defined, per-project)   │    │
                    │  └───────────────────────────────┘    │
                    │                                      │
                    │         Permission Manager            │
                    │  • Validates paths (sandbox)          │
                    │  • Checks .parallxignore              │
                    │  • 3-tier approval prompts            │
                    │  • Session-level grant cache          │
                    └─────────────────────────────────────┘
```

**How this transforms current code:**
- `builtInTools.ts` → each tool gets a co-located `SKILL.md` manifest
- `LanguageModelToolsService.registerTool()` → extended to accept skill metadata
- New: `SkillLoaderService` scans `.parallx/skills/` and registers workspace skills
- New: `TOOLS.md` auto-generated from all registered skill manifests

### AD2: Layered Prompt Assembly Pipeline

```
User Message
    │
    ▼
┌── Prompt Assembly ──────────────────────────────────┐
│                                                      │
│  Layer 1: Core Parallx prompt (hardcoded, ~200 tok) │
│  Layer 2: SOUL.md (identity/personality, ~300 tok)   │
│  Layer 3: AGENTS.md (project context, ~500 tok)      │
│  Layer 4: TOOLS.md (tool instructions, ~400 tok)     │
│  Layer 5: .parallx/rules/*.md (pattern-matched)      │
│  Layer 6: RAG results (auto-retrieved chunks)         │
│  Layer 7: Explicit @mentions / attachments            │
│  Layer 8: Memory context (recalled from past sessions)│
│  Layer 9: Conversation history                        │
│  Layer 10: User's current message                     │
│                                                      │
│  Token Budget Manager:                               │
│  ┌────────────────────────────────────────┐          │
│  │ System (L1-L5):  10% of context window │          │
│  │ RAG + mentions:  30% of context window │          │
│  │ History:         30% of context window │          │
│  │ User message:    30% of context window │          │
│  │ Overflow: trim history → trim RAG → fail│         │
│  └────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────┘
    │
    ▼
  Ollama /api/chat
```

**How this transforms current code:**
- `chatSystemPrompts.ts` → `promptAssemblyService.ts` (new service)
- `buildSystemPrompt()` → `assemblePrompt(layers, tokenBudget)` that reads all prompt files
- `defaultParticipant.ts` `_buildMessages()` → calls `promptAssemblyService.assemblePrompt()`

### AD3: `.parallx/` Workspace Configuration

```
workspace-root/
├── AGENTS.md            ← Project context for the agent
├── SOUL.md              ← Agent personality and constraints
├── TOOLS.md             ← Tool usage instructions (auto-gen)
├── .parallxignore       ← Files AI cannot access
└── .parallx/
    ├── config.json      ← AI settings (models, budget, etc.)
    ├── permissions.json ← Per-skill permission overrides
    ├── rules/
    │   ├── typescript.md  ← Rules for *.ts files
    │   └── testing.md     ← Rules for *.test.* files
    ├── commands/
    │   ├── explain.md     ← /explain prompt template
    │   ├── review.md      ← /review prompt template
    │   └── fix.md         ← /fix prompt template
    └── skills/
        └── custom-skill/
            └── SKILL.md   ← Workspace-specific skill
```

---

## Task Tracker

### How to Use This Tracker

- **Status symbols:** ⬜ Not started → 🔨 In progress → ✅ Complete → ❌ Blocked
- **Mark tasks complete** by changing ⬜ to ✅ and adding a completion date
- **Each task has enough context** to be worked on independently
- **Dependencies** are explicit — don't start a task if its dependencies aren't ✅

### Phase 1 — "The LLM Can See" (Foundation)

> Goal: The agent understands the project, speaks with the right personality, and always has relevant context.

| # | Task | Status | Est. | Depends On | Files to Change | What to Do |
|---|------|--------|------|------------|-----------------|------------|
| **1.1** | **Create prompt file loader service** | ✅ | 3h | — | New: `src/services/promptFileService.ts`, `src/services/serviceTypes.ts` | Service that reads `AGENTS.md`, `SOUL.md`, `TOOLS.md` from workspace root. Returns layered prompt text. Falls back to defaults if files don't exist. Watches files for changes. |
| **1.2** | **Ship default SOUL.md** | ✅ | 1h | — | New: `src/built-in/chat/defaults/SOUL.md` | Write the default Parallx personality prompt. Copied to workspace on `/init`. |
| **1.3** | **Ship default TOOLS.md template** | ✅ | 1h | 1.1 | New: `src/built-in/chat/defaults/TOOLS.md` | Template with placeholders for registered skills. Auto-generated at runtime. |
| **1.4** | **Wire prompt files into system prompt** | ✅ | 2h | 1.1 | `src/built-in/chat/chatSystemPrompts.ts`, `src/built-in/chat/participants/defaultParticipant.ts` | Modify `buildSystemPrompt()` to read prompt files via `promptFileService`. Layer: core → SOUL.md → AGENTS.md → TOOLS.md → rules/*.md |
| **1.5** | **Load `.parallx/rules/*.md` with pattern matching** | ✅ | 2h | 1.1 | `src/services/promptFileService.ts` | Parse frontmatter `pattern:` field, match against active file path, include matching rules in prompt |
| **1.6** | **Implement `/init` command** | ✅ | 3h | 1.1, 1.2 | `src/built-in/chat/participants/defaultParticipant.ts`, `src/services/promptFileService.ts` | Scan workspace: file tree structure, README, package.json, common config files. Generate `AGENTS.md` via LLM. Create `.parallx/` directory structure. Show notification. |
| **1.7** | **Wire RAG context into every message** | ✅ | 2h | — | `src/built-in/chat/participants/defaultParticipant.ts` | Ensure `retrieveContext()` is called for every user message in the agentic loop. Format results with source paths. De-duplicate against attachments. |
| **1.8** | **Token budget manager** | ✅ | 3h | 1.4 | New: `src/services/tokenBudgetService.ts`, `src/services/serviceTypes.ts` | Service that allocates context window: system 10%, RAG 30%, history 30%, user 30%. Takes prioritized content, trims overflow (history first, then RAG). |
| **1.9** | **`.parallxignore` file support** | ✅ | 2h | — | `src/services/indexingPipeline.ts`, `src/services/fileService.ts`, New: `.parallxignore` parser | Parse git-style ignore patterns from workspace-root `.parallxignore`. Apply to: indexing pipeline (skip files), `read_file` tool (block access), "Add Context" (block). Replace hardcoded `SKIP_DIRS`. |
| **1.10** | **Context pills UI** | ✅ | 3h | 1.7 | Chat widget CSS/HTML, `src/built-in/canvas/chat/` | Visual chips above chat input showing: auto-retrieved files (from RAG), attached files, token count per item. Removable by clicking X. |

**Phase 1 Total:** ~22h

### Phase 2 — "The LLM Can Act" (Write & Apply)

> Goal: The agent can modify files with user approval, show diffs, and manage permissions.

| # | Task | Status | Est. | Depends On | Files to Change | What to Do |
|---|------|--------|------|------------|-----------------|------------|
| **2.1** | **3-tier permission system** | ✅ | 4h | — | `src/services/languageModelToolsService.ts`, `src/services/chatTypes.ts`, New: `src/services/permissionService.ts` | Replace binary `requiresConfirmation` with 3 tiers: always-allowed, requires-approval, never-allowed. Add "Allow once" / "Allow for session" / "Always allow" to confirmation UI. Session-level grant cache. |
| **2.2** | **`write_file` skill** | ✅ | 4h | 2.1 | `src/built-in/chat/tools/builtInTools.ts`, New: `src/built-in/chat/skills/write-file/SKILL.md` | New tool: takes `path` + `content`, validates against sandbox + `.parallxignore`, shows diff preview, requires approval, writes via `FileService.writeFile()`. |
| **2.3** | **`edit_file` skill** | ✅ | 5h | 2.1 | `src/built-in/chat/tools/builtInTools.ts`, New: `src/built-in/chat/skills/edit-file/SKILL.md` | New tool: takes `path` + `oldContent` + `newContent` (search-replace), validates path, computes diff, shows preview, requires approval. Supports line-range edits. |
| **2.4** | **Diff computation engine** | ✅ | 4h | — | New: `src/services/diffService.ts` | Compute unified diff between two strings. Support line-level and word-level diffs. Output format usable by both the diff UI and the LLM. |
| **2.5** | **Diff review UI** | ✅ | 5h | 2.4 | Chat widget, New: diff viewer component | Inline or modal diff view: red (removed) / green (added) lines. "Accept" and "Reject" buttons. File path header. Shows token/line counts. |
| **2.6** | **Code action buttons on responses** | ✅ | 3h | 2.2 | Chat response rendering code | Parse code blocks for `// filepath:` headers. Add "Apply to File" button (triggers diff flow). Add "Create File" button. Add "Copy" button (already exists). |
| **2.7** | **SKILL.md manifests for existing tools** | ✅ | 3h | — | New: 11 `SKILL.md` files for each existing built-in tool | Write `SKILL.md` manifest for each of the 11 existing tools. Update `TOOLS.md` auto-generation to read from manifests. |
| **2.8** | **Skill loader service** | ✅ | 4h | 2.7 | New: `src/services/skillLoaderService.ts`, `src/services/serviceTypes.ts` | Scan `.parallx/skills/*/SKILL.md` on workspace open. Parse frontmatter. Register with tool service. Watch for changes. Re-generate `TOOLS.md` when skills change. |
| **2.9** | **`.parallx/config.json` loader** | ✅ | 2h | — | New: `src/services/parallxConfigService.ts` | Read and validate `.parallx/config.json`. Provide typed access to all settings. Watch for changes. Fall back to defaults. |
| **2.10** | **`.parallx/permissions.json` integration** | ✅ | 2h | 2.1, 2.9 | `src/services/permissionService.ts`, `src/services/parallxConfigService.ts` | Per-skill permission overrides. User can promote `write_file` to "always-allow" or demote `read_file` to "requires-approval". |

**Phase 2 Total:** ~36h

### Phase 3 — "The User Has Control" (Mentions, Commands, Precision)

> Goal: User can precisely control what context the LLM sees and trigger structured intents.

| # | Task | Status | Est. | Depends On | Files to Change | What to Do |
|---|------|--------|------|------------|-----------------|------------|
| **3.1** | **`@` autocomplete trigger in chat input** | ✅ | 3h | — | Chat input widget | Detect `@` keystroke in chat input, show dropdown with: file names (from workspace index), folder names, special scopes (@workspace, @terminal). Fuzzy search. |
| **3.2** | **`@file:` mention handler** | ✅ | 2h | 3.1, Phase 1 | `src/built-in/chat/participants/defaultParticipant.ts` | When user selects `@file:path/to/file.ts`, read file content via FileService, inject into message context, show as pill. |
| **3.3** | **`@folder:` mention handler** | ✅ | 2h | 3.1 | `src/built-in/chat/participants/defaultParticipant.ts` | Read all files in folder (respecting `.parallxignore`), inject with token budget, show as pill with file count. |
| **3.4** | **`@workspace` mention handler** | ✅ | 1h | 3.1, 1.7 | `src/built-in/chat/participants/defaultParticipant.ts` | Trigger full RAG search with user's message, inject top-K results. Different from auto-RAG: user is explicitly requesting broad context. |
| **3.5** | **Slash command parser** | ✅ | 2h | — | Chat input handling code | Detect `/` at start of message. Parse command name. Show autocomplete dropdown with built-in + user-defined commands. |
| **3.6** | **Built-in commands** | ✅ | 3h | 3.5 | `src/built-in/chat/participants/defaultParticipant.ts` | `/explain`, `/fix`, `/test`, `/doc`, `/review` — each wraps user's context in a structured prompt template. `/init` and `/compact` are special (1.6, 3.8). |
| **3.7** | **User-defined commands from `.parallx/commands/`** | ✅ | 2h | 3.5, 2.9 | `src/services/promptFileService.ts`, command parser | Read `.parallx/commands/*.md`, parse frontmatter (name, description), register as slash commands. `{context}` placeholder replaced with user's attached context. |
| **3.8** | **`/compact` command** | ✅ | 2h | 3.5 | `src/built-in/chat/participants/defaultParticipant.ts` | Trigger history summarization (logic already exists in `summarizeHistory()`). Replace old messages with summary. Show token savings. |
| **3.9** | **Per-turn RAG re-query** | ✅ | 2h | 1.7 | `src/built-in/chat/participants/defaultParticipant.ts` | On each user message, re-embed and re-search. Merge with previously injected context. Drop stale chunks if token budget is tight. |
| **3.10** | **Streaming polish** | ✅ | 3h | — | Chat response rendering | Verify token-by-token rendering works. Add typing indicator animation. Add stop/cancel button. Progressive markdown rendering (headings appear as they complete). |

**Phase 3 Total:** ~22h

### Phase 4 — "Full Jarvis" (Terminal, Search, Polish)

> Goal: Complete second brain experience with terminal, cross-session search, and UI polish.

| # | Task | Status | Est. | Depends On | Files to Change | What to Do |
|---|------|--------|------|------------|-----------------|------------|
| **4.1** | **Terminal panel (xterm.js)** | ✅ | 6h | — | New: terminal built-in tool, panel component | Add xterm.js terminal panel to bottom panel area. IPC bridge to spawn shell in Electron main process. Capture output. |
| **4.2** | **`@terminal` mention** | ✅ | 2h | 4.1, 3.1 | Chat input, terminal service | `@terminal` injects last N lines of terminal output into context. |
| **4.3** | **`run_command` skill** | ✅ | 4h | 4.1, 2.1 | `src/built-in/chat/tools/builtInTools.ts`, New: `SKILL.md` | AI suggests a command → approval dialog → execute in terminal → capture output → feed back to LLM. Allowlist/blocklist in config. Timeout. |
| **4.4** | **`delete_file` skill** | ✅ | 2h | 2.1 | `src/built-in/chat/tools/builtInTools.ts`, New: `SKILL.md` | Delete file with confirmation. Move to trash if OS supports it. |
| **4.5** | **Cross-session search** | ✅ | 4h | — | New: session search UI, `src/services/chatSessionPersistence.ts` | Full-text search across all past sessions. Results show session title + matching message preview + date. Click to open session. |
| **4.6** | **Semantic session search** | ✅ | 4h | 4.5 | `src/services/memoryService.ts`, search UI | Embed search query, find similar session summaries in vector store. "Find conversations about auth" → returns relevant sessions. |
| **4.7** | **Multi-file picker** | ✅ | 3h | Phase 1 | "Add Context" dialog | Multi-select file/folder picker. Token budget indicator per file. Drag-and-drop from explorer. |
| **4.8** | **Token budget transparency** | ✅ | 2h | 1.8 | Chat status bar area | Show breakdown: system prompt (X tok) + RAG (Y tok) + history (Z tok) + user (W tok). Update in real-time as context changes. |
| **4.9** | **Progress indication** | ✅ | 2h | — | Chat response rendering | Typing indicator animation, elapsed time counter, token count during generation, cancel button. |
| **4.10** | **System prompt viewer** | ✅ | 2h | 1.4 | Chat toolbar | Button to view the full assembled system prompt (all layers). Read-only modal. Helps users understand what the AI "knows". |

**Phase 4 Total:** ~31h

### Summary

| Phase | Tasks | Estimated Hours | Outcome |
|-------|-------|-----------------|---------|
| Phase 1 | 1.1–1.10 | ~22h | Agent understands project, has personality, auto-retrieves context |
| Phase 2 | 2.1–2.10 | ~36h | Agent can write/edit files with approval, skill system operational |
| Phase 3 | 3.1–3.10 | ~22h | User has precise context control, slash commands, streaming polish |
| Phase 4 | 4.1–4.10 | ~31h | Terminal, cross-session search, full polish |
| **Total** | **40 tasks** | **~111h** | **Complete second brain** |

---

## Implementation Order

```
Phase 1 — "The LLM Can See" (1.1 → 1.10)
  Prompt file loader → Default SOUL.md → TOOLS.md template → Wire into system prompt
  → Pattern-scoped rules → /init command → RAG wiring → Token budget → .parallxignore
  → Context pills

  Result: Agent speaks with the right personality, understands the project,
          auto-retrieves relevant context on every message.

Phase 2 — "The LLM Can Act" (2.1 → 2.10)
  Permission system → write_file → edit_file → Diff engine → Diff UI → Code actions
  → SKILL.md manifests → Skill loader → Config service → Permission config

  Result: Agent can suggest AND apply code changes with user approval.
          Skill system fully operational.

Phase 3 — "The User Has Control" (3.1 → 3.10)
  @mentions → @file → @folder → @workspace → Slash commands → Built-in commands
  → User commands → /compact → Per-turn RAG → Streaming polish

  Result: User can precisely control context and trigger structured intents.

Phase 4 — "Full Jarvis" (4.1 → 4.10)
  Terminal → @terminal → run_command → delete_file → Session search → Semantic search
  → Multi-file picker → Token transparency → Progress → System prompt viewer

  Result: Complete second brain experience.
```

---

## Post-Audit Hardening Pass

After all 40 tasks were marked ✅, a comprehensive quality audit was performed to identify runtime bugs, integration gaps, and architectural weaknesses. This section documents the fixes and improvements made during that hardening pass.

### Audit Bug Fixes (commit `1a7df47`)

A full audit of the M11 codebase identified ~30 issues across 13 categories. All were fixed in a single pass:

| # | Fix | Files Changed | What Was Wrong |
|---|-----|---------------|----------------|
| **H1** | **Pass `workspaceRoot` to `registerBuiltInTools()`** | `chatTool.ts`, `builtInTools.ts` | `delete_file` and `run_command` tools received `undefined` for workspace root — sandbox validation would fail |
| **H2** | **Wire code-action event listener in `chatWidget`** | `chatWidget.ts` | "Apply to File" buttons on code blocks dispatched `parallx-code-action` events, but nothing caught them — the diff flow never triggered |
| **H3** | **Wire mention and command providers in `setActiveWidget()`** | `chatTool.ts` | Mention provider (workspace file autocomplete) and slash command provider were never connected to the widget |
| **H4** | **Implement `listFolderFiles` helper** | `chatTool.ts` | `@folder:` mentions called `listFolderFiles()` which didn't exist — would crash at runtime |
| **H5** | **Implement `userCommandFileSystem` helper** | `chatTool.ts` | User-defined slash commands from `.parallx/commands/` had no file reader — commands would silently fail |
| **H6** | **Implement `/compact` handler** | `chatTool.ts`, `defaultParticipant.ts` | `/compact` summarized history but appended the summary instead of replacing old messages — context window kept growing |
| **H7** | **Fix excluded context pill IDs** | `defaultParticipant.ts` | `getExcludedContextIds()` was never wired — removed pills still appeared in the prompt |
| **H8** | **Fix token budget report** | `defaultParticipant.ts` | Budget report showed pre-trim token counts instead of post-trim actuals — misleading numbers |
| **H9** | **Wire session search** | `chatTool.ts`, `chatSessionSidebar.ts` | Sidebar search input existed but `_performSearch()` was a stub — searching did nothing |
| **H10** | **Instantiate SkillLoader, Config, Permission services** | `chatTool.ts` | Services were imported but never constructed — skill loading, config reading, and permission checks were dead code |
| **H11** | **Fix CSS selector mismatch** | `chatWidget.css` | `.parallx-chat-diff-line--equal` class was applied in JS but missing from CSS — diff equal lines had no styling |
| **H12** | **Fix token count property access** | `chatListRenderer.ts` | Token display read `.value` but the actual property was `.content` / `.code` — showed "undefined tokens" |
| **H13** | **Hoist `pills` array scope** | `defaultParticipant.ts` | `pills` was declared inside an `if` block but referenced outside it — would throw ReferenceError |

### Context Pill Crash Fix (commit `50f2a97`)

**Bug:** `DOMTokenList.add` threw an error: `"token provided ('parallx-chat-context-pill parallx-chat-context-pill--system') contains HTML space characters."`

**Root cause:** The `$()` DOM helper expects `tag.class1.class2` format (dot-separated), but `_createPill()` in `chatContextPills.ts` used `.join(' ')` (space-separated) for CSS modifier classes.

**Fix:** Changed `.join(' ')` to `.join('.')` at line 247 so the class string follows the `$()` convention.

### System Prompt Personality Overhaul (commit `5e2e804`)

**Problem:** The AI assistant was passive and always asked for explicit instructions before acting. Users expected Jarvis-like behavior — proactive, opinionated, anticipating needs.

**Changes to `chatSystemPrompts.ts`:**
- Rewrote `PARALLX_IDENTITY` to include personality directives: *"Act like a trusted co-pilot who anticipates needs"*, *"Never ask for clarification when you can make a reasonable assumption"*, *"Be opinionated — suggest the best approach, don't list options"*
- Updated all three mode prompts (Ask, Edit, Agent) with behavior rules tuned for the qwen2.5:32b-instruct model
- Removed over-cautious phrasing that caused the model to hedge instead of act

### Tool Chaining Prompt Guidance (commit `5b6ebde`)

**Problem:** The AI would call `list_files` and return filenames to the user instead of following up with `read_file` to actually read content. Small local models take the path of least resistance — one tool call, then stop.

**Changes:**
- Added "ALWAYS READ CONTENT" rules to Ask and Agent mode system prompts
- Updated `list_files` tool description: *"This only lists names — must follow up with read_file to see content"*
- Updated `read_file` tool description: *"Always read files before summarizing or explaining them"*
- These explicit instructions are necessary because small local models (unlike cloud GPT-4/Claude) don't infer multi-step workflows from context alone

### Workspace Digest Architecture (commit `4a6ddc9`)

**Problem:** The system prompt included numeric workspace stats (file count, page count) but zero information about WHAT existed. The AI had to discover everything via tool calls, making it feel slow and uninformed. Users expected it to "already know" the workspace.

**Solution — `getWorkspaceDigest()` pipeline:**

This is a significant architectural addition that pre-loads workspace knowledge into every system prompt (~2000 token budget).

```
Startup / Session Start
    │
    ▼
┌── getWorkspaceDigest() ────────────────────────────────┐
│                                                         │
│  1. Query DB for canvas page titles (limit 30)          │
│     → "Pages: Getting Started, Architecture Notes, ..." │
│                                                         │
│  2. Walk file tree (depth 3, max 80 entries)            │
│     → Skip: node_modules, .git, hidden dirs             │
│     → "Files:\n  src/\n    main.ts\n    services/\n..." │
│                                                         │
│  3. Read key files (first 500 chars each)               │
│     → README.md, SOUL.md, AGENTS.md, package.json       │
│     → "Key file previews:\n--- README.md ---\n..."      │
│                                                         │
│  Result: ~2000 tokens of structured workspace knowledge │
└─────────────────────────────────────────────────────────┘
    │
    ▼
ISystemPromptContext.workspaceDigest
    │
    ▼
appendWorkspaceStats() injects into system prompt
    │
    ▼
"YOU ALREADY KNOW THIS WORKSPACE" header + digest content
```

**Files changed:**
- `chatTool.ts` — Added `getWorkspaceDigest()` function and wired it into `defaultParticipantServices`
- `defaultParticipant.ts` — Added `getWorkspaceDigest?()` to `IDefaultParticipantServices`, calls it during prompt assembly
- `chatSystemPrompts.ts` — Added `workspaceDigest?: string` to `ISystemPromptContext`, injected via `appendWorkspaceStats()`. Ask and Agent mode prompts now say *"You already know this workspace — use this knowledge to answer without tool calls when possible"*

**Architectural insight:** Small local models (qwen2.5:32b-instruct) need both (a) explicit behavioral rules in the system prompt AND (b) pre-loaded context to avoid multi-step discovery. Cloud models can chain 5–10 tool calls naturally; local models take the path of least resistance and stop after 1–2 calls unless strongly guided.

### Commit Log

| Commit | Description | Files Changed |
|--------|-------------|---------------|
| `1a7df47` | M11 audit: fix bugs and wire missing integrations | 8 files, +409 −19 |
| `50f2a97` | Fix context pill classList crash (dot-join, not space-join) | 1 file |
| `5e2e804` | Rewrite system prompts with Jarvis-like personality | 1 file |
| `5b6ebde` | Add tool chaining guidance to system prompts and tool descriptions | 2 files |
| `4a6ddc9` | Add workspace digest pre-loading to system prompt pipeline | 3 files |

---

*This document is the living plan for Milestone 11. All 40 core tasks are ✅ complete. The post-audit hardening pass addressed runtime bugs, UX issues, and architectural gaps discovered during integration testing.*
