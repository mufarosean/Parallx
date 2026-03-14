# Parallx AI — User Guide

Everything AI in Parallx runs **locally on your machine** via [Ollama](https://ollama.com). No cloud. No API keys. No data leaves your computer.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Chat](#2-chat)
3. [AI Settings](#3-ai-settings)
4. [Prompt Files](#4-prompt-files)
5. [Tools & Skills](#5-tools--skills)
6. [Knowledge Search](#6-knowledge-search)
7. [Proactive Suggestions](#7-proactive-suggestions)
8. [Privacy & Permissions](#8-privacy--permissions)

---

## 1. Getting Started

### Prerequisites

1. **Install Ollama** — Download from [ollama.com](https://ollama.com) and start the server.
2. **Pull a model** — Run `ollama pull qwen2.5:32b-instruct` (or any model you prefer) in your terminal.
3. **Open a workspace folder** — File → Open Folder. The AI uses your workspace files as context.

Once Ollama is running with at least one model installed, the chat panel is ready.
If Ollama isn't running, Parallx shows setup guidance instead of error walls.

---

## 2. Chat

Open the chat panel from the **auxiliary bar** (right sidebar) or press the chat icon in the Activity Bar.

### Chat Modes

| Mode | What it does |
|------|-------------|
| **Ask** | Q&A — answers questions about your workspace, notes, and files. Read-only, no side effects. |
| **Edit** | Proposes changes to canvas pages — inserts, edits, deletes blocks. You accept or reject each change via a diff view. |
| **Agent** | Full autonomy — reads files, searches your knowledge base, writes files, runs terminal commands. Each action requires your approval. |

Switch modes with the **mode picker** dropdown in the chat input area.

### Context Controls

You control exactly what the AI sees:

- **@mentions** — Type `@` to autocomplete:
  - `@file:path/to/file.ts` — injects a specific file
  - `@folder:path/to/dir` — injects all files in a folder
  - `@workspace` — broad search across your entire workspace
  - `@terminal` — injects recent terminal output
- **Attachments** — Click "Add Context" to attach workspace files. Each shows its token cost.
- **Context pills** — Visual chips above the input showing everything in context. Click × to remove any.

### Slash Commands

Type `/` at the start of a message:

| Command | What it does |
|---------|-------------|
| `/explain` | Explain how selected code or a concept works |
| `/fix` | Find and fix problems in code |
| `/test` | Generate unit tests |
| `/doc` | Generate documentation or comments |
| `/review` | Code review with improvement suggestions |
| `/compact` | Summarize old conversation history to free up context space |
| `/init` | Scan your workspace and auto-generate an `AGENTS.md` project description |

You can also create your own slash commands (see [Prompt Files](#4-prompt-files)).

### Code Actions

When the AI responds with code blocks, you can:

- **Copy** — copy to clipboard
- **Apply to File** — shows a diff view; you approve or reject
- **Create File** — save as a new file
- **Run in Terminal** — execute the code block

### File Edit Review

When the AI proposes file changes (in Agent mode or via "Apply to File"):

- A side-by-side **diff view** shows exactly what will change (red = removed, green = added)
- You **Accept** or **Reject** each change
- Nothing is written to disk until you approve

### Sessions

- Chat sessions persist automatically (stored in your workspace database)
- Browse and search past sessions from the session sidebar
- Session titles are auto-generated
- After each response, **follow-up suggestion chips** offer natural next questions

### Model Picker

Use the **model dropdown** in the chat header to switch between your locally installed Ollama models at any time. Shows model name, parameter count, and quantization.

---

## 3. AI Settings

Access AI Settings from:
- **Activity Bar** icon
- **Keyboard:** `Ctrl+Shift+A`
- **Status bar:** click the `⚙ AI: Default` badge

The AI Settings panel controls how the AI thinks, speaks, and behaves — no config files needed.

Important boundary:

- AI Settings configures AI behavior and model policy.
- Workspace memory content does **not** live in AI Settings.
- Canonical memory lives in markdown files under `.parallx/memory/`.

### Persona

| Setting | What it controls |
|---------|-----------------|
| **Agent Name** | The name the AI uses (e.g., "Parallx AI", "Friday", "Atlas") |
| **Description** | One-line description of the persona |
| **Avatar** | Pick from 12 emoji icons: 🧠 💼 ✍️ 💰 🔬 📊 🎯 🤖 🦊 🌊 ⚡ 🧩 |

### Chat Behavior

| Setting | Options | What it controls |
|---------|---------|-----------------|
| **Response Length** | Short · Medium · Long · **Adaptive** | How verbose the AI is. Adaptive matches length to question complexity. |
| **Communication Tone** | Concise · **Balanced** · Detailed | How much explanation and detail the AI provides |
| **Domain Focus** | General · Finance · Writing · Coding · Research · Custom | What the AI pays special attention to |
| **System Prompt** | Auto-generated or custom | The raw instruction the AI receives. Auto-updates when you change settings above. Toggle "Override" to write your own. |

### Suggestions

| Setting | Default | What it controls |
|---------|---------|-----------------|
| **Proactive Suggestions** | ON | Whether the AI surfaces suggestions about your workspace |
| **Confidence Threshold** | 65% | How confident the AI must be before showing a suggestion (lower = more suggestions) |
| **Backlog Limit** | 5 | Maximum suggestion cards visible at once |

### Model

| Setting | Default | What it controls |
|---------|---------|-----------------|
| **Temperature** | 0.7 | Creativity dial — from Precise (0.0) through Balanced (0.5) to Creative (1.0) |
| **Max Tokens** | Model default | Hard cap on response length |
| **Context Window** | Model default | How much conversation history the model can see |

### Advanced

- **Export Profile** — Download your current settings as a `.json` file
- **Import Profile** — Load a `.json` profile (validates and fills any missing fields)
- **Reset All** — Factory-reset the active profile to defaults
- **Prompt Preview** — Read-only view of the effective system prompt

### Persona Presets

Parallx ships with three built-in presets:

| Preset | Avatar | Tone | Focus | Temperature |
|--------|--------|------|-------|-------------|
| **Default** | 🧠 | Balanced | General | 0.7 |
| **Finance Focus** | 💰 | Concise | Finance | 0.7 |
| **Creative Mode** | ✍️ | Detailed | Writing | 0.9 |

**Built-in presets are read-only.** If you change any setting on a built-in preset, Parallx automatically creates a copy (e.g., "Default (Modified)") so the original is preserved.

You can also:
- **Create custom presets** — cloned from the active profile
- **Rename** or **delete** custom presets (right-click)
- **Reset individual fields** — hover over any setting to see the reset (↺) icon

### Preview Panel

Test your settings before committing:
1. Type a message (or click a starter chip: *"Hello, who are you?"*, *"Summarize what you know about me."*, *"What should I work on today?"*)
2. Click **Run** — the AI responds using your current settings
3. Click **Open in chat** to start a real conversation from the preview

### Workspace Memory Files

Parallx stores canonical workspace memory in markdown files, following the
OpenClaw-style model:

| File | Purpose |
|------|---------|
| `.parallx/memory/MEMORY.md` | Durable memory — curated preferences, decisions, conventions, and durable facts |
| `.parallx/memory/YYYY-MM-DD.md` | Daily memory log — day-scoped notes and session summaries |

You can open these directly from the command palette:

- `Parallx: Open Durable Memory`
- `Parallx: Open Today's Memory Log`

You can also access the `.parallx` folder directly in the Explorer whenever you
want to inspect or edit memory files by hand.

If you opened a workspace that predates canonical markdown memory, Parallx will
import legacy memory records into these markdown files and continue using the
markdown files as the source of truth.

---

## 4. Prompt Files

Parallx assembles the AI's instructions from layered markdown files in your workspace. You can edit any of them.

### SOUL.md — Personality

**Location:** Workspace root

Defines the AI's identity, tone, and constraints. Ships with sensible defaults:
- Direct and concise personality
- Rules like "never hallucinate file contents" and "only access files within this workspace"
- Response style guidelines (code blocks with language tags, relative file paths, etc.)

Edit `SOUL.md` to change how the AI speaks and behaves across your entire workspace.

### AGENTS.md — Project Context

**Location:** Workspace root

Tells the AI about your project — architecture, conventions, important files, build instructions.

**Quick start:** Type `/init` in the chat. Parallx scans your workspace and generates `AGENTS.md` automatically. You can then edit it.

### TOOLS.md — Tool Instructions

**Location:** Workspace root

Documents the available tools and usage guidelines. Auto-generated from registered skills. Override by creating your own `TOOLS.md`.

### .parallx/rules/*.md — Scoped Rules

**Location:** `.parallx/rules/` directory

Pattern-scoped rules injected only when the active file matches. Each file uses YAML frontmatter with a `pattern:` glob.

**Example** — `.parallx/rules/testing.md`:
```yaml
---
pattern: "*.test.ts"
---
When working with test files:
- Use vitest with describe/it syntax
- Mock external dependencies
- Test behavior, not implementation
```

### .parallx/commands/*.md — Custom Slash Commands

**Location:** `.parallx/commands/` directory

Define your own `/commands`. Each file has YAML frontmatter with `name:` and `description:`, plus a prompt template body. Use `{context}` as a placeholder for attached context.

**Example** — `.parallx/commands/summarize.md`:
```yaml
---
name: summarize
description: Summarize the attached content in 3 bullet points
---
Summarize the following content in exactly 3 concise bullet points:

{context}
```

### How It All Fits Together

When you send a message, Parallx assembles the full prompt in this order:

1. Core Parallx identity
2. `SOUL.md` (personality)
3. `AGENTS.md` (project context)
4. `TOOLS.md` (tool instructions)
5. Matching `.parallx/rules/*.md` (scoped to active file)
6. Auto-retrieved RAG results (relevant chunks from your workspace)
7. Your @mentions and attachments
8. Conversation history
9. Your message

You can view the fully assembled prompt at any time by clicking **View System Prompt** in the chat toolbar.

---

## 5. Tools & Skills

In **Agent mode**, the AI can use tools to take actions on your behalf.

### Built-in Tools

| Tool | What it does | Approval needed? |
|------|-------------|-----------------|
| `search_workspace` | Full-text search across canvas pages | No |
| `read_page` | Read a canvas page by ID | No |
| `read_page_by_title` | Find and read a page by title | No |
| `read_current_page` | Read the currently open page | No |
| `list_pages` | List all canvas pages | No |
| `get_page_properties` | Get page metadata (icon, cover, dates) | No |
| `create_page` | Create a new canvas page | **Yes** |
| `list_files` | List directory contents | No |
| `read_file` | Read file contents (supports line ranges) | No |
| `search_files` | Search across workspace files | No |
| `search_knowledge` | Semantic search using embeddings | No |
| `write_file` | Write to a file (shows diff preview) | **Yes** |
| `edit_file` | Search-replace or line-range edits (shows diff) | **Yes** |
| `delete_file` | Delete a file | **Yes** |
| `run_command` | Execute a shell command in the terminal | **Yes** |

### Custom Workspace Skills

Create project-specific tools by adding skill definitions to `.parallx/skills/`:

```
.parallx/
└── skills/
    └── my-skill/
        └── SKILL.md    # Manifest with YAML frontmatter + usage guide
```

Parallx discovers workspace skills automatically, registers them as available tools, and updates `TOOLS.md`.

### Tool Picker

In the chat input area, view all available tools and toggle individual tools on/off per conversation.

### The Agentic Loop

In Agent mode, the AI can chain multiple tools in a single request:

1. AI decides to call a tool (e.g., `search_files`)
2. You approve (or it runs automatically if always-allowed)
3. Tool result is fed back to the AI
4. AI decides the next step (another tool, or a final answer)
5. Repeat (up to 10 iterations by default, configurable in `.parallx/config.json`)

---

## 6. Knowledge Search

Parallx automatically indexes your workspace (canvas pages and files) using vector embeddings. This powers two things:

### Automatic RAG

On **every** message you send, Parallx automatically retrieves relevant content from your workspace and injects it into the AI's context. You see the retrieved chunks as context pills above the input. This happens transparently — you don't need to do anything.

### Explicit Search

- **`@workspace`** — Type this in your message for a comprehensive search across your entire workspace
- **`search_knowledge`** — In Agent mode, the AI can invoke semantic search itself as part of multi-step reasoning

### Workspace Digest

Every conversation starts with a pre-computed digest of your workspace (~2000 tokens):
- Canvas page titles
- File tree (3 levels deep)
- Key file previews (README.md, SOUL.md, AGENTS.md, package.json)

The AI "already knows" your workspace structure without needing to search first.

### Token Budget

Parallx manages a context budget so nothing gets silently truncated:

| Category | Budget | What it includes |
|----------|--------|-----------------|
| System | 10% | Identity, personality, tools |
| RAG | 30% | Auto-retrieved workspace content |
| History | 30% | Previous conversation turns |
| User | 30% | Your current message + attachments |

When a category exceeds its budget, Parallx trims the lowest-priority items first.

---

## 7. Proactive Suggestions

Parallx analyzes your workspace content and surfaces suggestions as dismissable cards. This runs entirely on embeddings — no LLM calls.

### Suggestion Types

| Type | What it means |
|------|--------------|
| **Consolidate** | Two or more pages cover similar topics — consider merging |
| **Orphan** | A page is isolated with no related pages — consider linking it |
| **Coverage Gap** | A topic is mentioned frequently but has no dedicated page |

### Configuring Suggestions

In AI Settings → Suggestions:
- **Toggle on/off** — disable entirely if you find them distracting
- **Confidence threshold** — raise it to see fewer but higher-quality suggestions; lower it to see more
- **Backlog limit** — cap how many cards are visible at once

---

## 8. Privacy & Permissions

### Everything Is Local

- AI inference runs on **your machine** via Ollama
- Your files, notes, and conversations **never leave your computer**
- No telemetry, no cloud sync, no API keys

### Three Permission Tiers

| Tier | What happens | Examples |
|------|-------------|---------|
| **Always Allowed** | Tool runs silently | Reading files, searching, listing pages |
| **Requires Approval** | You see a confirmation dialog with Accept / Reject | Writing files, deleting, running commands |
| **Never Allowed** | Blocked silently | Accessing files outside your workspace, system files |

When a tool requires approval, you see three options:
- **Allow once** — just this time
- **Allow for session** — skip approval for the rest of this session
- **Always allow** — never ask again for this tool

### Customizing Permissions

Edit `.parallx/permissions.json` to promote or demote any tool:
```json
{
  "write_file": "always-allowed",
  "read_file": "requires-approval"
}
```

### .parallxignore — Blocking AI Access

Create a `.parallxignore` file at your workspace root (same syntax as `.gitignore`):

```gitignore
# Secrets
.env
.env.*
*.key
*.pem
secrets/

# Large/irrelevant directories
node_modules/
dist/
build/
```

Files matching these patterns are:
1. **Not indexed** — the AI can't find them via search
2. **Not readable** — tools like `read_file` and `search_files` are blocked
3. **Not attachable** — "Add Context" won't let you attach them

### Workspace Sandbox

The AI can **never** access files outside your open workspace folder. Every file path is validated by the Workspace Boundary Service before any read, write, or execute operation.

---

## Configuration Reference

### .parallx/config.json

```json
{
  "models": {
    "chatModel": "qwen2.5:32b-instruct",
    "embeddingModel": "nomic-embed-text",
    "contextLength": 32768
  },
  "agent": {
    "maxIterations": 10,
    "autoRag": true,
    "ragTopK": 5,
    "ragScoreThreshold": 0.3
  },
  "indexing": {
    "autoIndex": true,
    "watchFiles": true,
    "maxFileSize": 1048576,
    "excludePatterns": ["node_modules", "dist"]
  }
}
```

### Key Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+A` | Open AI Settings |
| `Ctrl+L` | Focus chat input |
| `Ctrl+Shift+P` | Command Palette (type "AI" to filter) |
| `/` | Slash command autocomplete (in chat) |
| `@` | Context mention autocomplete (in chat) |
| `Escape` | Stop AI generation |
