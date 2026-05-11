# Milestone 50 — Text Generator Extension

**Status:** In Progress  
**Branch:** `text-generation`  
**Depends on:** M48 at `bc43ddd` (merge to master)

---

## Vision

Build Parallx's **first external extension** — a character chat and interactive fiction generator powered by local Ollama models. This extension exercises the full tool API surface (`parallx.lm`, `parallx.views`, `parallx.editors`, `parallx.workspace.fs`, `ToolContext`) while remaining completely isolated from the built-in chat/openclaw AI integration.

### Why This Extension

1. **Proves the extension system works end-to-end.** No Parallx extension has ever been built outside the `src/built-in/` directory. This is the first real consumer of the public `parallx.*` API.
2. **Exercises critical API paths.** Model communication, sidebar views, editor tabs, filesystem access, persistence — all through the documented tool API, not internal services.
3. **Reveals API gaps.** Building a real extension will surface missing capabilities, broken contracts, and documentation holes in the tool API.
4. **Learning vehicle.** Prompt engineering for character consistency, system prompt design, conversation memory management, world-building context injection — all transferable to improving the main AI system.
5. **Zero risk to core AI.** Complete isolation — no changes to `src/openclaw/`, `src/built-in/chat/`, or any AI service code.

### What It Is

A workspace-scoped creative writing tool where the user defines characters and lorebooks as **`.md` files** (edited directly in the Parallx editor), then has freeform conversations or guided story sessions with those characters using local LLMs. The extension's job is simple: read `.md` files → assemble context → send to model → manage chat threads. The Parallx editor IS the character editor, lorebook editor, and memory editor.

### What It Is Not

- Not a chatbot framework or agent system
- Not a replacement for the built-in AI chat
- Not a cloud-connected service
- Not a multi-user or shared platform

---

## Research Findings

### Architectural Directive: Study and Clone, Never Join

The Text Generator's AI runtime — system prompt assembly, context window management, token budgeting, memory scoping — learns from the OpenClaw implementation in `src/openclaw/`. The directive is:

1. **Study the OpenClaw source directly.** Read the actual code — `openclawSystemPrompt.ts`, `openclawContextEngine.ts`, `openclawTokenBudget.ts` — before writing any Text Generator equivalent. Do not guess at how things work.
2. **Clone the architectural patterns.** If OpenClaw has a proven approach (structured prompt builder, elastic budget, parallel retrieval, compaction), clone that approach into the Text Generator's own code. The patterns are the same; the code is completely independent.
3. **The two tools are completely separate.** The Text Generator lives in `ext/text-generator/`. It does NOT import from `src/openclaw/`, does NOT share files, does NOT call into OpenClaw's pipeline, does NOT create bridges or shared utilities. These are two independent tools. Period.
4. **No integration, no replacement.** The Text Generator does not replace the built-in AI chat. It does not extend it. It does not depend on it. OpenClaw is a learning source — we study how it assembles context from `.md` files, how it manages token budgets, how it builds system prompts — and we clone those patterns into our own independent codebase.
5. **`.md` files are the data model.** OpenClaw already reads workspace `.md` files and assembles them into context. The Text Generator does the same thing: characters are `.md` files, lorebooks are `.md` files, memories are `.md` files. The user edits them in the Parallx editor — no custom editor UI needed. The extension's job is to read `.md` files → assemble context → send to model → manage chat threads.

**Why:** OpenClaw's implementation is proven to work — it handles small models well, manages token budgets correctly, and produces quality results. We already have a working system that reads markdown files and turns them into AI context. The Text Generator clones this approach for character chat. But they are two separate tools with two separate codebases. Study and copy, never join.

### Perchance Architecture (Reverse-Engineered from Export)

