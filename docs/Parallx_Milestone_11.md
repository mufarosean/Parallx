# Milestone 11: Second Brain — From Chat Widget to Jarvis

## Research Document — March 2, 2026

---

## Table of Contents

1. [Vision](#vision)
2. [Research: How Others Do It](#research-how-others-do-it)
3. [Security Model](#security-model)
4. [Capability Map](#capability-map)
5. [Task Tracker](#task-tracker)
6. [Architecture Decisions](#architecture-decisions)
7. [User Control & Prompt Files](#user-control--prompt-files)
8. [Setup & Configuration Vision](#setup--configuration-vision)

---

## Vision

**What Parallx should feel like:**

> You open your workspace. Parallx already knows every file, every structure, every pattern. You ask "what does the auth system do?" and it pulls the relevant files, explains the architecture, and offers to improve it. You say "add rate limiting to the API routes" and it reads the codebase, writes the code, shows you a diff, and applies it when you approve. You paste a terminal error and it diagnoses it instantly using your actual code. It never touches anything outside your workspace. It never phones home. It's YOUR brain extension, running on YOUR hardware.

**What Parallx is NOT:**

- Not a cloud service — everything runs locally via Ollama
- Not an autonomous agent with unsupervised access — every destructive action requires user approval
- Not a data collector — zero telemetry, zero external calls (unless user explicitly enables cloud models)

---

## Research: How Others Do It

### VS Code Copilot (GitHub Copilot Chat)

**Architecture:**
- Cloud-based — sends code to GitHub/OpenAI servers
- Uses GPT-4/Claude via API, not local models
- Tight editor integration via VS Code extension API

**Key capabilities we should learn from:**

| Feature | How It Works | Parallx Equivalent |
|---|---|---|
| `@workspace` | Embeds workspace files, uses RAG to find relevant code | We have indexing but retrieval is disconnected from chat |
| `@file` mentions | User types `@filename.ts`, content is injected into prompt | Not implemented |
| `@terminal` | Reads last terminal output, injects into context | Not implemented |
| Inline chat (`Ctrl+I`) | Opens chat inline in editor, edits code in-place | Not implemented (no editor) |
| Code actions | "Apply", "Insert", "Copy" buttons on code blocks | Only "Copy" exists |
| System prompt | Hidden system prompt with workspace info, capabilities, formatting rules | Missing entirely |
| Slash commands | `/explain`, `/fix`, `/test`, `/doc` — structured intents | Not implemented |
| Participant API | Extensions can register chat participants (`@docker`, `@azure`) | No extension system yet |
| Streaming | Token-by-token rendering with cursor animation | Streaming exists but rendering may not be incremental |
| Multi-turn context | Conversation history maintained per session, RAG re-queried per turn | Sessions exist but no per-turn RAG |

**Security model:**
- Code sent to cloud (the thing we explicitly avoid)
- Content exclusion policies via `.copilotignore`
- Organization-level policy controls

### Cursor

**Architecture:**
- Fork of VS Code with deeply integrated AI
- Uses cloud models (GPT-4, Claude) + local model support
- Custom diff/apply engine

**Key capabilities:**

| Feature | How It Works | Relevance to Parallx |
|---|---|---|
| Codebase indexing | Embeds entire repo, re-indexes on file change | We have this ✅ |
| `@codebase` | Semantic search across workspace, injects top-K chunks | We have embeddings but not the retrieval→chat bridge |
| `@file`, `@folder`, `@code` | Explicit context injection | Not implemented |
| Composer | Multi-file edit agent — reads codebase, plans edits, applies across files | Not implemented |
| Cmd+K inline edit | Select code → describe change → see diff → accept/reject | Not implemented (no editor) |
| Apply button | Parses code blocks, computes diff against target file, shows unified diff | Not implemented |
| `.cursorrules` | User-defined rules file in workspace root — injected into every prompt | Not implemented — we should do this |
| Context pills | Visual chips showing what's in context (files, docs, web results) | Not implemented |
| Tab completion | Ghost text autocomplete in editor | Not applicable (no code editor) |

**Security model:**
- Privacy mode (no code stored on servers)
- SOC 2 Type II certified
- `.cursorignore` for file exclusion

### Continue.dev (Open Source)

**Architecture:**
- Open-source VS Code extension
- Supports local models (Ollama, LM Studio) + cloud
- Model-agnostic — works with any OpenAI-compatible API

**Key capabilities:**

| Feature | How It Works | Relevance to Parallx |
|---|---|---|
| Local-first | Ollama integration out of the box | We have this ✅ |
| `@file`, `@folder`, `@codebase` | Context providers — modular system for injecting context | Good architecture to learn from |
| `.continue/config.json` | Full configuration — models, context providers, slash commands | We need user-configurable prompts |
| `.continue/rules/` | Directory of rule files, each scoped to file patterns | Excellent pattern for `.parallx/rules/` |
| Custom slash commands | User-defined in config, can reference prompt templates | We should implement this |
| Context providers | Pluggable system — files, URLs, terminal, Git diff, database | Good extensibility model |
| Prompt files (`.prompt`) | Markdown files with frontmatter that define reusable prompts | We should adopt this pattern |
| Codebase retrieval | Embeddings + reranking via local models | We have embeddings, need reranking |
| Streaming | Token-by-token with markdown rendering | Need to verify our streaming renders incrementally |

**Security model:**
- Fully local option — zero data leaves machine
- Config is per-workspace — different rules for different projects
- No telemetry in local mode

### Claw (OpenClaw)

**Architecture:**
- Autonomous coding agent running in terminal
- Uses Claude as the AI backbone (cloud-based, but model-agnostic forks exist)
- Tool-use architecture — the LLM decides which tools to call

**Key capabilities (THIS IS THE GOLD STANDARD FOR AGENTIC BEHAVIOR):**

| Feature | How It Works | Relevance to Parallx |
|---|---|---|
| Tool use | LLM has defined tools: `read_file`, `write_file`, `search`, `terminal`, `browser` | We need a tool system |
| `read_file` | Reads file content, supports line ranges | We need this |
| `write_file` / `edit_file` | Writes/patches files with diff application | We need this (with approval) |
| `search` (ripgrep) | Fast text search across codebase | We should add this |
| `terminal` | Runs shell commands, reads output | We need this (sandboxed) |
| `browser` | Headless browser for docs/web | Out of scope for now |
| Permission system | "Allow once", "Allow for session", "Always allow" per tool per action | **Critical for our security model** |
| `CLAUDE.md` | Workspace-level prompt file — injected into every conversation | We should do `.parallx/prompt.md` |
| `/init` command | Scans codebase and auto-generates `CLAUDE.md` | We should auto-generate initial prompt |
| Multi-turn planning | LLM plans multi-step changes, executes tools sequentially | Future goal |
| Diff review | Shows unified diff before applying changes, user approves | Essential for file writes |
| Memory | Persistent facts across sessions (stored in `CLAUDE.md`) | We should support this |
| Cost tracking | Shows API cost per conversation | We show tokens — equivalent for local |
| Max turns | Configurable limit on autonomous actions | Safety feature we should adopt |
| Compact mode | Summarizes old context to fit more in window | Smart context management |

**Security model:**
- Permission prompt for EVERY file write and terminal command
- Workspace sandbox — tools can only access files within the project
- `.clawignore` for file/directory exclusion
- Configurable allowed/denied commands
- No network access unless explicitly granted

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

### Implementation: Permission Tiers

```
┌─────────────────────────────────────────────────┐
│              ALWAYS ALLOWED (no prompt)          │
│  • Read files within workspace                  │
│  • Search within workspace                      │
│  • Read conversation history                    │
│  • Access indexed embeddings                    │
│  • Read .parallx/ configuration                 │
├─────────────────────────────────────────────────┤
│         REQUIRES APPROVAL (per action)          │
│  • Write/edit files within workspace            │
│  • Create new files within workspace            │
│  • Delete files within workspace                │
│  • Run terminal commands                        │
├─────────────────────────────────────────────────┤
│              NEVER ALLOWED                       │
│  • Access outside workspace root                │
│  • Access system files (/etc, C:\Windows, etc)  │
│  • Modify running processes                     │
│  • Network requests to arbitrary URLs           │
│  • Access other applications' data              │
└─────────────────────────────────────────────────┘
```

### Path Validation

Every file operation MUST pass through a path validator:
```
function validatePath(requestedPath: string, workspaceRoot: string): boolean {
    const resolved = path.resolve(workspaceRoot, requestedPath);
    return resolved.startsWith(path.resolve(workspaceRoot));
    // Prevents: ../../../etc/passwd, symlink escapes, etc.
}
```

### `.parallxignore`

Like `.gitignore` — files/patterns the AI cannot read or index:
```
# .parallxignore
.env
*.key
*.pem
secrets/
node_modules/
```

---

## Capability Map

### The 13 Capabilities

Each capability is categorized by priority, complexity, and dependency.

#### 🔴 P0 — Critical (Chat is useless without these)

##### C1: RAG Context Injection into Chat

| Attribute | Value |
|---|---|
| **Status** | ⬜ Not started |
| **Priority** | P0 — #1 most important |
| **Complexity** | Medium |
| **Dependencies** | Indexing pipeline (exists ✅), Vector store (exists ✅) |
| **Description** | When the user sends a message, embed the query, retrieve top-K relevant chunks from the vector store, and inject them into the prompt before sending to the LLM. |

**How VS Code does it:** `@workspace` triggers embedding of the query → vector search → top 10 chunks injected as system context with source file paths.

**How Claw does it:** `search` tool is called by the LLM itself when it needs context. Results are injected as tool responses.

**Our approach:** Hybrid — automatic RAG on every message (like VS Code) + explicit `@workspace` and `@file` for user control (like Cursor). The LLM should always have relevant context without the user needing to ask.

**Implementation plan:**
1. In `_buildMessages()`, embed the user's latest message
2. Call `vectorStoreService.search()` with the embedding
3. Format results as a system message: file path + chunk content
4. Insert before the user message in the prompt
5. De-duplicate if user also manually attached the same file
6. Show "context pills" in the UI indicating which files were retrieved

---

##### C2: File Content Reading (Add Context actually works)

| Attribute | Value |
|---|---|
| **Status** | ⬜ Not started |
| **Priority** | P0 |
| **Complexity** | Low |
| **Dependencies** | File service (exists ✅) |
| **Description** | When user clicks "Add Context" or types `@filename`, read the actual file content and inject it into the prompt. Currently only adds a filename string. |

**How others do it:** All tools (Copilot, Cursor, Continue, Claw) read the full file content. Large files are truncated or chunked. A header like `--- File: src/main.ts ---` wraps the content.

**Our approach:**
1. `_handleAddContext()` reads file via `fileService.readFile()`
2. Content wrapped with path header and injected as context
3. Token count updated to reflect added content
4. Visual "pill" shown in input area (removable)
5. Files matching `.parallxignore` are blocked with a message

---

##### C3: File Writing / Code Application

| Attribute | Value |
|---|---|
| **Status** | ⬜ Not started |
| **Priority** | P0 |
| **Complexity** | High |
| **Dependencies** | File service (exists ✅), Security model, Diff engine (new) |
| **Description** | When the LLM outputs a code block targeting a file, provide "Apply" button that computes a diff, shows it for review, and writes on approval. |

**How Claw does it:**
- LLM calls `write_file` or `edit_file` tool
- `edit_file` uses a search/replace block format
- User sees the diff and approves/rejects
- Permission system: "Allow once", "Allow for session", "Always allow"

**How Cursor does it:**
- Composer mode: LLM plans multi-file edits
- Each edit shown as unified diff
- "Accept All" / "Reject All" / per-file accept/reject
- Edits applied atomically

**Our approach:**
1. Parse code blocks in LLM response — detect `// filepath:` comments
2. "Apply" button on code blocks with a file path
3. Compute unified diff between current file content and proposed content
4. Show diff view (red/green lines) in a modal or inline
5. "Accept" writes to disk, "Reject" dismisses
6. All writes pass through path validator (workspace sandbox)
7. Permission prompt with "Allow once" / "Allow for session" options

---

##### C4: System Prompt

| Attribute | Value |
|---|---|
| **Status** | ⬜ Not started |
| **Priority** | P0 |
| **Complexity** | Low |
| **Dependencies** | None |
| **Description** | Every conversation needs a system prompt that orients the LLM: who it is, what workspace it's in, what tools it has, how to format responses. |

**How Claw does it:**
```
You are Claw, an AI assistant. You are working in: /path/to/workspace
Available tools: read_file, write_file, search, terminal
Rules from CLAUDE.md: [user-defined rules injected here]
```

**Our approach — layered system prompt:**
```
Layer 1 (Parallx core — not user-editable):
  "You are Parallx, a local AI assistant. You are helping the user
   with their workspace at: {workspaceRoot}. All your knowledge about
   their project comes from the files provided in context."

Layer 2 (.parallx/prompt.md — user-editable):
  User-defined rules, preferences, project description.
  Auto-generated on first run with /init command.

Layer 3 (.parallx/rules/*.md — user-editable, pattern-scoped):
  "When working with *.test.ts files, use vitest and describe/it syntax."
  "When working with *.py files, use type hints and follow PEP 8."

Layer 4 (Auto-injected context):
  "The following files are relevant to the user's question:
   [RAG results here]"
```

---

#### 🟡 P1 — Important (Makes it genuinely useful)

##### C5: Conversation-Aware RAG (Re-retrieve per turn)

| Attribute | Value |
|---|---|
| **Status** | ⬜ Not started |
| **Priority** | P1 |
| **Complexity** | Medium |
| **Dependencies** | C1 (RAG injection) |
| **Description** | Re-run vector search on each new message, not just the first one. As conversation evolves, the relevant context changes. |

**Implementation:**
1. On each user message, re-embed and re-search
2. Merge new results with previously-injected context (de-duplicate)
3. If context window is getting full, drop oldest retrieved chunks first
4. Show updated context pills

---

##### C6: @Mentions (`@file`, `@workspace`, `@folder`)

| Attribute | Value |
|---|---|
| **Status** | ⬜ Not started |
| **Priority** | P1 |
| **Complexity** | Medium |
| **Dependencies** | C2 (file reading) |
| **Description** | Inline mention system in the chat input. Type `@` to get autocomplete for files, folders, and special scopes. |

**Mention types:**
- `@file:path/to/file.ts` — inject full file content
- `@folder:src/utils/` — inject all files in folder (with token budget)
- `@workspace` — trigger full RAG search
- `@selection` — inject currently selected text (future, when we have an editor)
- `@terminal` — inject last terminal output (future)

**UI:** Autocomplete dropdown on `@` keystroke, visual pills for active mentions.

---

##### C7: Code Actions on Chat Responses

| Attribute | Value |
|---|---|
| **Status** | ⬜ Not started (only Copy exists) |
| **Priority** | P1 |
| **Complexity** | Medium |
| **Dependencies** | C3 (file writing) for "Apply" |
| **Description** | Action buttons on code blocks in LLM responses. |

**Actions:**
- **Copy** ✅ (exists)
- **Apply to File** — if code block has `// filepath:` header, apply as diff
- **Create File** — save code block as a new file (path picker)
- **Insert at Cursor** — future, when we have an editor
- **Run in Terminal** — future, when we have terminal integration

---

##### C8: Terminal Integration

| Attribute | Value |
|---|---|
| **Status** | ⬜ Not started |
| **Priority** | P1 |
| **Complexity** | High |
| **Dependencies** | Security model (command sandboxing) |
| **Description** | Ability to run commands and read output. |

**Claw's approach:**
- `terminal` tool with `command` parameter
- Output captured and returned to LLM
- User must approve each command
- Allowed/blocked command patterns configurable
- Timeout on long-running commands

**Our approach (Phase 1 — read only):**
1. Add a terminal panel (xterm.js) to the bottom panel area
2. Capture command output
3. `@terminal` mention injects last N lines of output into context
4. No AI-initiated commands in Phase 1

**Our approach (Phase 2 — AI can suggest commands):**
1. LLM can suggest a command in a special format
2. Command shown in a "Run this?" approval dialog
3. User approves → command runs in terminal → output captured → fed back to LLM
4. Command allowlist/blocklist in `.parallx/config.json`

---

##### C9: Streaming Token-by-Token Display

| Attribute | Value |
|---|---|
| **Status** | 🔶 Partially implemented |
| **Priority** | P1 |
| **Complexity** | Low-Medium |
| **Dependencies** | None |
| **Description** | Verify and fix that LLM responses render incrementally as tokens arrive, with proper markdown rendering during streaming. |

**Current state:** `_streamResponse()` exists and processes the Ollama stream. Need to verify the UI updates incrementally and doesn't wait for completion.

**Requirements:**
1. Token-by-token rendering (not buffered)
2. Markdown rendered progressively (headings, bold, code blocks appear as they complete)
3. Cursor/typing indicator during generation
4. "Stop" button to cancel mid-generation
5. Smooth scrolling to follow new content

---

#### 🟢 P2 — Polish (Makes it delightful)

##### C10: Conversation Search

| Attribute | Value |
|---|---|
| **Status** | ⬜ Not started |
| **Priority** | P2 |
| **Complexity** | Medium |
| **Dependencies** | Session storage (exists ✅) |
| **Description** | Search across all past sessions by keyword or semantic similarity. |

---

##### C11: Multi-File Context

| Attribute | Value |
|---|---|
| **Status** | ⬜ Not started |
| **Priority** | P2 |
| **Complexity** | Low |
| **Dependencies** | C2 (file reading) |
| **Description** | Attach multiple files at once. File/folder picker with multi-select. Token budget indicator showing how much context each file consumes. |

---

##### C12: Prompt Templates / Slash Commands

| Attribute | Value |
|---|---|
| **Status** | ⬜ Not started |
| **Priority** | P2 |
| **Complexity** | Medium |
| **Dependencies** | C4 (system prompt) |
| **Description** | `/explain`, `/fix`, `/test`, `/doc`, `/review` + user-defined commands in `.parallx/commands/`. |

**Built-in commands:**
- `/explain` — "Explain the following code in detail"
- `/fix` — "Find and fix bugs in the following code"
- `/test` — "Generate unit tests for the following code"
- `/doc` — "Generate documentation for the following code"
- `/review` — "Review this code for issues, security, and improvements"
- `/init` — Scan workspace, generate `.parallx/prompt.md`
- `/compact` — Summarize conversation to free context window space

**User-defined commands:**
```markdown
<!-- .parallx/commands/deploy-check.md -->
---
name: deploy-check
description: Pre-deployment checklist
---
Review the following changes for production readiness:
1. Are there any console.log statements?
2. Are error cases handled?
3. Are there any hardcoded values?
4. Is input validated?

{selection}
```

---

##### C13: Progress Indication During LLM Response

| Attribute | Value |
|---|---|
| **Status** | ⬜ Not started |
| **Priority** | P2 |
| **Complexity** | Low |
| **Dependencies** | C9 (streaming) |
| **Description** | Typing indicator animation, elapsed time, token count, and cancel button during generation. |

---

## Task Tracker

### Legend
- ⬜ Not started
- 🔨 In progress
- ✅ Complete
- ❌ Blocked

### P0 — Critical Path

| # | Task | Status | Est. | Notes |
|---|---|---|---|---|
| **C4** | **System Prompt** | | | |
| C4.1 | Create core system prompt template | ⬜ | 1h | |
| C4.2 | Load `.parallx/prompt.md` if exists | ⬜ | 1h | |
| C4.3 | Load `.parallx/rules/*.md` with glob matching | ⬜ | 2h | |
| C4.4 | Inject layered prompt in `_buildMessages()` | ⬜ | 1h | |
| C4.5 | `/init` command to auto-generate prompt.md | ⬜ | 3h | |
| **C1** | **RAG Context Injection** | | | |
| C1.1 | Embed user query in `_buildMessages()` | ⬜ | 1h | |
| C1.2 | Retrieve top-K chunks from vector store | ⬜ | 1h | |
| C1.3 | Format chunks as context message with file paths | ⬜ | 1h | |
| C1.4 | Token budget — limit RAG context to % of window | ⬜ | 2h | |
| C1.5 | Context pills UI showing retrieved files | ⬜ | 3h | |
| **C2** | **File Content Reading** | | | |
| C2.1 | `_handleAddContext()` reads file content | ⬜ | 1h | |
| C2.2 | Token count updated on context add | ⬜ | 1h | |
| C2.3 | Visual pill in input area (removable) | ⬜ | 2h | |
| C2.4 | `.parallxignore` check before reading | ⬜ | 1h | |
| C2.5 | Large file handling (truncate with notice) | ⬜ | 1h | |
| **C3** | **File Writing / Apply** | | | |
| C3.1 | Parse `// filepath:` from code blocks | ⬜ | 2h | |
| C3.2 | "Apply" button on targeted code blocks | ⬜ | 2h | |
| C3.3 | Diff computation engine | ⬜ | 4h | |
| C3.4 | Diff review UI (inline red/green) | ⬜ | 4h | |
| C3.5 | Write to disk on approval | ⬜ | 1h | |
| C3.6 | Path validator (workspace sandbox) | ⬜ | 2h | |
| C3.7 | Permission system ("Allow once"/"Allow for session") | ⬜ | 3h | |

### P1 — Important

| # | Task | Status | Est. | Notes |
|---|---|---|---|---|
| C5.1 | Re-embed + re-search on each user message | ⬜ | 2h | |
| C5.2 | De-duplicate context across turns | ⬜ | 2h | |
| C6.1 | `@` autocomplete trigger in chat input | ⬜ | 3h | |
| C6.2 | `@file:` mention with file picker | ⬜ | 3h | |
| C6.3 | `@workspace` mention triggers RAG | ⬜ | 1h | |
| C6.4 | `@folder:` mention with folder content | ⬜ | 2h | |
| C7.1 | "Apply to File" button on code blocks | ⬜ | 2h | Depends on C3 |
| C7.2 | "Create File" button on code blocks | ⬜ | 2h | |
| C8.1 | Terminal panel (xterm.js) | ⬜ | 6h | |
| C8.2 | `@terminal` mention | ⬜ | 2h | |
| C8.3 | AI command suggestion with approval dialog | ⬜ | 4h | |
| C9.1 | Verify streaming renders incrementally | ⬜ | 1h | |
| C9.2 | Progressive markdown rendering | ⬜ | 3h | |
| C9.3 | Stop/cancel button during generation | ⬜ | 2h | |
| C9.4 | Typing indicator animation | ⬜ | 1h | |

### P2 — Polish

| # | Task | Status | Est. | Notes |
|---|---|---|---|---|
| C10.1 | Full-text search across sessions | ⬜ | 4h | |
| C10.2 | Semantic search across sessions | ⬜ | 4h | |
| C11.1 | Multi-file picker in Add Context | ⬜ | 3h | |
| C11.2 | Token budget indicator per file | ⬜ | 2h | |
| C12.1 | Slash command parser in chat input | ⬜ | 2h | |
| C12.2 | Built-in commands (`/explain`, `/fix`, etc.) | ⬜ | 3h | |
| C12.3 | User-defined commands from `.parallx/commands/` | ⬜ | 3h | |
| C13.1 | Typing indicator + elapsed time | ⬜ | 1h | |
| C13.2 | Token count during generation | ⬜ | 1h | |
| C13.3 | Cancel button mid-generation | ⬜ | 1h | |

---

## Architecture Decisions

### AD1: Tool-Use System (Claw-inspired)

Rather than hardcoding each capability, implement a **tool system** where the LLM can call defined tools. This is future-proof and matches the industry direction.

```
┌─────────────────────────────────────────────┐
│                 Chat Tool                    │
│  ┌─────────────────────────────────────┐    │
│  │         System Prompt               │    │
│  │  (core + user rules + RAG context)  │    │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │         Tool Registry               │    │
│  │  ┌───────────┐ ┌──────────────┐    │    │
│  │  │ read_file │ │ write_file   │    │    │
│  │  └───────────┘ └──────────────┘    │    │
│  │  ┌───────────┐ ┌──────────────┐    │    │
│  │  │  search   │ │ list_files   │    │    │
│  │  └───────────┘ └──────────────┘    │    │
│  │  ┌───────────┐ ┌──────────────┐    │    │
│  │  │ terminal  │ │ create_file  │    │    │
│  │  └───────────┘ └──────────────┘    │    │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │       Permission Manager            │    │
│  │  • Validates paths (sandbox)        │    │
│  │  • Checks .parallxignore            │    │
│  │  • Prompts user for approval        │    │
│  │  • Tracks session-level grants      │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

**Note:** Ollama supports tool/function calling for compatible models (Qwen2.5, Llama 3.1+, Mistral). We should detect model capability and fall back to prompt-based tool use for models that don't support native function calling.

### AD2: Context Assembly Pipeline

```
User Message
    │
    ▼
┌─ Context Assembly ──────────────────────┐
│                                          │
│  1. System prompt (core + user rules)    │
│  2. RAG results (auto-retrieved)         │
│  3. Explicit @mentions (user-requested)  │
│  4. Attached files (Add Context)         │
│  5. Conversation history                 │
│  6. User's current message               │
│                                          │
│  Token budget manager:                   │
│  - System prompt: 10% reserved           │
│  - RAG + mentions: up to 40%            │
│  - History: up to 30%                    │
│  - Current message: 20% reserved         │
│  - Overflow: trim oldest history first   │
│                                          │
└──────────────────────────────────────────┘
    │
    ▼
  Ollama /api/chat
```

### AD3: `.parallx/` Workspace Configuration

```
.parallx/
├── prompt.md          # Main system prompt (like CLAUDE.md)
├── config.json        # Settings (context length, RAG top-K, etc.)
├── rules/
│   ├── typescript.md  # Rules for *.ts files
│   ├── python.md      # Rules for *.py files
│   └── testing.md     # Rules for *.test.* files
├── commands/
│   ├── deploy-check.md
│   └── code-review.md
└── ignore             # Files AI cannot read (like .gitignore)
```

**`prompt.md` example:**
```markdown
# Project: ComfyUI Custom Nodes

This workspace contains custom nodes for ComfyUI, a node-based
Stable Diffusion GUI.

## Architecture
- Each node is a Python class with INPUT_TYPES, RETURN_TYPES, FUNCTION
- Nodes are registered via NODE_CLASS_MAPPINGS dict
- Category determines where the node appears in the UI

## Conventions
- Use type hints on all functions
- Docstrings on all public methods
- Error handling: raise ValueError with descriptive message
- Tensor operations: always specify device and dtype

## Important Files
- `nodes.py` — Main node definitions
- `__init__.py` — Node registration
- `requirements.txt` — Dependencies
```

---

## User Control & Prompt Files

### Principle: User Owns the Prompt

The user must have full transparency and control over what gets sent to the LLM. This means:

1. **System prompt is visible** — Button in chat toolbar to view current system prompt
2. **User rules override core rules** — `.parallx/prompt.md` is injected AFTER core prompt
3. **Everything is a file** — Rules, commands, and config are plain text files in the workspace, editable with any text editor
4. **No hidden context** — Context pills show exactly what was injected and how many tokens each piece uses
5. **Token budget is transparent** — Status bar shows breakdown: system prompt (X tokens) + RAG (Y tokens) + history (Z tokens) + message (W tokens)

### First-Run Experience

When user opens a workspace for the first time:
1. Parallx creates `.parallx/` directory
2. Runs `/init` — scans file structure, README, package.json, etc.
3. Generates initial `prompt.md` with project description
4. Shows notification: "I've created a project description at `.parallx/prompt.md`. Edit it to help me understand your project better."
5. User edits the file → immediately reflected in next conversation

---

## Setup & Configuration Vision

### First Launch Flow

```
┌──────────────────────────────────────────────────┐
│                                                   │
│  Welcome to Parallx                              │
│                                                   │
│  Parallx runs AI 100% locally on your machine.   │
│  Let's set things up.                            │
│                                                   │
│  1. Ollama Status: ✅ Running (4 models found)    │
│                                                   │
│  2. Select chat model:                           │
│     ● qwen2.5:32b-instruct (32.5B, 128K ctx)    │
│     ○ llama3.1:8b (8B, 128K ctx)                │
│     ○ mistral:7b (7B, 32K ctx)                  │
│                                                   │
│  3. Select embedding model:                       │
│     ● nomic-embed-text (recommended)             │
│     ○ mxbai-embed-large                          │
│                                                   │
│  4. Open a workspace folder:                     │
│     [Browse...]                                   │
│                                                   │
│  [Get Started →]                                  │
│                                                   │
└──────────────────────────────────────────────────┘
```

### Settings Panel Vision

```
┌─ Settings ───────────────────────────────────────┐
│                                                   │
│  AI Models                                        │
│  ├─ Chat model: [qwen2.5:32b-instruct ▼]        │
│  ├─ Embedding model: [nomic-embed-text ▼]        │
│  └─ Context length: [Auto (use model max) ▼]     │
│                                                   │
│  Context & Retrieval                              │
│  ├─ Auto-RAG: [✅ Enabled]                        │
│  │  Automatically find relevant files for         │
│  │  every message                                 │
│  ├─ RAG results: [10] chunks per query           │
│  ├─ Context budget: [40%] of window for context  │
│  └─ Reranking: [✅ Enabled]                       │
│                                                   │
│  Indexing                                         │
│  ├─ Auto-index on startup: [✅ Enabled]           │
│  ├─ Watch for changes: [✅ Enabled]               │
│  ├─ Excluded patterns: [Edit .parallxignore]     │
│  └─ Max file size: [1 MB]                        │
│                                                   │
│  Security                                         │
│  ├─ Workspace sandbox: [✅ Enforced] (locked)     │
│  ├─ File write approval: [Ask every time ▼]      │
│  │  ○ Ask every time                             │
│  │  ○ Ask once per session                       │
│  │  ○ Always allow (not recommended)             │
│  ├─ Terminal command approval: [Ask every time ▼] │
│  └─ Network access: [❌ Disabled]                 │
│                                                   │
│  Prompt & Rules                                   │
│  ├─ System prompt: [View/Edit]                   │
│  ├─ Project rules: [Open .parallx/rules/]        │
│  └─ Custom commands: [Open .parallx/commands/]   │
│                                                   │
└──────────────────────────────────────────────────┘
```

---

## Implementation Order

Based on dependencies and impact, the implementation order should be:

```
Phase 1 — "The LLM can see" (C4 → C2 → C1)
  System prompt → File reading → RAG injection
  Result: LLM understands the project and answers questions about code

Phase 2 — "The LLM can act" (C3 → C7 → C9)
  File writing → Code actions → Streaming polish
  Result: LLM can suggest AND apply code changes

Phase 3 — "The user has control" (C6 → C12 → C5)
  @mentions → Slash commands → Per-turn RAG
  Result: User can precisely control what context the LLM sees

Phase 4 — "Full Jarvis" (C8 → C10 → C11 → C13)
  Terminal → Search → Multi-file → Polish
  Result: Complete second brain experience
```

---

*This document is the living plan for Milestone 11. Update task statuses as work progresses.*
