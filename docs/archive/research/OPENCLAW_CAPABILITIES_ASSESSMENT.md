# OpenClaw Capabilities Assessment — Terminal, Computer, and Network Interaction

**Date:** April 5, 2026
**Status:** Active assessment
**Scope:** Complete inventory of interaction capabilities, limitations, and extension points

---

## 1. Executive Summary

OpenClaw is Parallx's built-in AI runtime — a local-first, Ollama-powered agent system that operates within the workspace boundary. This assessment catalogs exactly what OpenClaw can and cannot do across three domains: **terminal interaction**, **computer interaction** (filesystem, editor, workspace), and **network access**.

The verdict: OpenClaw is strong at programmatic workspace tasks (file reading, structured editing, page management, knowledge retrieval) and reasonably capable at terminal interaction. It has **no graphical computer control** (no screenshots, no mouse, no GUI interaction) and **no direct internet access**. Network capabilities are extensible through the MCP server protocol.

---

## 2. Tool Inventory

OpenClaw exposes 20 built-in tools across 6 categories, registered in [src/built-in/chat/tools/](src/built-in/chat/tools/).

### 2.1 File System Tools

**Source:** [src/built-in/chat/tools/fileTools.ts](src/built-in/chat/tools/fileTools.ts)

| Tool | Permission | Description |
|------|-----------|-------------|
| `list_files` | always-allowed | List files and directories at a workspace path |
| `read_file` | always-allowed | Read text files (≤50 KB) or rich docs (PDF, DOCX, XLSX via extraction) |
| `search_files` | always-allowed | Search file/directory names by glob pattern (depth ≤ 5, max 50 results) |
| `grep_search` | always-allowed | Regex or literal search inside files (max 100 matches, 512 KB per file) |
| `search_knowledge` | always-allowed | Hybrid RAG search across indexed workspace content |

**Capabilities:**
- Can read any text file within workspace boundary
- Rich document extraction: PDF, DOCX, XLSX, XLS, XLSM, XLSB, ODS, Numbers, CSV, TSV
- Line-range reading: `start_line` / `end_line` parameters for partial reads
- Glob-based file search with configurable depth
- Content search with regex support and context lines

**Constraints:**
- 50 KB cap on raw file reads
- 50,000 character cap on extracted document text
- 512 KB max file size for grep search
- All paths must be relative to workspace root
- No reading outside workspace boundary

### 2.2 Write Tools

**Source:** [src/built-in/chat/tools/writeTools.ts](src/built-in/chat/tools/writeTools.ts)

| Tool | Permission | Description |
|------|-----------|-------------|
| `write_file` | requires-approval | Create or overwrite a workspace file |
| `edit_file` | requires-approval | Search-and-replace edit within an existing file |
| `delete_file` | requires-approval | Delete a workspace file |

**Capabilities:**
- Full create/overwrite/edit/delete lifecycle
- Edit uses search-and-replace: specify `old_content` and `new_content`
- Path sanitization: rejects absolute paths, path traversal (`..`), `.parallxignore` violations

**Constraints:**
- All three require user approval (3-tier permission: `requires-approval`)
- Path traversal explicitly blocked
- `.parallxignore` rules enforced
- No binary file support for write operations
- No directory creation (only files)

### 2.3 Page Tools

**Source:** [src/built-in/chat/tools/pageTools.ts](src/built-in/chat/tools/pageTools.ts)

| Tool | Permission | Description |
|------|-----------|-------------|
| `search_workspace` | always-allowed | Search workspace pages (title, tags, content) |
| `read_page` | always-allowed | Read a page by URI |
| `read_page_by_title` | always-allowed | Read a page by title |
| `read_current_page` | always-allowed | Read the currently active page |
| `list_pages` | always-allowed | List all pages with metadata |
| `get_page_properties` | always-allowed | Get structured page properties |
| `create_page` | requires-approval | Create a new workspace page |

**Capabilities:**
- Full workspace page CRUD (create + read, no edit/delete)
- Search across title, tags, and content
- Structured metadata access (page properties, block types)
- Current page awareness (knows what the user is looking at)