Analysis of the [Perchance AI Character Chat](https://perchance.org/ai-character-chat) export format (`perchance-characters-export-2026-04-01.json`) reveals 5 systems that map directly to what we need:

**1. Character Definition (System Prompt Source)**

Each character has a `roleInstruction` — the core identity prompt. Uses template variables (`{{char}}`, `{{user}}`) substituted at runtime. Ranges from a single sentence (Coding Assistant) to multi-paragraph persona definitions with strict behavioral rules (Chloe) to full bio/personality/backstory blocks (Ike, Mona). Also includes: `generalWritingInstructions` (style presets), `reminderMessage`, `initialMessages` (few-shot seeding), `temperature`, `maxTokensPerMessage`.

**2. Context Window Management**

`fitMessagesInContextMethod` per character: `"summarizeOld"` (compress old messages into progressive summaries) or `"dropOld"` (truncate). The `summaries` table + `currentSummaryHashChain` on threads form a hash-linked chain — older context is compressed, not lost. Maps to OpenClaw's `ContextEngine.compact()`.

**3. Thread-Scoped Memory**

The `memories` table indexes: `[characterId+status]`, `[threadId+status]`, `[threadId+index]`. Memories belong to a **thread (chat)**, not to a character globally. Two separate chats with the same character have completely independent memory pools. During generation, `memoryIdBatchesUsed` and `memoryQueriesUsed` on each message track exactly which memories were injected — full audit trail. The `[characterId+status]` index exists only for management (e.g., "show all memories across chats with Chloe"), not for retrieval during generation.

**4. Lore Books (External Knowledge)**

`lore` table + `loreBookUrls` on characters — structured world-building data retrieved by embedding similarity. Each message records `loreIdsUsed`. A second retrieval layer independent of memories.

**5. Message Visibility (`hiddenFrom`)**

Messages carry a `hiddenFrom` array: `["user"]` (AI sees it, user doesn't), `["ai"]` (user sees it, AI doesn't), `[]` (both see). This is how Perchance injects:
- **Few-shot examples** visible only to the AI (`hiddenFrom: ["user"]`)
- **Usage notes/credits** visible only to the user (`hiddenFrom: ["ai"]`)
- **Scenario narration** visible to both (`hiddenFrom: []`)

**Assembled Context at Generation Time:**

```
┌─────────────────────────────────────────────────────────────────┐
│ System: roleInstruction (with {{char}}/{{user}} substituted)    │
│ System: generalWritingInstructions (style preset)               │
│ System: reminderMessage (if any)                                │
├─────────────────────────────────────────────────────────────────┤
│ [Injected] Relevant memories (embedding-retrieved, per-thread)  │
│ [Injected] Relevant lore entries (embedding-retrieved)          │
│ [Injected] Summary of old messages (if summarizeOld)            │
├─────────────────────────────────────────────────────────────────┤
│ Messages (filtered: hiddenFrom != "ai"):                        │
│   - System messages (Scenario, Narrator, example dialogues)     │
│   - AI messages (character speech)                              │
│   - User messages                                               │
├─────────────────────────────────────────────────────────────────┤
│ Generation params: temperature, maxTokensPerMessage             │
└─────────────────────────────────────────────────────────────────┘
```

### OpenClaw ↔ Perchance ↔ Text Generator Mapping

| Perchance | OpenClaw (`src/openclaw/`) | Text Generator (clone independently) |
|-----------|---------------------------|--------------------------------------|
| `roleInstruction` + `{{char}}`/`{{user}}` | `buildOpenclawSystemPrompt()` — ~30 params, multi-section structured output | `buildCharacterSystemPrompt()` — reads character `.md` file, parses sections, substitutes variables |
| `fitMessagesInContextMethod` | `ContextEngine.compact()` — summarization-based compaction | `compactHistory()` — same summarize-old approach, per-thread |
| `memories` table (per-thread) | `recallMemories()` + `storeSessionMemory()` | Per-thread `memories.md` file — read fully, include what fits in budget |
| `loreBookUrls` + `lore` table | `retrieveContext()` (workspace RAG) | `lorebooks/*.md` files — read fully, include what fits in budget (no RAG in v1) |
| `hiddenFrom` on messages | N/A | `visibility` field on messages: `'both'` / `'ai-only'` / `'user-only'` |
| `summaryHashChain` | `compact()` generation counter | Progressive summary chain per thread |
| `memoryIdsUsed` / `loreIdsUsed` | `ragSources` on AssembleResult | Context audit — track exactly what the AI saw for each generation |
| Token budget (implicit via `maxTokensPerMessage`) | `computeTokenBudget()` — System 10%, RAG 30%, History 30%, User 30% | Adapted split: Character 15%, Lore+Memory 20%, History 35%, User 30% |
| `temperature`, `maxTokensPerMessage` | Per-model config | Per-character (in `.md` frontmatter) + per-thread overrides |
| Character editor UI | N/A | **No custom UI** — character `.md` files open in Parallx editor |
| Lore editor UI | N/A | **No custom UI** — lorebook `.md` files open in Parallx editor |
| Memory editor (`/mem`) | N/A | `/mem` slash command opens `memories.md` in Parallx editor |

### Source-to-Source Clone Map

The actual runtime to clone is ~200 lines across 3 OpenClaw files. Everything else in `src/openclaw/` (tool policy, skills, agents, mentions, citations, subagents, edit mode) is irrelevant to character chat.

**Clone these (independent re-implementation in `ext/text-generator/main.js`):**

| Text Generator needs | Clone from | Specific function | What it does |
|---|---|---|---|
| Read character `.md` | `openclawParticipantRuntime.ts` | `loadOpenclawBootstrapEntries()` | Reads `.md` files via `readFileRelative()` |
| Build system prompt | `openclawSystemPrompt.ts` | `buildOpenclawSystemPrompt()` | Joins sections: identity → context → rules |
| Token budget math | `openclawTokenBudget.ts` | `computeTokenBudget()`, `computeElasticBudget()` | Fixed % ceilings + surplus redistribution |
| Assemble context | `openclawContextEngine.ts` | `assemble()` | Load retrieval content + trim history to budget |
| Trim history | `openclawContextEngine.ts` | `trimHistoryToBudget()` | Fill from most recent backward |
| Compact on overflow | `openclawContextEngine.ts` | `compact()` | Summarize old messages, keep last exchange |
| Wire it all together | `openclawDefaultParticipant.ts` | `buildOpenclawTurnContext()` | Gets budget, loads files, creates engine, sends to runner |
| Token estimation | `openclawTokenBudget.ts` | `estimateTokens()` | One-liner: `chars / 4` |

**Do NOT clone (irrelevant to character chat):**

| OpenClaw feature | Why not needed |
|---|---|
| Tool policy pipeline | No tools in character chat |
| Skill state / catalog | No skills |
| Agent resolver / registry | Single character, not agents |
| Mention resolution (`@file`, `#variable`) | Character chat doesn't use mentions |
| Subagent spawning | Not relevant |
| Citation validation | Not relevant |
| File/selection attachments | Not relevant |
| Edit mode / steering turns | Not relevant |
| Concept extraction | Not relevant |
| Transcript recall | Not relevant |

**OpenClaw's actual flow (what we're cloning):**

```
1. loadBootstrapEntries()     →  Read character .md file from workspace
2. buildSystemPrompt()        →  Assemble sections from parsed .md content
3. computeTokenBudget()       →  Split context window into lanes
4. engine.assemble()          →  Load lore/memory + trim history to budget
5. sendChatRequest()          →  Stream response from Ollama
6. engine.compact()           →  If overflow, summarize old messages and retry
```

### Extension System Architecture

**Tool loading pipeline:** `~/.parallx/tools/<tool-id>/` → `parallx-manifest.json` → `toolActivator.ts` → `apiFactory.ts` → `activate(api, context)` is called with the full API object and a `ToolContext`.

**Manifest shape (`parallx-manifest.json`):**
```jsonc
{
  "id": "text-generator",
  "name": "Text Generator",
  "version": "0.1.0",
  "description": "Character chat & interactive fiction using local LLMs",
  "main": "dist/extension.js",
  "viewContainers": {
    "sidebar": [
      { "id": "text-generator-sidebar", "title": "Text Generator", "icon": "..." }
    ]
  },
  "views": {
    "text-generator-sidebar": [
      { "id": "text-generator-home", "name": "Home" }
    ]
  },
  "editors": [
    { "typeId": "text-generator-chat", "displayName": "Character Chat" }
  ],
  "commands": [
    { "id": "text-generator.newChat", "title": "New Chat" },
    { "id": "text-generator.newCharacter", "title": "New Character" }
  ]
}
```

**Note:** Only one custom editor type (`text-generator-chat`). Characters and lorebooks are `.md` files — the standard Parallx editor handles them. "New Character" creates a template `.md` file and opens it in the editor.

**Installation path:** Tools are installed from `.plx` ZIP files to `~/.parallx/tools/<tool-id>/`. During development, the tool directory can be symlinked or the path can be registered directly.

