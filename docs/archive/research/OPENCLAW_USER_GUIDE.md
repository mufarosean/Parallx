# OpenClaw / AI Chat — Complete User Guide

**Date:** April 5, 2026
**Applies to:** Parallx AI Chat (OpenClaw runtime)
**Audience:** Users of all experience levels

---

## Table of Contents

1. [What Is OpenClaw?](#1-what-is-openclaw)
2. [Prerequisites](#2-prerequisites)
3. [Chat Modes](#3-chat-modes)
4. [Tools — What the AI Can Do](#4-tools--what-the-ai-can-do)
5. [Approvals and Permissions](#5-approvals-and-permissions)
6. [Slash Commands](#6-slash-commands)
7. [Context System](#7-context-system)
8. [RAG — Knowledge Retrieval](#8-rag--knowledge-retrieval)
9. [AI Settings](#9-ai-settings)
10. [Skills](#10-skills)
11. [Memory and Workspace Files](#11-memory-and-workspace-files)
12. [MCP Servers — Extending the AI](#12-mcp-servers--extending-the-ai)
13. [Advanced Features](#13-advanced-features)
14. [Troubleshooting](#14-troubleshooting)
15. [Limitations](#15-limitations)
16. [Sources](#16-sources)

---

## 1. What Is OpenClaw?

OpenClaw is the AI runtime that powers Parallx's chat interface. It is a **local-first** agent system — your data stays on your machine, your models run locally through Ollama, and the AI operates within the workspace you give it access to.

**Key characteristics:**
- Runs entirely locally — no cloud API calls for inference
- Workspace-sandboxed — cannot access files outside the workspace
- Tool-based — interacts through structured tools, not screen/mouse
- Approval-gated — destructive actions require your explicit OK
- Extensible — add capabilities via MCP servers and workspace skills

---

## 2. Prerequisites

Before using Parallx AI Chat, you need:

| Requirement | Detail |
|------------|--------|
| **Ollama** | Running at `localhost:11434`. Install from [ollama.com](https://ollama.com). |
| **A language model** | At least one chat model installed. Run `ollama pull qwen2.5` to get started. |
| **An embedding model** | `nomic-embed-text` for RAG features. Run `ollama pull nomic-embed-text`. |
| **A workspace** | Open a folder in Parallx to establish the workspace boundary. |

### Quick Health Check

After setup, type `/doctor` in the AI Chat to verify everything is connected:

```
/doctor
```

This runs diagnostics on:
- Ollama connectivity
- Model availability
- Embedding model status
- Index health
- MCP server status (if configured)

---

## 3. Chat Modes

Parallx AI Chat supports three interaction modes. Each mode determines what the AI can do and how it behaves.

### Ask Mode

**Purpose:** Information and analysis only

The AI answers questions, explains concepts, and provides recommendations. No files are modified, no commands are run. This is the safest mode for exploration.

**Best for:**
- Understanding code or documents
- Getting explanations
- Brainstorming ideas
- Learning about your workspace

**Example:**
```
What does the embeddingService do? Explain the batching logic.
```

### Edit Mode

**Purpose:** Guided editing with approval

The AI can read and write files but asks for approval before each change. It suggests edits and you approve or reject them.

**Best for:**
- Code modifications with human review
- File creation
- Search-and-replace refactoring

**Example:**
```
Add error handling to the fetchData function in src/api/client.ts
```

### Agent Mode (Default)

**Purpose:** Autonomous task execution

The AI uses all available tools to accomplish tasks. It reads files, searches the workspace, runs commands, creates files — working through multi-step tasks with minimal prompting. Destructive actions still require your approval.

**Best for:**
- Multi-step tasks (investigate → plan → implement)
- Workspace exploration
- Running builds and tests
- Complex file operations

**Example:**
```
Find all files that import from the old API module, update them to use the new
API path, then run the tests to verify nothing broke.
```

### Capability Comparison by Mode

| Capability | Ask | Edit | Agent |
|-----------|-----|------|-------|
| Read files | ✅ | ✅ | ✅ |
| Search workspace | ✅ | ✅ | ✅ |
| Read pages | ✅ | ✅ | ✅ |
| RAG knowledge search | ✅ | ✅ | ✅ |
| Write/edit files | ❌ | ✅ | ✅ |
| Delete files | ❌ | ❌ | ✅ |
| Run terminal commands | ❌ | ❌ | ✅ |
| Create pages | ❌ | ✅ | ✅ |
| Memory access | ✅ | ✅ | ✅ |

---

## 4. Tools — What the AI Can Do

OpenClaw has 20 built-in tools organized into 6 categories.

### File System Tools

| Tool | What it does | Needs approval? |
|------|-------------|----------------|
| `list_files` | Lists files and directories at a path | No |
| `read_file` | Reads a file's content (text ≤ 50 KB, or PDFs/DOCX/XLSX via extraction) | No |
| `search_files` | Searches file/directory names by glob pattern | No |
| `grep_search` | Searches inside files by regex or literal string | No |
| `search_knowledge` | Searches indexed workspace content using hybrid RAG | No |

### Write Tools

| Tool | What it does | Needs approval? |
|------|-------------|----------------|
| `write_file` | Creates or overwrites a file | **Yes** |
| `edit_file` | Makes a search-and-replace edit in a file | **Yes** |
| `delete_file` | Deletes a file | **Yes** |

### Page Tools

| Tool | What it does | Needs approval? |
|------|-------------|----------------|
| `search_workspace` | Searches pages by title, tags, or content | No |
| `read_page` | Reads a page by its URI | No |
| `read_page_by_title` | Reads a page by title | No |
| `read_current_page` | Reads the currently active page | No |
| `list_pages` | Lists all workspace pages with metadata | No |
| `get_page_properties` | Gets structured page properties | No |
| `create_page` | Creates a new workspace page | **Yes** |

### Terminal Tools

| Tool | What it does | Needs approval? |
|------|-------------|----------------|
| `run_command` | Runs a shell command in the workspace directory | **Yes** |

**Important details:**
- 30-second default timeout (configurable per invocation)
- Output capped at 50,000 characters
- Dangerous commands are blocklisted (rm -rf /, format, shutdown, etc.)
- Commands always run from the workspace root

### Memory Tools

| Tool | What it does | Needs approval? |
|------|-------------|----------------|
| `memory_get` | Retrieves memory entries | No |
| `memory_search` | Searches memory by keyword | No |

### Transcript Tools

| Tool | What it does | Needs approval? |
|------|-------------|----------------|
| `transcript_get` | Gets conversation transcript | No |
| `transcript_search` | Searches conversation history | No |

---

## 5. Approvals and Permissions

### How the Approval System Works

Every tool has a **permission level**:

| Level | Meaning |
|-------|---------|
| `always-allowed` | Runs without asking (read-only operations) |
| `requires-approval` | You see a prompt and must click Approve/Reject |
| `never-allowed` | Completely blocked — the AI cannot invoke it |

When a tool call requires approval, you will see:
1. **Which tool** is being called
2. **What parameters** it's using (file path, command, etc.)
3. **Approve** or **Reject** buttons

### Before Approving, Ask Yourself:

1. Is this the right file or target?
2. Is this the right action?
3. Is the scope reasonable (not too broad)?
4. Do I understand why the AI wants to do this?

If the answer to any of these is "no," reject and ask the AI to explain or revise.

### Tool Profiles

Tool profiles are configurations that control which tools are available:

| Profile | Description |
|---------|-------------|
| `readonly` | Only read operations — no writing, no commands, no page creation |
| `standard` | All tools except `run_command` |
| `full` | All tools enabled |

### Autonomy Levels

| Level | What gets auto-approved |
|-------|------------------------|
| `manual` | Nothing — all tools require your approval |
| `allow-readonly` | Read-only tools run automatically; writes still need approval |
| `allow-safe-actions` | Read + standard tools automatic; risky tools need approval |
| `allow-policy-actions` | Everything runs per configured policy |

---

## 6. Slash Commands

Type these in the chat input to access special functionality.

| Command | What it does |
|---------|-------------|
| `/status` | Shows AI runtime status: connection, active model, context window, temperature, RAG availability, indexing state, token budget |
| `/new` | Starts a new chat session (clears history) |
| `/models` | Lists installed Ollama models with sizes and details |
| `/doctor` | Runs a full diagnostic check: Ollama connectivity, model availability, embedding model, index health, MCP servers |
| `/think` | Enables extended thinking mode — the AI shows its reasoning process |
| `/usage` | Shows token usage statistics for the current session |
| `/tools` | Lists all available tools with current permissions and profile |
| `/verbose` | Toggles verbose mode — shows internal context, RAG retrieval, tool calls in detail |
| `/context` | Shows what context the AI currently has access to |
| `/init` | Re-initializes the workspace context (re-reads SOUL.md, AGENTS.md, etc.) |
| `/compact` | Compacts conversation history to save tokens |
| `/skill` | Lists or invokes workspace skills |

### Common Workflows

**Check if everything is working:**
```
/doctor
```

**See what model you're using and switch:**
```
/models
```

**Start fresh:**
```
/new
```

**Inspect what tools the AI has:**
```
/tools
```

**Debug unexpected behavior:**
```
/verbose
/status
```

---

## 7. Context System

The quality of AI responses depends heavily on what context it can see. Understanding context helps you get better results.

### What Counts as Context

| Context Source | How it enters | Automatic? |
|--------------|--------------|-----------|
| Your message | You type it | Yes |
| Attached files | Drag or paste files into chat | Manual |
| @mentions | `@file:...`, `@folder:...`, `@workspace`, `@terminal` | Manual |
| RAG retrieval | Relevant workspace chunks are fetched | Yes |
| Conversation history | Prior turns in the session | Yes |
| Workspace prompt files | `SOUL.md`, `AGENTS.md`, `TOOLS.md` | Yes |
| Bootstrap files | `.parallx/` config files | Yes (on init) |
| Memory files | `.parallx/memory/` | Yes |

### @Mentions

Use mentions to explicitly tell the AI what to look at:

| Mention | Meaning |
|---------|---------|
| `@file:src/main.ts` | Include this specific file in context |
| `@folder:src/services` | Include this directory listing in context |
| `@workspace` | Include workspace-level context |
| `@terminal` | Include recent terminal output |

### Context Pills

Attached context appears as visible pills in the chat UI. You can:
- See exactly what the AI is working from
- Remove context you didn't intend to add
- Verify the AI has the right files before asking a question

### Best Practices for Better Answers

1. **Attach the exact file** when asking about specific code
2. **Mention the exact folder** when asking about a module
3. **Ask for citations** when accuracy matters
4. **Tell the AI to answer only from provided context** when you need grounded answers
5. **Use `/compact`** when conversations get long — the AI loses quality as the context window fills up

### Token Budget

The AI's context window is divided into segments:

| Segment | Allocation | Purpose |
|---------|-----------|---------|
| System prompt | 10% | Identity, instructions, workspace rules |
| RAG context | 30% | Retrieved workspace knowledge |
| Conversation history | 30% | Prior turns |
| User message | 30% | Your current message + attachments |

If any segment is too large, it gets trimmed. This is why `/compact` helps — it reduces history to make room for more useful context.

---

## 8. RAG — Knowledge Retrieval

RAG (Retrieval-Augmented Generation) lets the AI search your workspace knowledge when answering questions, without you manually attaching every file.

### How It Works

1. **Indexing:** When you open a workspace, Parallx indexes text content into chunks
2. **Embedding:** Each chunk gets converted to a 768-dimension vector using nomic-embed-text
3. **Storage:** Vectors stored in sqlite-vec (SQLite + vector extension)
4. **Search:** When you ask a question, the system runs two parallel searches:
   - **Vector search** — finds semantically similar chunks (cosine similarity)
   - **Keyword search** — finds exact term matches (FTS5 BM25 scoring)
5. **Fusion:** Results from both searches are merged using Reciprocal Rank Fusion (RRF)
6. **Injection:** Top-K chunks are injected into the AI's context

### Supported Document Types

| Type | Extensions |
|------|-----------|
| Text files | `.md`, `.txt`, `.ts`, `.js`, `.py`, `.json`, `.yaml`, `.html`, `.css`, etc. |
| Rich documents | `.pdf`, `.docx`, `.xlsx`, `.xls`, `.csv`, `.tsv`, `.ods`, `.numbers` |

Rich documents are automatically extracted to text during indexing.

### When RAG Helps

- "What does our authentication system look like?"
- "Find all the error handling patterns in the codebase"
- "What does Chapter 3 of [imported book] say about X?"

### When RAG Doesn't Help

- Very new files not yet indexed (check with `/status`)
- Extremely specific queries that match no indexed content
- Questions about things outside the workspace

### Improving RAG Results

If the AI seems to miss relevant content:
1. **Rephrase with specific terms** that appear in the target document
2. **Use `@file:` mentions** for files you know are relevant
3. **Use `search_knowledge` directly** by asking the AI: "Search the knowledge base for X"
4. **Check indexing status** with `/status` — the file might not be indexed yet

---

## 9. AI Settings

AI Settings control the AI's behavior. Access them through the settings panel.

### Persona Settings

| Setting | What it controls |
|---------|-----------------|
| `name` | Display name (default: "Parallx AI") |
| `description` | One-sentence description shown in the UI |
| `avatarEmoji` | Avatar icon (e.g., "avatar-brain") |

### Chat Settings

| Setting | What it controls | Values |
|---------|-----------------|--------|
| `systemPrompt` | System prompt injected at top of every conversation | Free text |
| `systemPromptIsCustom` | Whether you've overridden the auto-generated prompt | true/false |
| `responseLength` | How long responses tend to be | short, medium, long, adaptive |

### Model Settings

| Setting | What it controls | Default |
|---------|-----------------|---------|
| `defaultModel` | Preferred model for new sessions | (auto-select) |
| `temperature` | 0.0 = deterministic, 1.0 = creative | Model default |
| `maxTokens` | Max tokens per response (0 = model default) | 0 |
| `contextWindow` | Context window size override (0 = model default) | 0 |

### Suggestion Settings

| Setting | What it controls | Values |
|---------|-----------------|--------|
| `tone` | Proactive suggestion tone | concise, balanced, detailed |
| `focusDomain` | Domain focus | general, finance, writing, coding, research, custom |
| `suggestionsEnabled` | Show proactive suggestion cards | true/false |
| `suggestionConfidenceThreshold` | Minimum confidence to show a suggestion | 0.0–1.0 |

### Beginner Advice

Start with only these settings:
1. **responseLength** — set to "medium" or "adaptive"
2. **temperature** — leave at default unless you want more creative or more precise output
3. **suggestionsEnabled** — turn off if suggestion cards are distracting

Test a few prompts after each change to see the effect.

---

## 10. Skills

Skills are reusable AI behaviors or workflows defined as Markdown files.

### Workspace Skills

Live in your workspace and are fully under your control:

```
.parallx/skills/<skill-name>/SKILL.md
```

Example:
```
.parallx/skills/release-checklist/SKILL.md
```

### What a Skill Looks Like

A skill file is a Markdown document that describes:
- What the skill does
- When the AI should use it
- Step-by-step instructions
- Expected inputs and outputs

### Invoking a Skill

```
/skill release-checklist
```

Or let the AI auto-select by describing your task — the AI matches your request to available skills.

### When to Create Skills

- Recurring workflows (release, review, formatting)
- Project-specific writing conventions
- Team-standard code patterns
- Quality checklists

### Built-In Skills

Parallx includes built-in workflow skills for common tasks. These are product-provided and not editable.

---

## 11. Memory and Workspace Files

### Workspace Prompt Files

These files shape the AI's identity and behavior for your workspace:

| File | Purpose |
|------|---------|
| `SOUL.md` | Identity, tone, boundaries, personality |
| `AGENTS.md` | Project context, conventions, coding instructions |
| `TOOLS.md` | Notes about tools and local conventions |

The AI reads these automatically at session start. Edit them to customize behavior per-workspace.

### Memory Files

Persistent memory lives under:

```
.parallx/memory/
```

Typical files:
- `.parallx/memory/MEMORY.md` — long-term memory
- `.parallx/memory/YYYY-MM-DD.md` — dated session notes

**Why this matters:** Memory is inspectable. You can read, edit, or delete memory files directly. Nothing is hidden in a private database.

**Memory architecture:** Two layers — `durable` (long-term memory in `MEMORY.md`) and `daily` (date-stamped entries in `YYYY-MM-DD.md`). Memory root is `.parallx/memory/`, with `MEMORY.md` as the durable file.

The AI can access memory through:
- `memory_get` — retrieve specific entries
- `memory_search` — search by keyword

---

## 12. MCP Servers — Extending the AI

MCP (Model Context Protocol) lets you add new tools to the AI by running external servers.

### How MCP Works

```
┌──────────┐     stdio      ┌──────────────┐
│ OpenClaw │◄──────────────►│  MCP Server  │
│ Runtime  │  JSON-RPC 2.0  │  (external)  │
└──────────┘                └──────────────┘
```

1. MCP server runs as a separate process
2. Communication via stdio (standard input/output)
3. Protocol: JSON-RPC 2.0
4. Tools appear in the AI's tool palette as `mcp__<serverId>__<toolName>`

### Configuring an MCP Server

Add server configurations through the MCP settings panel. Each server needs:

| Field | Description |
|-------|-------------|
| `id` | Unique identifier |
| `name` | Human-readable name |
| `transport` | `stdio` (primary) or `sse` (server-sent events) |
| `command` | Command to run (e.g., `npx`, `node`, `python`) |
| `args` | Arguments to the command |
| `enabled` | Whether the server is active |

**Example — adding a filesystem MCP server:**
```json
{
  "id": "filesystem",
  "name": "Filesystem Tools",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"],
  "enabled": true
}
```

### Health Monitoring

MCP connections are monitored automatically:

| Feature | Detail |
|---------|--------|
| Health ping | Every 30 seconds |
| Unhealthy threshold | 3 consecutive failures |
| Auto-reconnect | Up to 5 attempts with exponential backoff |
| Request timeout | 30 seconds per tool call |

### Finding MCP Servers

MCP is an open standard. Community-built servers exist for:
- Web search
- Database queries
- GitHub/GitLab integration
- Slack/Discord integration
- Custom API wrappers

Search npm for `@modelcontextprotocol/server-*` packages or check the MCP ecosystem directory.

---

## 13. Advanced Features

### 13.1 Heartbeat Runner — Proactive AI

The heartbeat runner allows the AI to check in periodically without user prompting.

| Setting | Default | Range |
|---------|---------|-------|
| Interval | 5 minutes | 30s – 60 minutes |

**Triggers:** Timer interval, file changes, index completions, cron jobs, external wake requests.

**What it does:** When triggered, the AI evaluates whether there's anything to report — new file changes, completed indexing, scheduled task results — and posts to the chat if relevant.

**Isolation:** Heartbeat turns are kept separate from your active conversation to avoid polluting chat history.

### 13.2 Cron / Scheduled Tasks

The AI can create and manage its own scheduled tasks.

**Schedule types:**
- `at` — One-shot at a specific time (ISO-8601)
- `every` — Repeating interval ("5m", "1h", "30s")
- `cron` — Standard 5-field cron expression

**Example prompt:**
```
Remind me to check the build output every 30 minutes.
```

The AI creates a cron job that fires every 30 minutes, pulls recent chat context, and posts a reminder.

**Limits:** Max 50 concurrent jobs, min 1-minute interval, up to 10 context messages per job.

### 13.3 Sub-Agent Delegation

For complex tasks, the AI can spawn sub-agents — isolated turn executions with their own task and optionally a different model.

| Feature | Detail |
|---------|--------|
| Mode | One-shot (runs task, returns result) |
| Max depth | 3 levels of nesting |
| Max concurrent | 5 simultaneous sub-tasks |
| Timeout | 120 seconds per sub-task |
| Model override | Each sub-agent can use a different Ollama model |

**When it's useful:** Large investigation tasks where the AI wants to explore multiple paths in parallel.

### 13.4 Interaction Modes

Behind the scenes, the AI can operate as different "roles":

| Mode | Description |
|------|-------------|
| `advisor` | Information and analysis |
| `researcher` | Deep investigation and synthesis |
| `executor` | Task execution with tools |
| `reviewer` | Code/content review |
| `operator` | Full autonomy |

These are typically selected automatically based on the task.

### 13.5 Turn Runner — Error Recovery

The AI runtime has built-in retry logic for common failures:

| Situation | What happens |
|-----------|-------------|
| **Context too long** | Automatically compacts conversation, re-assembles context, and retries (up to 3 times) |
| **Request timeout** | Force-compacts and retries (up to 2 times) |
| **Transient error** | Waits with exponential backoff (2.5s → 5s → 10s) and retries |
| **Budget >80% used** | Proactively compacts before the next turn to avoid overflow |

This means most temporary errors are handled invisibly. If you see an error message, it means the retries were exhausted.

---

## 14. Troubleshooting

### "Ollama is not connected"

1. Check if Ollama is running: open `http://localhost:11434` in a browser
2. If not running, start it: `ollama serve`
3. Run `/doctor` to verify

### "No models available"

1. Install a model: `ollama pull qwen2.5`
2. Verify: `ollama list`
3. Run `/models` in chat to see available models

### "RAG not available" or poor search results

1. Check if embedding model is installed: `ollama list | grep nomic`
2. If not installed: `ollama pull nomic-embed-text`
3. Check indexing status: `/status`
4. Wait for indexing to complete (🔄 indicator)

### AI responses are generic or miss context

1. **Attach relevant files** using @mentions
2. **Check what the AI sees**: `/verbose` then ask your question
3. **Rephrase** with specific terms from your codebase
4. **Use `/compact`** if the conversation is long

### Tool calls are failing

1. Run `/tools` to see tool status
2. Check if the tool is blocked by the current profile
3. Verify workspace folder is open (most tools need a workspace)

### MCP server won't connect

1. Run `/doctor` — it checks MCP server health
2. Verify the command exists: run it manually in a terminal
3. Check that `transport` is `stdio` (only supported transport)
4. Look for startup errors in the Parallx console (Help → Toggle Developer Tools)

### AI is slow

1. Check model size — smaller models (7B) are faster than larger ones (70B)
2. Reduce context window size in AI Settings
3. Use `/compact` to reduce conversation length
4. Close other GPU-intensive applications

---

## 15. Limitations

These are current architectural limitations. Some are planned for improvement.

| Limitation | Detail | Workaround |
|-----------|--------|-----------|
| **No internet access** | The AI cannot browse the web or call external APIs | Add MCP servers for network tools |
| **No GUI interaction** | Cannot take screenshots, click buttons, or control the UI | Use structured tools instead |
| **Workspace-only** | Cannot read files outside the open workspace | Open the needed folder as workspace |
| **Ollama-only models** | Cannot use OpenAI, Anthropic, or other cloud providers | Install models locally via Ollama |
| **No LLM re-ranking** | RAG uses statistical fusion, not model-based re-ranking | Rephrase queries with specific terms |
| **30s terminal timeout** | Long-running commands (servers, builds) may time out | Break work into shorter commands |
| **No interactive terminal** | Cannot respond to stdin prompts | Use non-interactive flags (e.g., `-y`) |
| **Single-skill execution** | Skills run independently, no chaining | Describe multi-step workflows in one prompt |
| **MCP stdio only** | No HTTP or WebSocket MCP transport | Use stdio or SSE-based MCP servers |

---

## 16. Sources

| Source | Location |
|--------|----------|
| Existing AI User Guide | [docs/ai/AI_USER_GUIDE.md](../ai/AI_USER_GUIDE.md) |
| Tool implementations | [src/built-in/chat/tools/](../../src/built-in/chat/tools/) |
| Tool policy | [src/openclaw/openclawToolPolicy.ts](../../src/openclaw/openclawToolPolicy.ts) |
| Agent types & autonomy | [src/agent/agentTypes.ts](../../src/agent/agentTypes.ts) |
| AI Settings types | [src/aiSettings/aiSettingsTypes.ts](../../src/aiSettings/aiSettingsTypes.ts) |
| Slash commands | [src/openclaw/commands/](../../src/openclaw/commands/) |
| MCP client | [src/openclaw/mcp/mcpClientService.ts](../../src/openclaw/mcp/mcpClientService.ts) |
| Embedding service | [src/services/embeddingService.ts](../../src/services/embeddingService.ts) |
| Heartbeat runner | [src/openclaw/openclawHeartbeatRunner.ts](../../src/openclaw/openclawHeartbeatRunner.ts) |
| Cron service | [src/openclaw/openclawCronService.ts](../../src/openclaw/openclawCronService.ts) |
| Sub-agent spawning | [src/openclaw/openclawSubagentSpawn.ts](../../src/openclaw/openclawSubagentSpawn.ts) |
| Capabilities assessment | [OPENCLAW_CAPABILITIES_ASSESSMENT.md](OPENCLAW_CAPABILITIES_ASSESSMENT.md) |
| Claude capabilities research | [CLAUDE_CAPABILITIES_RESEARCH.md](CLAUDE_CAPABILITIES_RESEARCH.md) |