### 2.4 Terminal Tools

**Source:** [src/built-in/chat/tools/terminalTools.ts](src/built-in/chat/tools/terminalTools.ts)

| Tool | Permission | Description |
|------|-----------|-------------|
| `run_command` | requires-approval | Execute a shell command in the workspace directory |

Detailed in [Section 3](#3-terminal-interaction-capabilities).

### 2.5 Memory Tools

**Source:** [src/built-in/chat/tools/memoryTools.ts](src/built-in/chat/tools/memoryTools.ts)

| Tool | Permission | Description |
|------|-----------|-------------|
| `memory_get` | always-allowed | Retrieve memory entries by layer (`durable` or `daily`) and optional date (YYYY-MM-DD) |
| `memory_search` | always-allowed | Search memory by keyword; filterable by layer (`all`/`durable`/`daily`) and date |

### 2.6 Transcript Tools

**Source:** [src/built-in/chat/tools/transcriptTools.ts](src/built-in/chat/tools/transcriptTools.ts)

| Tool | Permission | Description |
|------|-----------|-------------|
| `transcript_get` | always-allowed | Get a conversation transcript by session ID |
| `transcript_search` | always-allowed | Search conversation transcripts by query; optionally filter by session ID |

---

## 3. Terminal Interaction Capabilities

### 3.1 Architecture

**Source:** [src/built-in/chat/tools/terminalTools.ts](src/built-in/chat/tools/terminalTools.ts)

OpenClaw's terminal access is mediated through a single `run_command` tool that executes shell commands in the workspace directory via the Electron main process.

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│   OpenClaw   │────▶│  run_command     │────▶│  Electron Main   │
│   Agent      │     │  (tool handler)  │     │  (child_process)  │
│              │◀────│                  │◀────│                  │
│              │     │  stdout/stderr   │     │  exec result     │
└──────────────┘     └─────────────────┘     └──────────────────┘
```

### 3.2 What It Can Do

| Capability | Detail |
|-----------|--------|
| **Run shell commands** | Any command available in the system PATH |
| **Install dependencies** | `npm install`, `pip install`, etc. |
| **Run builds** | `npm run build`, `tsc`, `cargo build`, etc. |
| **Execute tests** | `npm test`, `pytest`, `cargo test`, etc. |
| **Gather system info** | `node -v`, `python --version`, system diagnostics |
| **File operations** | `mkdir`, `cp`, `mv` (though tool-based file ops preferred) |
| **Git operations** | `git status`, `git log`, `git diff`, etc. |
| **Custom scripts** | Run any script in the workspace |

### 3.3 Security Constraints

| Constraint | Implementation |
|-----------|---------------|
| **User approval required** | Every `run_command` invocation needs explicit user approval |
| **30-second timeout** | Default timeout; configurable via `timeout` parameter |
| **50,000 character output cap** | Output truncated beyond this limit |
| **Command blocklist** | Hard-coded list of dangerous commands that are unconditionally rejected |
| **Workspace CWD** | Commands always execute from the workspace root directory |

**Blocklisted commands** (from [terminalTools.ts](src/built-in/chat/tools/terminalTools.ts#L16-L27)):

```
rm -rf /
format
mkfs
dd if=
:(){:|:&};:     (fork bomb)
shutdown
reboot
halt
init 0
init 6
```

The blocklist uses substring matching — if the command includes any blocklisted string, it is rejected before execution.

### 3.4 What It Cannot Do

| Limitation | Reason |
|-----------|--------|
| **Long-running processes** | 30s timeout kills servers, watch tasks, etc. |
| **Interactive commands** | No stdin support — cannot respond to prompts |
| **Background processes** | No daemon/service management |
| **Elevated privileges** | No sudo escalation mechanism |
| **Multiple terminals** | Single command execution — no persistent shell session |
| **Environment variables** | Cannot persist env vars across invocations |

---

## 4. Computer Interaction Capabilities

### 4.1 What "Computer Interaction" Means Here

Unlike Anthropic's Computer Use (see [CLAUDE_CAPABILITIES_RESEARCH.md](CLAUDE_CAPABILITIES_RESEARCH.md) Section 12), OpenClaw does **not** interact with the computer through a graphical display. It has no screenshots, no mouse control, and no keyboard simulation.

OpenClaw interacts with the computer through **structured tools** — programmatic APIs that read and write workspace data.

### 4.2 Filesystem Interaction

**Full workspace boundary enforcement.** All file operations are sandboxed to the workspace root.

| Operation | Tool | Notes |
|-----------|------|-------|
| Read files | `read_file` | Text ≤ 50 KB, rich docs via extraction |
| Write files | `write_file` | Creates or overwrites (requires approval) |
| Edit files | `edit_file` | Search-and-replace (requires approval) |
| Delete files | `delete_file` | Requires approval |
| List directories | `list_files` | Returns names, types, sizes |
| Search by name | `search_files` | Glob pattern, depth-limited |
| Search content | `grep_search` | Regex or literal, context lines |

**Path sanitization** (from [writeTools.ts](src/built-in/chat/tools/writeTools.ts#L34-L62)):
- Normalizes separators (`\` → `/`)
- Rejects absolute paths
- Rejects path traversal (`..`)
- Validates against `.parallxignore` rules

### 4.3 Editor / IDE Interaction

| Capability | Status | Detail |
|-----------|--------|--------|
| Read active page | **Yes** | `read_current_page` knows what the user has open |
| Read page properties | **Yes** | `get_page_properties` returns structured metadata |
| Create pages | **Yes** | `create_page` (requires approval) |
| Navigate to file | **No** | Cannot command the editor to open or focus files |
| Modify UI state | **No** | Cannot toggle panels, change themes, resize windows |
| Interact with canvas | **No** | Cannot directly manipulate canvas blocks or layout |
| Control sidebar | **No** | Cannot open/close sidebar panels |

### 4.4 Workspace Knowledge

**Source:** [src/services/embeddingService.ts](src/services/embeddingService.ts), [src/services/vectorStoreService.ts](src/services/vectorStoreService.ts), [src/services/retrievalService.ts](src/services/retrievalService.ts)

| Component | Implementation |
|-----------|---------------|
| Embedding model | nomic-embed-text v1.5 via Ollama (`localhost:11434`) |
| Embedding dimensions | 768 (float) |
| Vector store | sqlite-vec (WASM extension for SQLite) |
| Keyword index | FTS5 (SQLite full-text search) |
| Fusion method | Reciprocal Rank Fusion (RRF) — merges vector + BM25 |
| Access via | `search_knowledge` tool + automatic RAG context injection |

**How RAG works in practice:**

```
User prompt → Query extraction
                ↓
    ┌───────────┴───────────┐
    │                       │
    ▼                       ▼
Vector search          FTS5 BM25 search
(cosine similarity)    (keyword relevance)
    │                       │
    └───────────┬───────────┘
                ↓
         RRF merge
                ↓
         Top-K chunks
                ↓
      Injected into context
```

**Token budget allocation:**
| Segment | Allocation |
|---------|-----------|
| System prompt | 10% |
| RAG context | 30% |
| Conversation history | 30% |
| User message | 30% |

---

## 5. Network Interaction Capabilities

### 5.1 Built-In Network Access

**OpenClaw has no built-in internet access.**

The only network communication is to the local Ollama instance at `localhost:11434`:
- `/api/chat` — LLM inference
- `/api/embed` — Embedding generation
- `/api/tags` — Model listing
- `/api/show` — Model info

There is no HTTP client, no fetch tool, no web scraping, no URL opening.

### 5.2 MCP Extensibility Point

**Source:** [src/openclaw/mcp/mcpClientService.ts](src/openclaw/mcp/mcpClientService.ts)

The Model Context Protocol (MCP) is OpenClaw's extensibility mechanism. External MCP servers can provide tools that include network access.

| MCP Feature | Implementation |
|-------------|---------------|
| Transport | stdio (primary) and SSE (config-supported); stdio via Electron IPC |
| Protocol | JSON-RPC 2.0 |
| Health monitoring | Ping every 30 seconds |
| Auto-reconnect | Up to 5 attempts, exponential backoff (1s base, 30s max) |
| Tool namespace | `mcp__<serverId>__<toolName>` |
| Timeout | 30s per request |

**Example: adding a web search tool via MCP**

A user could configure an MCP server in their workspace that wraps a search API:

```json
{
  "id": "web-search",
  "name": "Web Search",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@example/mcp-web-search"],
  "enabled": true
}
```

This would make tools like `mcp__web-search__search_web` available in OpenClaw's tool palette.

### 5.3 Default MCP Server

A test server is bundled by default (from [mcpClientService.ts](src/openclaw/mcp/mcpClientService.ts#L38-L46)):

```typescript
{
  id: 'everything',
  name: 'Everything (Test)',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-everything'],
  enabled: true,
}
```

This is a test/demo server — not a production capability.

---

## 6. Autonomy System

### 6.1 Permission Tiers

**Source:** [src/openclaw/openclawToolPolicy.ts](src/openclaw/openclawToolPolicy.ts)

| Tier | Description | Examples |
|------|-------------|---------|
| `always-allowed` | No approval needed | `list_files`, `read_file`, `search_files`, `grep_search`, `search_knowledge`, `read_page`, `memory_get` |
| `requires-approval` | User must approve each invocation | `write_file`, `edit_file`, `delete_file`, `run_command`, `create_page` |
| `never-allowed` | Tool blocked entirely | (configurable per-tool override) |

### 6.2 Tool Profiles

**Source:** [src/openclaw/openclawToolPolicy.ts](src/openclaw/openclawToolPolicy.ts#L52-L66)

| Profile | Allowed | Denied |
|---------|---------|--------|
| `readonly` | All except denied | `write_file`, `edit_file`, `delete_file`, `run_command`, `create_page` |
| `standard` | All except denied | `run_command` |
| `full` | Everything | Nothing |

Tool profiles are **deny-first** — the deny list is checked before the allow list.

### 6.3 Autonomy Levels

**Source:** [src/agent/agentTypes.ts](src/agent/agentTypes.ts)

| Level | Description |
|-------|-------------|
| `manual` | All tool calls require approval |
| `allow-readonly` | Read tools auto-approved; write tools need approval |
| `allow-safe-actions` | Read + standard tools auto-approved; risky tools need approval |
| `allow-policy-actions` | All tools auto-approved per policy |

### 6.4 Interaction Modes

**Source:** [src/agent/agentTypes.ts](src/agent/agentTypes.ts)

| Mode | Description |
|------|-------------|
| `advisor` | Information and analysis only |
| `researcher` | Deep investigation and synthesis |
| `executor` | Task execution with tool use |
| `reviewer` | Code/content review and feedback |
| `operator` | Full autonomy, all tools |

---

## 7. Advanced Capabilities

### 7.1 Heartbeat Runner (Proactive Check-Ins)

**Source:** [src/openclaw/openclawHeartbeatRunner.ts](src/openclaw/openclawHeartbeatRunner.ts)

The heartbeat runner enables proactive behavior — the AI can check in periodically without user prompting.

| Feature | Detail |
|---------|--------|
| Default interval | 5 minutes (configurable) |
| Minimum interval | 30 seconds |
| Maximum interval | 60 minutes |
| Trigger reasons | interval, system-event, cron, wake, hook |
| Duplicate suppression | 60s window — same event type ignored |
| Isolation | Heartbeat turns don't pollute active chat history |

### 7.2 Cron / Scheduling

**Source:** [src/openclaw/openclawCronService.ts](src/openclaw/openclawCronService.ts)

The agent can schedule its own reminders and time-triggered tasks.

| Feature | Detail |
|---------|--------|
| Schedule types | ISO-8601 (`at`), duration (`every`), cron expression (`cron`) |
| Max concurrent jobs | 50 |
| Context injection | Up to 10 recent chat messages per job |
| Wake modes | `now` (immediate) or `next-heartbeat` (piggyback) |
| Run history | Last 200 executions tracked |
| Self-cleanup | `deleteAfterRun` flag for one-shot jobs |

### 7.3 Sub-Agent Spawning

**Source:** [src/openclaw/openclawSubagentSpawn.ts](src/openclaw/openclawSubagentSpawn.ts)

The agent can spawn isolated sub-tasks with configurable model selection.

| Feature | Detail |
|---------|--------|
| Spawn mode | `run` (one-shot only) |
| Max depth | 3 levels (configurable) |
| Max concurrent | 5 runs |
| Timeout | 120 seconds default |
| Model override | Sub-agent can use different Ollama model |
| Results | Posted back to parent chat |

### 7.4 Context Engine

**Source:** [src/openclaw/openclawContextEngine.ts](src/openclaw/openclawContextEngine.ts)

The context engine manages the assembly, compaction, and maintenance of conversation context.

| Feature | Detail |
|---------|--------|
| Compaction | Identifier-aware summarization (preserves code names, functions, variables) |
| Quality threshold | 60% identifier survival required; up to 2 retries on low-quality summaries |
| RAG sub-lane budget | RAG 55%, Page 15%, Memory 15%, Transcript 10%, Concepts 5% (within 30% RAG ceiling) |
| Maintenance rules | Trim verbose tool results (>2000 chars → first 1500), remove redundant acknowledgment pairs (<20 chars), collapse duplicate context summaries |
| Methods | bootstrap, assemble, compact, afterTurn, maintain, prepareSubagentSpawn, onSubagentEnded |

### 7.5 Turn Runner — Resilience

**Source:** [src/openclaw/openclawTurnRunner.ts](src/openclaw/openclawTurnRunner.ts)

The turn runner executes tool-calling loops with multi-layered retry logic.

| Failure Type | Strategy | Max Retries |
|-------------|----------|-------------|
| Context overflow | Compact → re-assemble → retry | 3 |
| Timeout | Force compact → re-assemble → retry | 2 |
| Transient error | Exponential backoff (2.5s → 5s → 10s) | 3 |
| Model failure | Fallback to next model in chain | 1 |
| Unrecoverable | Throw to caller | 0 |

Additional feature: proactive auto-compaction triggers at >80% budget utilization.

---

## 8. Capability Matrix Summary

| Domain | Capability | Status |
|--------|-----------|--------|
| **Terminal** | Run shell commands | ✅ (approval-gated, 30s timeout, blocklist) |
| **Terminal** | Interactive commands (stdin) | ❌ Not supported |
| **Terminal** | Background processes | ❌ Not supported |
| **Filesystem** | Read files | ✅ (≤ 50 KB text, rich doc extraction) |
| **Filesystem** | Write / edit / delete files | ✅ (approval-gated, sandboxed) |
| **Filesystem** | Search files by name | ✅ (glob, depth ≤ 5) |
| **Filesystem** | Search file contents | ✅ (regex, ≤ 512 KB files) |
| **Filesystem** | Read outside workspace | ❌ Blocked by sandbox |
| **Editor** | Know current page | ✅ |
| **Editor** | Read page content | ✅ |
| **Editor** | Create pages | ✅ (approval-gated) |
| **Editor** | Navigate/focus editor | ❌ Not supported |
| **Editor** | Manipulate canvas | ❌ Not supported |
| **Editor** | Control UI panels | ❌ Not supported |
| **Knowledge** | RAG search | ✅ (hybrid vector + FTS5) |
| **Knowledge** | Memory recall | ✅ |
| **Knowledge** | Conversation search | ✅ |
| **Network** | Internet access | ❌ Not built-in |
| **Network** | Local Ollama API | ✅ (localhost:11434) |
| **Network** | MCP server tools | ✅ (stdio + SSE transport, extensible) |
| **Network** | HTTP/fetch tool | ❌ Not built-in |
| **Autonomy** | Proactive heartbeat | ✅ (configurable interval) |
| **Autonomy** | Scheduled tasks (cron) | ✅ |
| **Autonomy** | Sub-agent delegation | ✅ (depth ≤ 3, concurrent ≤ 5) |
| **Resilience** | Context overflow recovery | ✅ (compact → re-assemble → retry, 3 attempts) |
| **Resilience** | Transient error retry | ✅ (exponential backoff, 3 attempts) |
| **Resilience** | Proactive auto-compaction | ✅ (>80% budget utilization) |
| **GUI** | Screenshots | ❌ Not supported |
| **GUI** | Mouse/keyboard control | ❌ Not supported |
| **GUI** | Window management | ❌ Not supported |

---

## 9. Comparison: OpenClaw vs. Claude API

For the full Claude capabilities reference, see [CLAUDE_CAPABILITIES_RESEARCH.md](CLAUDE_CAPABILITIES_RESEARCH.md).

| Dimension | OpenClaw | Claude API |
|-----------|---------|------------|
| Interaction layer | API / programmatic | API + GUI (Computer Use) |
| Inference | Local (Ollama) | Cloud (Anthropic servers) |
| Cost | Free (runs on your hardware) | Per-token pricing ($1–$25/MTok) |
| Context window | Model-dependent (4K–128K) | Up to 1,000,000 tokens |
| Speed | Model-dependent | Low latency for Haiku, higher for Opus |
| Accuracy | High (deterministic tool results) | Variable per task; extended thinking improves complex reasoning |
| Scope | Workspace boundary | Full desktop (Computer Use) or sandboxed container (Code Execution) |
| Browser / Web | No built-in access | Web search + web fetch (server-side) |
| Terminal | Limited (30s, blocklist) | Bash tool (persistent session, developer-controlled) |
| Code execution | `run_command` tool (workspace dir) | Sandboxed container (Python 3.11 + Bash, 5GiB RAM) |
| File editing | Reliable (search-replace) | Text editor tool (str_replace) or Code execution |
| Vision | Model-dependent | JPEG, PNG, GIF, WebP; up to 8000×8000 px |
| Privacy | Everything stays local | Data sent to Anthropic (ZDR optional) |
| Extensibility | MCP servers (stdio + SSE) | MCP connector (HTTP), custom tools, Agent Skills |
| Proactive behavior | Heartbeat + cron + sub-agents | Not built-in (reactive only) |
| Batch processing | N/A (no per-request cost) | Yes (50% cost savings) |
| Agent Skills | Workspace skills (SKILL.md) | Pre-built (PPTX, XLSX, DOCX, PDF) + custom |

---

## 10. Sources

All source references point to the Parallx codebase at the time of assessment.

| Source | Path |
|--------|------|
| Terminal tools | [src/built-in/chat/tools/terminalTools.ts](src/built-in/chat/tools/terminalTools.ts) |
| Write tools | [src/built-in/chat/tools/writeTools.ts](src/built-in/chat/tools/writeTools.ts) |
| File tools | [src/built-in/chat/tools/fileTools.ts](src/built-in/chat/tools/fileTools.ts) |
| Page tools | [src/built-in/chat/tools/pageTools.ts](src/built-in/chat/tools/pageTools.ts) |
| Memory tools | [src/built-in/chat/tools/memoryTools.ts](src/built-in/chat/tools/memoryTools.ts) |
| Transcript tools | [src/built-in/chat/tools/transcriptTools.ts](src/built-in/chat/tools/transcriptTools.ts) |
| Tool policy | [src/openclaw/openclawToolPolicy.ts](src/openclaw/openclawToolPolicy.ts) |
| MCP client | [src/openclaw/mcp/mcpClientService.ts](src/openclaw/mcp/mcpClientService.ts) |
| Embedding service | [src/services/embeddingService.ts](src/services/embeddingService.ts) |
| Agent types | [src/agent/agentTypes.ts](src/agent/agentTypes.ts) |
| Heartbeat runner | [src/openclaw/openclawHeartbeatRunner.ts](src/openclaw/openclawHeartbeatRunner.ts) |
| Cron service | [src/openclaw/openclawCronService.ts](src/openclaw/openclawCronService.ts) |
| Sub-agent spawning | [src/openclaw/openclawSubagentSpawn.ts](src/openclaw/openclawSubagentSpawn.ts) |
| Claude research | [CLAUDE_CAPABILITIES_RESEARCH.md](CLAUDE_CAPABILITIES_RESEARCH.md) |