### API Surface (from `parallx.d.ts`)

| Namespace | Key Methods | Used By This Extension |
|-----------|-------------|----------------------|
| `parallx.lm` | `getModels()`, `sendChatRequest(modelId, messages, options)` → `AsyncIterable<IChatResponseChunk>` | **Yes** — all LLM communication |
| `parallx.views` | `registerViewProvider(viewId, provider, options)` | **Yes** — sidebar navigation |
| `parallx.editors` | `registerEditorProvider(typeId, provider)`, `openEditor({ typeId, title, icon, instanceId })` | **Yes** — chat tabs |
| `parallx.workspace.fs` | `readFile(path)`, `writeFile(path, content)`, `readDirectory(path)`, `stat(path)`, `delete(path)`, `createDirectory(path)` | **Yes** — workspace-scoped persistence |
| `parallx.commands` | `registerCommand(id, handler)`, `executeCommand(id, ...args)` | **Yes** — commands |
| `parallx.window` | `showNotification(message, type?)`, `showQuickPick(items, options?)` | **Yes** — user feedback |
| `parallx.context` | `setContext(key, value)` | Maybe — conditional UI |
| `ToolContext` | `globalState` (Memento), `workspaceState` (Memento), `storagePath`, `logPath` | **Yes** — settings, metadata |

### Model Communication Types

```typescript
interface IChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];     // base64
  toolCalls?: IToolCall[];
  thinking?: string;
}

interface IChatRequestOptions {
  temperature?: number;   // character creativity control
  topP?: number;
  maxTokens?: number;     // response length limit
  tools?: IToolDefinition[];
  format?: 'json' | object;
  seed?: number;          // reproducibility
  think?: boolean;
  numCtx?: number;        // context window
}

interface IChatResponseChunk {
  content?: string;
  thinking?: string;
  toolCalls?: IToolCall[];
  done: boolean;
  evalCount?: number;
  evalDuration?: number;
}
```

### Canvas Pattern (UI Reference)

The existing canvas built-in demonstrates the sidebar + editor pattern this extension will follow:

1. **Manifest** declares `viewContainers` (sidebar section) + `views` (sidebar content) + `editors` (tab types)
2. **Sidebar view** registers via `api.views.registerViewProvider()` — renders navigation (list of characters, chats, worlds)
3. **Editor provider** registers via `api.editors.registerEditorProvider()` — renders content in tabs
4. **Navigation** triggers `api.editors.openEditor({ typeId, title, icon, instanceId })` — opens/focuses the relevant tab
5. **Routing** — the editor provider's `createEditorPane(container, input)` receives `input.id` (the `instanceId`) to determine what to render

### Known API Gaps & Constraints

| # | Gap | Impact | Mitigation |
|---|-----|--------|------------|
| 1 | `sendChatRequest` sets active model globally before sending | Concurrent requests from built-in chat + this extension could race | Sequential requests only; user unlikely to use both simultaneously |
| 2 | No rich text rendering component in API | Chat display must be built from scratch | Build simple markdown→HTML renderer or use plain text with CSS styling |
| 3 | `parallx.lm` may be `undefined` if Ollama is not running | Extension crashes if not guarded | Check `parallx.lm` availability on activation, show user-friendly error |
| 4 | Memento quota: 5MB warning / 10MB hard limit | Cannot store large conversation histories in Memento | Use workspace filesystem (`parallx.workspace.fs`) for conversation data; Memento for settings/metadata only |
| 5 | No `AbortSignal` on `sendChatRequest` | Cannot cancel in-flight generation | Track generation state internally; discard chunks after user cancels (model still runs to completion) |
| 6 | No WebView API | Cannot use web frameworks (React, etc.) in editor panes | Build with vanilla DOM manipulation (consistent with all Parallx UI) |
| 7 | Activation events not configurable | Extension activates on load, not on demand | Acceptable for sidebar-based extension |
| 8 | `parallx.workspace.fs` path resolution | Need to confirm how relative paths resolve, whether `.parallx/extensions/` prefix works | Test during Phase 1 |

---

## Feature Configuration Plan

Every feature and exactly how it works. No ambiguity.

### Do we need RAG? No.

Lorebooks and memories are `.md` files. For v1, the extension reads them fully and includes what fits in the token budget. No embedding model. No vector database. No semantic search. If a lorebook is too big for the context window, it gets truncated (oldest/lowest-priority entries dropped). This is the same as OpenClaw's `trimHistoryToBudget()` — fill until budget exhausted, stop.

**Future:** If users create lorebooks with hundreds of entries that don't fit in context, we can add semantic search later. But that's not v1. V1 reads files and stuffs them in.

### Do we need an embedding model? No.

No embeddings. No `nomic-embed-text`. No `sqlite-vec`. No vector storage. The extension reads `.md` files as plain text and includes them in the system prompt under the token budget.

### Feature-by-Feature Configuration

| # | Feature | How it's configured | Storage | Needs RAG? | Needs embedding? | Needs custom UI? |
|---|---------|-------------------|---------|-----------|-----------------|-----------------|
| 1 | **Character identity** | User writes a `.md` file with YAML frontmatter + body sections | `characters/*.md` in workspace | No | No | No — edited in Parallx editor |
| 2 | **Lorebooks** | User writes `.md` files with `##` section entries | `lorebooks/*.md` in workspace | No — read fully, include what fits | No | No — edited in Parallx editor |
| 3 | **Per-thread memories** | Auto-generated `.md` file per thread, user can edit | `.parallx/extensions/text-generator/threads/<id>/memories.md` | No — read fully, include what fits | No | No — `/mem` opens in editor |
| 4 | **System prompt** | Built by extension from character `.md` sections | In-memory (assembled per turn) | No | No | No |
| 5 | **Token budget** | `estimateTokens()` (chars/4), fixed % split | In-memory math | No | No | No |
| 6 | **History management** | Messages stored as JSONL, trimmed to budget per turn | `.parallx/extensions/text-generator/threads/<id>/messages.jsonl` | No | No | No |
| 7 | **Compaction** | Summarize old messages via model call when history overflows budget | Summaries prepended to history in-memory | No | No | No |
| 8 | **Model selection** | Dropdown in chat UI, default from character `.md` frontmatter | `modelId` in thread metadata | No | No | Just a `<select>` element |
| 9 | **Temperature / max tokens** | Character `.md` frontmatter, overridable per thread | Frontmatter + thread settings | No | No | No |
| 10 | **Initial messages** | `## Initial Messages` section in character `.md` | Character `.md` body | No | No | No |
| 11 | **Message visibility** | `[AI; hiddenFrom=user]` syntax in initial messages | Parsed from character `.md` | No | No | No |
| 12 | **Reminder** | `## Reminder` section in character `.md` | Character `.md` body | No | No | No |
| 13 | **Variable substitution** | `{{char}}` and `{{user}}` in character `.md` | Replaced at runtime | No | No | No |
| 14 | **Thread management** | Thread metadata (characterFile, modelId, title) | `.parallx/extensions/text-generator/threads/<id>/thread.json` | No | No | No |
| 15 | **Sidebar navigation** | Extension scans `characters/` and `lorebooks/` dirs + thread list | `workspace.fs.readdir()` | No | No | Sidebar view only |
| 16 | **New character** | Creates template `.md` and opens in editor | `characters/` dir | No | No | No — just creates a file |
| 17 | **Slash commands** | `/mem`, `/lore`, `/sum`, `/name` | Parsed from user input in chat | No | No | No |
| 18 | **Streaming responses** | `parallx.lm.sendChatRequest()` → `AsyncIterable` | In-memory during generation | No | No | Chat UI only |

### What reading `.md` files replaces

| Perchance feature | How it worked in Perchance | How it works here |
|---|---|---|
| Character editor UI | Form with fields (name, personality, etc.) | User writes `characters/ada.md` in the Parallx editor |
| Lorebook editor UI | Dedicated lorebook editor with entry list | User writes `lorebooks/steampunk.md` in the Parallx editor |
| Memory editor | `/mem` opens in-app memory viewer | `/mem` opens `memories.md` in the Parallx editor |
| Lorebook URLs | Hosted text files at remote URLs | Local `.md` files in `lorebooks/` directory |
| Lore semantic search (thousands of entries) | Embedding-based retrieval | **Deferred** — v1 reads full file, truncates to budget. Semantic search if needed later. |

### Summary

**v1 is: read `.md` files → assemble system prompt → trim to budget → send to model → stream response → save messages.**

No RAG. No embeddings. No vector DB. No custom editors. No complex retrieval. Just file I/O + string assembly + LLM calls.

---

## Data Model

### Core Principle: Markdown Files Are the Data

Everything is a `.md` file. Characters, lorebooks, memories — all markdown files that the user edits directly in the Parallx editor. No custom editor UI. No JSON blobs. No special viewers.

This is the same pattern OpenClaw uses: workspace `.md` files are the source of truth, the runtime reads them and assembles context. The user's editor IS the character editor, the lorebook editor, the memory editor.

### Memory Scoping Rule

**Thread is the isolation boundary.** A memory belongs to a thread (chat), not to a character. Two separate chats with the same character have completely independent memory pools — no cross-contamination. The character definition (`.md` file) is shared across threads, but all accumulated context — messages, summaries, memories — is per-thread.

```
Character (.md)  ──1:N──  Thread (chat)
Thread           ──1:N──  Message
Thread           ──1:N──  Memory (.md, auto-generated, user-editable)
Thread           ──0:N──  Summary (progressive compaction chain)
```

### Storage Layout

All data lives in the workspace, organized as plain files:

```
<workspace>/
├── characters/
│   ├── ada-lovelace.md          # Character definition (frontmatter + body)
│   ├── captain-blackwood.md
│   └── the-oracle.md
├── lorebooks/
│   ├── steampunk-london.md      # World/setting lore entries
│   ├── victorian-science.md     # Topic-based lore
│   └── naval-terminology.md
├── .parallx/extensions/text-generator/
│   ├── threads/
│   │   ├── <uuid>/
│   │   │   ├── thread.json      # Thread metadata (characterId, title, modelId, summaryChain)
│   │   │   ├── messages.jsonl   # Message history (append-only)
│   │   │   └── memories.md      # Auto-generated + user-editable memories for this thread
│   │   └── ...
│   └── settings.json            # Extension-level preferences
```

**Why this split:** Characters and lorebooks are user-facing creative content — they belong at the workspace root where the user can see, browse, and edit them in the file explorer. Thread data (messages, per-thread memories) is runtime state — it belongs in `.parallx/` where it doesn't clutter the workspace.

### Character Format (`.md` with Frontmatter)

Characters are markdown files with YAML frontmatter. The user creates and edits them in the Parallx editor.

```markdown
---
name: Ada Lovelace
avatar: 🧮
temperature: 0.8
maxTokensPerMessage: 500
fitMessagesInContext: summarizeOld
traits: [visionary, analytical, warm]
---

# Role Instruction

You are Ada Lovelace, mathematician and visionary. Daughter of Lord Byron, mentored by Charles Babbage, author of the first computer program.

You speak in formal Victorian English with occasional mathematical metaphors. You are intensely curious, analytically rigorous, yet warmly enthusiastic about ideas.

## Writing Style

Formal Victorian English. Use "indeed", "most fascinating", "I dare say". Weave mathematical analogies into everyday conversation.

## Reminder

{{char}} always connects abstract concepts to the Analytical Engine. Never breaks character.

## Initial Messages

[AI]: Good day! I've been contemplating the most fascinating properties of Babbage's Analytical Engine. What brings you to my study today?

[SYSTEM; hiddenFrom=ai]: This character is based on the historical Ada Lovelace (1815-1852).

## Example Dialogue

[USER]: What do you think about modern computers?
[AI]: Indeed, what you describe sounds remarkably like what I envisioned for the Analytical Engine — a machine that could manipulate symbols according to rules, weaving algebraical patterns just as the Jacquard loom weaves flowers and leaves.
```

The extension parses the frontmatter for settings and the body for the system prompt sections. The `{{char}}`/`{{user}}` variables are substituted at runtime.

### Lorebook Format (`.md`)

Lorebooks are markdown files with self-contained entries separated by headings. Each `##` section is a discrete lore entry. The extension reads the full lorebook content and includes it in context under the token budget.

```markdown
# Steampunk London

## The Aether District
The Aether District is the scientific heart of London, where Charles Babbage's workshops produce Analytical Engines for the Empire. Steam-powered automata patrol the streets. The district is powered by difference engines the size of buildings.

## The Underground Railway
London's pneumatic underground railway connects all major districts. Powered by compressed steam, carriages reach speeds of 40 miles per hour. Tickets cost tuppence for standard class.

## Clockwork Constabulary
The Metropolitan Police supplement human officers with clockwork automata — 7-foot brass constructs that never tire and follow their patrol routes with mechanical precision. They cannot make arrests but can restrain suspects.
```

Each `##` section is a discrete lore entry. The extension reads all lorebook files and includes their content in the system prompt under the lore+memory token budget. If total content exceeds the budget, entries are truncated (last entries dropped first).

### Memory Format (`.md`, Per-Thread)

Memories are auto-generated markdown files — one per thread — that the user can also edit directly.

```markdown
# Thread Memories

## Auto-generated
- Ada revealed she has been working on a proof about recursive functions (turn 12)
- User mentioned they are a software engineer from 2024 (turn 3)
- Ada became emotional discussing her father Lord Byron (turn 8)

## User-added
- The user prefers Ada to focus on mathematics rather than poetry
- This conversation is set in 1843, after the Bernoulli numbers paper
```

The extension reads this file and includes it in the context before each reply (full content, truncated to the lore+memory token budget if needed).

### Thread Metadata (`thread.json`)

Thread metadata is the only JSON in the system — it's runtime state, not user-edited content:

```typescript
interface ThreadMetadata {
  id: string;                  // UUID
  title: string;               // user-set or auto-generated
  characterFile: string;       // relative path to character .md (e.g., "characters/ada-lovelace.md")
  lorebookFiles: string[];     // relative paths to lorebook .md files
  modelId: string;             // which Ollama model
  summaryChain: string[];      // progressive summary hashes
  createdAt: number;
  updatedAt: number;
}
```

### Message Format (`messages.jsonl`)

Messages are stored as newline-delimited JSON (one message per line, append-only):

```typescript
interface ThreadMessage {
  id: string;                  // UUID
  role: 'user' | 'assistant' | 'system';
  content: string;
  visibility: 'both' | 'ai-only' | 'user-only';
  name?: string;               // author name override
  memoryIdsUsed?: string[];    // which memory entries were injected (audit trail)
  loreIdsUsed?: string[];      // which lore entries were injected
  contextTokensUsed?: number;  // total context tokens at generation time
  timestamp: number;
}
```

### Settings Schema

```typescript
interface TextGeneratorSettings {
  defaultModelId: string;
  defaultTemperature: number;  // default: 0.8
  defaultMaxTokens: number;    // default: 2048
  defaultNumCtx: number;       // default: 4096
}
```

---

## System Prompt & Context Assembly

### Architectural Source

The prompt assembly and context management system is cloned from OpenClaw's proven implementation. Before writing any of this code, study the source — then write independent code in `ext/text-generator/` that follows the same patterns:

| Component | Study First | Function/Pattern | Clone As |
|-----------|------------|-----------------|----------|
| Prompt builder | `src/openclaw/openclawSystemPrompt.ts` | `buildOpenclawSystemPrompt()` — section-based assembly with budget-aware truncation | `buildCharacterSystemPrompt()` in `ext/text-generator/` |
| Token budget | `src/openclaw/openclawTokenBudget.ts` | `computeTokenBudget()`, `computeElasticBudget()` — percentage splits with surplus redistribution | `computeCharacterTokenBudget()` in `ext/text-generator/` |
| Context lifecycle | `src/openclaw/openclawContextEngine.ts` | `bootstrap()` → `assemble()` → `compact()` → `afterTurn()` | `assembleConversationContext()` in `ext/text-generator/` |
| History trimming | `src/openclaw/openclawContextEngine.ts` | `trimHistoryToBudget()` — fill from most-recent backward | Same pattern in `ext/text-generator/` |

**These are independent implementations.** The Text Generator code does NOT import from `src/openclaw/`. It re-implements the same patterns in its own codebase.

### How It Works: `.md` Files → Context → Model

The pattern is the same as OpenClaw: read `.md` files from the workspace, parse them, assemble sections under a token budget, send to model.

```
1. Read character .md file  →  Parse frontmatter + body sections
2. Read lorebook .md files  →  Include full content (truncate to budget if needed)
3. Read thread memories.md  →  Include full content (truncate to budget if needed)
4. Assemble system prompt   →  Section-based (identity → lore → memories → reminder)
5. Trim history to budget   →  Most recent messages first, within token ceiling
6. Send to model            →  parallx.lm.sendChatRequest()
```

### Prompt Structure (Section-Based, Cloned from OpenClaw Pattern)

Follows the same section-based assembly as `buildOpenclawSystemPrompt()`, reading from `.md` files:

```
Section 1: Character Identity (from character .md body — # Role Instruction)
─────────────────────────────
You are {name}. {roleInstruction with {{char}}/{{user}} substituted}

Section 2: Writing Instructions (from character .md body — ## Writing Style)
─────────────────────────────
{writingInstructions}

Section 3: Lore (read fully from lorebook .md files, truncated to budget)
─────────────────────────────
## Relevant Lore
{lorebook .md content, included fully if it fits, truncated if over budget}

Section 4: Recalled Memories (from thread memories.md, truncated to budget)
─────────────────────────────
## Recalled Context
{thread memories.md content, included fully if it fits, truncated if over budget}

Section 5: Reminder Message (from character .md body — ## Reminder)
─────────────────────────────
{reminderMessage — reinforcement near end of context for character consistency}

Section 6: Behavioral Rules
─────────────────────────────
- Stay in character at all times
- Respond as {name} would
- Do not break the fourth wall unless the character would
- Do not narrate the user's actions or feelings
```

Then the message array:

```
[system prompt from above]
[initial messages filtered by visibility != 'user-only']
[conversation history, most recent N messages that fit budget]
[current user message]
```

### Token Budget (Adapted from OpenClaw)

OpenClaw uses System 10% / RAG 30% / History 30% / User 30%. The Text Generator adapts this for character chat where the character prompt is larger and workspace RAG is replaced by lore/memory:

```
Total context window (e.g., 8192 tokens)
├── Character Prompt:  15%  (1228 tokens) — roleInstruction + writing instructions
├── Lore + Memory:     20%  (1638 tokens) — lorebook content + thread memories (read fully, truncated to budget)
├── History:           35%  (2867 tokens) — conversation messages (most recent first)
└── User + Response:   30%  (2459 tokens) — current message + space for model response
```

**Elastic redistribution** (from `computeElasticBudget()`): If the character prompt only uses 8% of the window, the surplus 7% flows to History. If there are no lore entries, the 20% flows to History. This maximizes conversational context — critical for maintaining character consistency over long chats.

**Token estimation**: `chars / 4` (same heuristic as OpenClaw's `estimateTokens()`).

### Context Window Management

For conversations that exceed the context window, two strategies (per-character setting):

**`summarizeOld` (default, recommended):**
Following OpenClaw's `compact()` pattern — when history exceeds its budget:
1. Take the oldest N messages that don't fit
2. Send to model: "Summarize the following conversation, preserving key facts, character details revealed, and emotional beats"
3. Replace the N messages with a single system message containing the summary
4. Chain summaries progressively — `summaryChain` tracks the hash sequence

**`dropOld`:**
Simple FIFO — oldest messages are dropped when budget is exceeded. Cheaper (no summarization call) but loses context.

### Conversation Context Lifecycle (Per-Turn)

Adapted from OpenClaw's `IOpenclawContextEngine` lifecycle:

```
1. bootstrap()   — Check what's available (lore loaded? memory service ready?)
2. assemble()    — Build the message array under budget:
                     a. Build character system prompt (Section 1-7)
                     b. Read lore + memory .md files (budget: 20%)
                     c. Retrieve thread-scoped memories (within lore budget)
                     d. Filter initial messages by visibility
                     e. Trim history to budget (most recent first)
                     f. Append current user message
3. generate()    — Send assembled messages to model, stream response
4. afterTurn()   — Persist: save messages, update memories, check if compaction needed
5. compact()     — If history exceeds budget for next turn, summarize oldest messages
```

### Model Picker (Development Aid)

During development, each chat includes a model selector dropdown in the input area. This allows testing how different models (7B, 14B, 20B) handle character consistency with the same prompt structure. The model picker reads from `parallx.lm.getModels()` and sets `conversation.modelId`.

**Design intent:** This will eventually become a per-character default (set in the character editor) rather than a per-message choice. But for development and testing, the in-chat picker is essential.

---

## UI Design

### Sidebar (Navigation)

The sidebar is the extension's navigation hub. It scans the workspace for character `.md` files and lorebook `.md` files, and lists active threads.

```
┌─────────────────────────────┐
│  TEXT GENERATOR              │
├─────────────────────────────┤
│                             │
│  ▸ Characters (3)           │
│    ● Ada Lovelace           │  ← characters/*.md
│    ● Captain Blackwood      │
│    ● The Oracle             │
│                             │
│  ▸ Lorebooks (2)            │
│    ● Steampunk London       │  ← lorebooks/*.md
│    ● Victorian Science      │
│                             │
│  ▸ Threads (5)              │
│    ● Ada: Computing theory  │  ← .parallx/extensions/text-generator/threads/
│    ● Blackwood: The voyage  │
│    ● Oracle: The prophecy   │
│    ● Ada: Babbage redesign  │
│    ● Blackwood: Mutiny      │
│                             │
│  [+ New Character]          │  ← creates characters/new-character.md with template
│  [+ New Chat]               │  ← pick character → opens chat editor
│                             │
└─────────────────────────────┘
```

- Clicking a character **opens the `.md` file in the Parallx editor** — user edits it directly
- Clicking a lorebook **opens the `.md` file in the Parallx editor**
- Clicking a thread opens the **Chat View** in the editor area
- "New Character" creates a template `.md` file and opens it in the editor
- "New Chat" prompts for character selection, creates thread, opens Chat View

### Editor: Chat View

The primary interaction surface. Opens as a tab in the editor area. This is the ONLY custom editor the extension creates — characters and lorebooks are `.md` files edited in the standard Parallx editor.

```
┌──────────────────────────────────────────────────┐
│  [Ada Lovelace]                       [⚙] [🗑]  │  ← tab header
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌─ Ada ─────────────────────────────────────┐   │
│  │ Good day! I've been contemplating the     │   │
│  │ most fascinating properties of Babbage's  │   │
│  │ Analytical Engine. What brings you to     │   │
│  │ my study today?                           │   │
│  └───────────────────────────────────────────┘   │
│                                                  │
│  ┌─ You ─────────────────────────────────────┐   │
│  │ I'm curious about your notes on          │   │
│  │ Bernoulli numbers.                        │   │
│  └───────────────────────────────────────────┘   │
│                                                  │
│  ┌─ Ada ─────────────────────────────────────┐   │
│  │ Ah! The very heart of my Note G! You see, │   │
│  │ the Engine could be instructed to compute │   │
│  │ them through a sequence of operations...  │   │
│  │ ▌ (streaming)                             │   │
│  └───────────────────────────────────────────┘   │
│                                                  │
├──────────────────────────────────────────────────┤
│  [Type your message...]              [Send ▶]    │
└──────────────────────────────────────────────────┘
```

- Messages stream in chunk-by-chunk via `AsyncIterable<IChatResponseChunk>`
- User can type while the model is generating (queue the message)
- Chat auto-scrolls to bottom on new content
- Settings gear opens a panel to change model, temperature, max tokens for this conversation

---

## Phase Plan

### Phase 0: Extension System Validation (SCAFFOLD)

**Goal:** Prove the extension system works end-to-end: build a `.plx` package, install it via the Tool Gallery, get a sidebar icon in the activity bar, open a basic chat editor tab, and confirm `parallx.lm` connectivity. This is the entire reason we're building this extension.

**Status:** ✅ COMPLETE — Extension installs, activates, sidebar renders, Ollama connected.

**What was built:**

- [x] **0.1** `ext/text-generator/parallx-manifest.json` — declares `viewContainers` (sidebar), `views` (home), `commands` (newChat), id `parallx-community.text-generator`
- [x] **0.2** `ext/text-generator/main.js` — `activate(parallx, context)` entry point that registers sidebar view provider, chat editor provider, and new-chat command
- [x] **0.3** `scripts/package-text-generator.mjs` — build script that packages the extension as `text-generator.plx` (ZIP with `parallx-manifest.json` + `main.js` at root)
- [x] **0.4** `.plx` file produced and verified (4.1 KB, correct ZIP structure matching Electron handler's expectations)
- [x] **0.5** Fixed external tool module loading — CSP blocked `data:`/`file:` URL imports from `http://` origin. Added `blob:` to `script-src` in CSP, switched `ToolModuleLoader` to blob URL approach via IPC bridge (`readToolModule`)
- [x] **0.6** Extension source moved from `tools/` (auto-discovered as built-in) to `ext/` (development-only, not scanned)

**Key fix — CSP + Module Loading:**

External tools can't be loaded via `import(file:///...)` because Chromium blocks cross-origin script loading from an `http://` origin. The solution:
1. Electron main process reads the `.js` source via IPC (`tools:read-module` handler)
2. Renderer creates a `Blob` from the source and imports via `import(blobUrl)`
3. CSP `script-src` updated to include `blob:` (origin-scoped, secure)

Files changed: `electron/main.cjs` (IPC handler), `electron/preload.cjs` (bridge), `electron/index.html` (CSP), `src/tools/toolModuleLoader.ts` (blob URL loader), `src/main.ts` (type declaration)

**How the install flow works (researched from source):**

1. User opens Parallx → navigates to Tool Gallery sidebar → clicks download/install button
2. `api.tools.installFromFile()` triggers Electron IPC `tools:install-from-file`
3. Electron opens native file dialog filtered to `.plx` files
4. User selects `text-generator.plx`
5. Electron extracts ZIP to `~/.parallx/tools/parallx-community.text-generator/`
6. Electron validates: `parallx-manifest.json` exists, `main.js` exists, manifest has `id`/`name`/`version`
7. Returns `{ toolId, toolPath, manifest }` to renderer
8. Workbench `onToolInstalled` callback: registers in `ToolRegistry`, processes view contributions (creates activity bar icon + placeholder view), activates tool via `ToolActivator`
9. `ToolActivator` calls `ToolModuleLoader.loadModule()` → IPC reads source → `import(blobUrl)` → calls `activate(api, context)`
10. Extension code registers view provider (fills placeholder), registers editor provider, registers commands
11. Activity bar shows "Text Generator" icon (Lucide `book-open`), sidebar renders

**Sidebar features in scaffold:**
- Ollama connection status (green/red based on `parallx.lm` availability)
- Model count from `parallx.lm.getModels()`
- "New Chat" button → opens chat editor tab
- Placeholder sections for Characters, Worlds, Conversations

**Chat editor features in scaffold:**
- Welcome screen
- Text input with Send button (Enter to send, Shift+Enter for newline)
- Streaming AI response via `parallx.lm.sendChatRequest()` with `AsyncIterable`
- Basic error handling (Ollama down, no models, generation failure)

**Manual verification required:**
```
1. Open Parallx
2. Go to Tool Gallery (puzzle piece icon in activity bar)
3. Click the install/download button in the sidebar header
4. Select tools/text-generator/text-generator.plx
5. Verify: new "Text Generator" icon appears in activity bar
6. Click it → sidebar shows with Ollama status + sections
7. Click "New Chat" → editor tab opens with chat UI
8. Type a message → AI responds with streaming text
```

**Files:**
| File | Purpose |
|------|---------|
| `ext/text-generator/parallx-manifest.json` | Extension manifest |
| `ext/text-generator/main.js` | Extension entry point |
| `scripts/package-text-generator.mjs` | Build script for `.plx` package |
| `ext/text-generator/text-generator.plx` | Installable package (generated) |
| `electron/main.cjs` | Added `tools:read-module` IPC handler |
| `electron/preload.cjs` | Added `readToolModule` bridge |
| `electron/index.html` | Updated CSP: `blob:` in `script-src` |
| `src/tools/toolModuleLoader.ts` | Blob URL loader for external tools |

---

### Phase 1: Markdown Data Layer & Sidebar Navigation

**Goal:** Implement character/lorebook discovery from workspace `.md` files, thread persistence, and wire the sidebar to display and navigate them.

**Tasks:**

- [ ] **1.1** Implement `CharacterParser` — reads `characters/*.md`, parses YAML frontmatter + body sections (role instruction, writing style, reminder, initial messages, example dialogue)
- [ ] **1.2** Implement `LorebookParser` — reads `lorebooks/*.md`, splits by `##` headings into independent entries
- [ ] **1.3** Implement `ThreadService` — CRUD for threads at `.parallx/extensions/text-generator/threads/`, manages `thread.json` metadata + `messages.jsonl` + `memories.md`
- [ ] **1.4** Implement sidebar view — three sections (Characters, Lorebooks, Threads) scanning the workspace filesystem
- [ ] **1.5** Wire sidebar: clicking character/lorebook opens `.md` file in editor, clicking thread opens chat editor
- [ ] **1.6** Implement "New Character" — creates template `.md` file at `characters/` and opens in editor
- [ ] **1.7** Verify: sidebar lists update when files change, clicking items opens correct views

**Verification:**
```
- Create characters/test.md manually → appears in sidebar
- Click character in sidebar → .md file opens in editor
- Create lorebooks/test.md → appears in sidebar
- Click lorebook → opens in editor
- Thread list shows existing threads
```

### Phase 2: Chat View & Generation

**Goal:** Build the conversation UI with streaming LLM generation, model picker, and OpenClaw-derived context assembly. This is the core feature. Everything in this phase is independent code in `ext/text-generator/` — no imports from `src/openclaw/`.

**Prerequisite:** Study these OpenClaw source files to understand the patterns, then clone them independently:
- `src/openclaw/openclawSystemPrompt.ts` — `buildOpenclawSystemPrompt()`, section assembly pattern
- `src/openclaw/openclawContextEngine.ts` — `assemble()`, `compact()`, history trimming, parallel retrieval
- `src/openclaw/openclawTokenBudget.ts` — `computeTokenBudget()`, `computeElasticBudget()`, `estimateTokens()`

**Tasks:**

- [ ] **2.1** Implement `ChatEditorProvider` — split layout with message history + input area + model picker dropdown
- [ ] **2.2** Build message rendering — alternating user/assistant bubbles with character name labels, respecting `visibility` field (hide `ai-only` messages from display)
- [ ] **2.3** Build input area — textarea + send button + model selector dropdown, Enter to send, Shift+Enter for newlines
- [ ] **2.4** Implement `buildCharacterSystemPrompt()` — section-based assembly (cloned from `buildOpenclawSystemPrompt()` pattern): reads character `.md` file → parses sections → identity → writing instructions → lore → memories → reminder → behavioral rules. Must support `{{char}}`/`{{user}}` variable substitution.
- [ ] **2.5** Implement `computeCharacterTokenBudget()` — cloned from `computeTokenBudget()`: Character 15%, Lore 20%, History 35%, User 30%. Include elastic redistribution.
- [ ] **2.6** Implement `assembleConversationContext()` — cloned from `assemble()`: read character `.md`, read lorebook `.md` files (include fully, truncate to budget), read thread `memories.md` (include fully, truncate to budget), trim history to budget (most recent first), append user message. Returns the complete message array.
- [ ] **2.7** Implement `GenerationService` — calls `parallx.lm.sendChatRequest()`, streams chunks to UI, manages generation state
- [ ] **2.8** Implement streaming display — append chunks to the current assistant message as they arrive
- [ ] **2.9** Implement thread persistence — auto-save messages to `messages.jsonl` after each exchange
- [ ] **2.10** Implement `compactHistory()` — cloned from `compact()`: when history exceeds budget, summarize oldest messages, chain summaries
- [ ] **2.11** Implement "New Chat" flow — character picker from `characters/*.md`, create thread, open chat
- [ ] **2.12** Style chat UI — message bubbles, streaming indicator, auto-scroll, model picker matching workbench conventions

**Verification:**
```
- Start new chat → pick character (from .md files) → chat opens
- Send message → model generates streaming response
- Thread persists — close and reopen shows full history
- Long conversations handle context window correctly
- Edit character .md → changes reflected in next generation
```

### Phase 3: Slash Commands & Polish

**Goal:** Slash commands for in-chat control, per-conversation settings, and UX polish.

**Tasks:**

- [ ] **3.1** Implement slash commands: `/mem` (open thread memories.md in editor), `/lore` (open lorebooks in editor), `/sum` (show/edit summary), `/name` (rename thread)
- [ ] **3.2** Implement per-conversation settings panel (temperature slider, max tokens, context window)
- [ ] **3.3** Implement extension settings (default model, default temperature, default max tokens)
- [ ] **3.4** Add thread title auto-generation (summarize first exchange) or manual rename
- [ ] **3.5** Add empty states for all views (no characters yet, no threads yet, etc.)
- [ ] **3.6** Add keyboard shortcuts (Ctrl+Enter to send, Escape to cancel, etc.)
- [ ] **3.7** Error handling — Ollama not running, model not found, generation failure, missing character file
- [ ] **3.8** Final styling pass — consistent with workbench dark theme

**Verification:**
```
- All settings save and load correctly
- Slash commands work: /mem opens memories.md, /lore opens lorebook
- Empty states guide the user
- Extension handles all error conditions gracefully
- Visual style is consistent with the rest of Parallx
```

---

## API Gap Resolution Plan

Issues discovered during research that need resolution before or during implementation:

| Gap | Resolution | When |
|-----|-----------|------|
| `parallx.lm` undefined when Ollama is down | Guard on activation; show "Ollama not running" in sidebar, disable chat | Phase 1 |
| No AbortSignal for generation cancellation | Track `isGenerating` state; discard incoming chunks after cancel; accept model runs to completion | Phase 2 |
| Concurrent model request race | Extension runs sequentially; one generation at a time per chat tab | Phase 2 |
| Memento 10MB limit | Not an issue — characters and lorebooks are workspace `.md` files. Only `settings.json` uses Memento. | N/A |
| `parallx.workspace.fs` path behavior | Test path resolution in Phase 1; confirm reading `characters/*.md` from workspace root works | Phase 1 |
| No rich text / markdown rendering | Build minimal markdown→HTML converter (bold, italic, code, paragraphs, lists) — model output is mostly plaintext with light formatting | Phase 2 |

---

## Non-Goals (Explicitly Out of Scope)

- **Image generation** — Text only. Ollama is a text LLM runtime.
- **Custom editor UI for characters/lorebooks/memories** — These are `.md` files. The Parallx editor IS the editor. No form-based editors, no special viewers.
- **Multi-character group chats** — Single character per conversation. Group chats add routing complexity that distracts from the core learning goals.
- **Voice / TTS** — Text only.
- **Cloud sync** — Workspace-scoped only. No accounts, no servers.
- **Character marketplace / sharing** — Characters are `.md` files; users can share them manually via copy/paste.
- **Plugin system within the extension** — The extension itself is the plugin. No meta-extension architecture.
- **Automated testing / eval** — This is a creative tool. Quality is subjective and assessed by the user.
- **OpenClaw integration** — This extension studies OpenClaw's patterns and clones them independently. It does NOT import from, link to, call into, or share code with `src/openclaw/`. The two tools are completely separate. We learn from OpenClaw, we do not integrate with it.

---

## Success Criteria

1. Extension installs and activates without errors
2. User can create a character by creating a `.md` file with frontmatter in `characters/`
3. User can create lorebooks by creating `.md` files in `lorebooks/`
4. User can start a conversation with a character — the extension reads the `.md` file and assembles context
5. Model generates streaming responses that stay in character
6. Conversations persist across sessions (`.parallx/extensions/text-generator/threads/`)
7. Lorebook content is included in context from `.md` files (read fully, truncated to budget)
8. Thread memories are auto-generated and user-editable as `.md` files
9. The extension uses only the public `parallx.*` API — no internal service imports
10. Works with models as small as `qwen2.5:7b` (character consistency may vary, but functional)
11. Zero changes to any file in `src/built-in/` or `src/openclaw/`
12. Zero imports from `src/openclaw/` — all patterns are independently re-implemented

---

## Open Questions

1. **Development workflow** — Should we build inside `~/.parallx/tools/text-generator/` directly, or build in the repo and symlink? Symlink is cleaner for version control.
2. **Build tooling** — The extension needs bundling (esbuild) to produce a single `dist/extension.js`. Should this be a separate `package.json` with its own build script, or integrated into the main build?
3. **TypeScript types** — The extension needs `parallx.d.ts` for type-checking. Is this file already published somewhere, or does it need to be extracted from the source?
4. **Hot reload** — Can tools be reloaded without restarting Parallx? If not, the dev cycle is restart-on-every-change.
5. **Character file discovery** — Should the extension scan `characters/` at workspace root, or should the user configure the path? Defaulting to `characters/` with an override in settings seems right.
6. **Embedding access** — Does the `parallx.*` API expose embedding functionality, or does the extension need to call Ollama's `/api/embed` directly? This matters for lorebook/memory semantic search.
