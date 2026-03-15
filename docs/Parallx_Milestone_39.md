# Milestone 39 — Skill-Based Workflow Engine

> Scope note
>
> Milestone 39 extends the existing skill system (M11) from declarative tool
> manifests into a **workflow orchestration layer**. Skills evolve from "what
> a tool does" to "how to accomplish a class of tasks."
>
> Milestone 38 defined the planned evidence engine with typed execution plans,
> scoped retrieval, and coverage tracking. Milestone 39 builds on that by
> introducing **workflow skills** — prompt-based playbooks that the planner
> selects based on user intent, injected as dynamic instructions that guide
> the model through multi-step tool-calling sequences.

---

## Table of Contents

1. Problem Statement
2. Research: How the Industry Does It
3. Current Parallx State
4. Architectural Diagnosis
5. Milestone 39 Product Contract
6. Target Architecture
7. Canonical Internal Objects
8. Stress-Test Workspace
9. Execution Plan
10. Exact File Map
11. Success Criteria
12. Non-Goals

---

## 1. Problem Statement

Parallx's M11 skill system treats skills as **tool manifests** — each
`SKILL.md` declares a single tool's parameters, permissions, and description.
The model decides when and how to call each tool. This works for discrete
operations (read a file, search the workspace) but breaks down for **composite
workflows** that require a specific sequence of tool calls, iteration patterns,
or context management.

### The real-world failure

User opens a workspace with 18 PDF files and asks: *"Summarize each file."*

What happens today:

1. `chatTurnRouter.ts` classifies this as `coverageMode: 'exhaustive'`.
2. `chatContextPlanner.ts` suppresses RAG (correct — global retrieval can't
   cover 18 files).
3. The model enters the agentic loop (`chatGroundedExecutor.ts`) with no
   guidance on approach.
4. It calls `search_knowledge` once with a broad query.
5. Retrieval returns chunks from ~8–10 files (K=20, maxPerSource=5).
6. The model produces summaries for those files and silently skips the rest.
7. The user sees an incomplete answer with no indication of missing coverage.

### Why code-level fixes don't solve this

The instinct is to increase K, add multiple retrieval passes, or hard-code
exhaustive iteration logic into the evidence gatherer. These approaches fail
because:

- **Non-determinism**: Retrieval scoring varies per query. No fixed K
  guarantees all 18 files surface.
- **Brittleness**: Hard-coded iteration logic in the engine couples the
  retrieval pipeline to specific task shapes. Every new workflow type requires
  new engine code.
- **Context contamination**: Larger K values pull in irrelevant chunks from
  wrong sources, degrading local model accuracy.
- **No composability**: Each workflow is a one-off implementation. Users can't
  define new workflows without modifying source code.

### What we need instead

A system where:

1. The planner detects the user's intent and selects an appropriate
   **workflow skill**.
2. The workflow skill provides **structured instructions** injected into the
   model's context — a playbook that guides tool-calling sequence without
   hard-coding logic in the engine.
3. The model follows the playbook, calling tools in the prescribed order.

This is exactly how Claude Code's skill system works (see §2).

---

## 2. Research: How the Industry Does It

### 2.1. Agent Skills Open Standard (agentskills.io)

The Agent Skills specification — created by Anthropic, now an open standard —
defines skills as folders of instructions, scripts, and resources that agents
discover and use on demand. It is adopted by Claude Code, OpenHands, VS Code,
GitHub, Factory, Goose, Letta, Databricks, TRAE, Qodo, and others.

**Core architecture: 3-tier progressive disclosure**

| Tier | Content loaded | When | Token cost |
|------|---------------|------|------------|
| **1. Catalog** | `name` + `description` from YAML frontmatter | Session start | ~50–100 tokens/skill |
| **2. Instructions** | Full `SKILL.md` markdown body | When skill is activated | <5000 tokens (recommended) |
| **3. Resources** | Scripts, references, assets | When instructions reference them | Varies |

The model sees the catalog from session start, so it knows what's available.
When it decides a skill is relevant, it loads the full instructions. Supporting
files load only when the instructions reference them.

**Key insight: skills are prompt-based, not code-based.** A skill's `SKILL.md`
body is injected into the model's context as instructions. The model does the
reasoning. The skill tells it *what sequence works* for this class of problem.

**Two types of skill content:**

| Type | Purpose | Example |
|------|---------|---------|
| **Reference** | Knowledge the model applies to current work (conventions, patterns, domain knowledge) | API design rules, coding standards |
| **Task** | Step-by-step instructions for a specific action | Deploy workflow, commit workflow, exhaustive summarization |

**Frontmatter configuration:**

```yaml
---
name: my-skill
description: What this skill does and when to use it
disable-model-invocation: true    # only user can trigger
allowed-tools: Read, Grep         # restrict available tools
context: fork                     # run in isolated subagent
agent: Explore                    # which subagent type
---
```

Key fields:
- `context: fork` — runs in an isolated subagent (no conversation history)
- `disable-model-invocation: true` — prevents automatic triggering
- `allowed-tools` — restricts which tools the skill can use
- `agent` — which subagent type executes it

**Activation patterns:**

| Pattern | How it works |
|---------|------------|
| Model-driven | Model reads catalog, decides skill is relevant, loads via file-read or activation tool |
| User-explicit | User types `/skill-name` (slash command) |

**Context management:**
- Skill content is protected from context compaction (never pruned)
- Deduplicated — loading the same skill twice is a no-op
- Structured tags (`<skill_content name="...">`) identify skill content for context management

### 2.2. Claude Code — Skills in Practice

Claude Code implements the Agent Skills standard with extensions:

**Bundled skills demonstrate the workflow pattern:**

| Skill | What it does |
|-------|-------------|
| `/batch <instruction>` | Researches codebase, decomposes work into 5–30 independent units, presents a plan. Once approved, **spawns one background agent per unit** in an isolated git worktree. Each agent implements its unit, runs tests, opens a PR. |
| `/simplify [focus]` | Reviews recently changed files. **Spawns three review agents in parallel**, aggregates findings, applies fixes. |
| `/loop [interval] <prompt>` | Runs a prompt repeatedly on an interval while the session stays open. |

These demonstrate that skills can orchestrate **parallel subagent execution**,
not just sequential tool calls.

**Skill directory structure:**

```
my-skill/
├── SKILL.md           # Main instructions (required)
├── template.md        # Template for Claude to fill in
├── examples/
│   └── sample.md      # Example output showing expected format
└── scripts/
    └── validate.sh    # Script Claude can execute
```

**Where skills live (precedence: enterprise > personal > project):**

| Scope | Location | Audience |
|-------|----------|----------|
| Enterprise | Managed settings | All users in organization |
| Personal | `~/.claude/skills/<name>/SKILL.md` | All your projects |
| Project | `.claude/skills/<name>/SKILL.md` | This project only |

**Dynamic context injection** — `!`command`` syntax runs shell commands before
the skill content reaches the model. Output replaces the placeholder.

**Argument substitution** — `$ARGUMENTS`, `$ARGUMENTS[N]`, `$N` substitutions
allow parameterized skills.

### 2.3. Agent Skills Best Practices (agentskills.io/skill-creation)

Key principles from the open standard's authoring guide:

**Start from real expertise.** Skills extracted from actual task execution
outperform skills generated from generic knowledge. Feed domain-specific
context (runbooks, incident reports, API specs) into skill creation.

**Refine with real execution.** Run the skill against real tasks, feed ALL
results back (not just failures). Even one pass of execute-then-revise improves
quality.

**Add what the agent lacks, omit what it knows.** Focus on project-specific
conventions, non-obvious edge cases, and specific tools/APIs.

**Checklists for multi-step workflows:**
```markdown
## Form processing workflow

Progress:
- [ ] Step 1: Analyze the form (run `scripts/analyze_form.py`)
- [ ] Step 2: Create field mapping (edit `fields.json`)
- [ ] Step 3: Validate mapping (run `scripts/validate_fields.py`)
- [ ] Step 4: Fill the form (run `scripts/fill_form.py`)
- [ ] Step 5: Verify output (run `scripts/verify_output.py`)
```

**Validation loops** — instruct the agent to validate its own work: do the
work → run validator → fix → repeat until validation passes.

**Plan-validate-execute** — for batch operations: create intermediate plan →
validate against source of truth → execute. The validation step enables
self-correction.

**Provide defaults, not menus.** Pick one approach, mention alternatives
briefly. "Use pdfplumber. For scanned PDFs, fall back to pdf2image with
pytesseract."

**Favor procedures over declarations.** Teach the approach to a class of
problems, not the specific answer.

**Progressive disclosure for large skills:** Keep `SKILL.md` under 500 lines
(~5000 tokens). Move detailed reference material to separate files in
`references/`. Reference them conditionally: "Read `references/api-errors.md`
if the API returns a non-200 status code."

### 2.4. OpenHands (formerly OpenClaw)

OpenHands follows the same Agent Skills standard. Parallx M11 was originally
inspired by it (referenced as "OpenClaw" in the M11 doc). OpenHands uses the
same folder-based `SKILL.md` pattern with YAML frontmatter + markdown body.

The key architectural contribution from OpenHands relevant to Parallx:
- **Zero RAG architecture** — fixed bootstrap injection + tool-driven knowledge.
  The model calls tools for all information retrieval.
- **Skill-as-capability** — each skill is a self-contained capability the agent
  can use, not just a tool declaration.

Parallx does not adopt the zero-RAG approach (RAG is valuable for local
models), but we do adopt the skill-as-capability concept — skills that define
**how to accomplish a task**, not just what a tool's parameters are.

### 2.5. Key Takeaway

The industry has converged on a single pattern:

```
Skills = prompt-based playbooks in a standard folder format
     ↓
Planner = matches user intent to skill description
     ↓
Activation = injects skill instructions into model context
     ↓
Execution = model follows the playbook using tools
     ↓
Subagent (optional) = isolated execution for complex workflows
```

**Skills are NOT code that runs — they are instructions injected into
context.** The model does the reasoning. The skill tells it *what sequence
works* for this class of problem.

---

## 3. Current Parallx State

### What we already have

| Capability | File(s) | Status |
|-----------|---------|--------|
| Skill manifest system | `skillLoaderService.ts` | Mature (M11). Scans `.parallx/skills/*/SKILL.md`, parses YAML, validates, converts to `IChatTool`. |
| 13 built-in skill manifests | `.parallx/skills/*/SKILL.md` | Shipped. `read_file`, `write_file`, `edit_file`, `list_files`, `search_files`, `search_knowledge`, `search_workspace`, `create_page`, `read_page`, `read_page_by_title`, `list_pages`, `get_page_properties`, `read_current_page`. |
| YAML frontmatter parser | `skillLoaderService.ts` L56–130 | Custom lightweight parser. Handles flat KV, lists, inline arrays. |
| Tool-from-manifest conversion | `skillLoaderService.ts` L200 | Converts manifest → `IChatTool` with JSON Schema parameters. |
| TOOLS.md auto-generation | `promptFileService.ts` L211 | System generates markdown doc from all registered skill manifests. |
| 3-tier permission model | `languageModelToolsService.ts` L166 | always-allowed / requires-approval / never-allowed. Enforced at invocation time. |
| Agentic tool loop | `chatGroundedExecutor.ts` | Bounded iteration (max 10). Send → stream → extract tool calls → invoke → feedback → loop. |
| Turn routing | `chatTurnRouter.ts` | Regex classifier → route kind (6 kinds) + workflow type (7 types). |
| Context planning | `chatContextPlanner.ts` | Maps route → context source flags (retrieval, memory, transcript, page). |
| Execution planning (M38) | `chatExecutionPlanner.ts` | Builds typed `IExecutionPlan` from route + scope for 7 workflow types. |
| Evidence gathering (M38) | `chatEvidenceGatherer.ts` | Pre-gathers structural/semantic/exhaustive evidence before LLM synthesis. |
| Delegated task infrastructure | `agentTypes.ts`, `agentTaskModels.ts`, `agentLifecycle.ts` | State machine for plan → approve → execute lifecycle. Sequential, no parallelism. |
| Slash command registry | `chatSlashCommands.ts` | Extensible `/summary`, `/review`, `/explain` commands with templates. |
| Workspace digest | `chatSystemPrompts.ts` L206 | Pre-computed ~2000-token digest of page titles, file tree, key files. Injected every turn. |

### What we do NOT have

| Capability | Gap |
|-----------|-----|
| **Workflow skills** | Skills are tool manifests only — no concept of a skill that guides a multi-step workflow. |
| **Skill catalog in system prompt** | Model does not see available skills at turn start. Only TOOLS.md (parameter docs) is generated. |
| **Planner → skill activation** | No mechanism for the planner to select and inject a skill based on intent. |
| **Skill body injection** | Skill markdown bodies are not injected into model context as instructions. Only the tool definition (name, params, description) is registered. |
| **Subagent execution** | No ability to fork an isolated context window for a skill. All tool calls run in the main conversation's agentic loop. |
| **`context: fork` equivalent** | No way to run a skill in isolation and return a summary. |
| **Parallel agent spawning** | No infrastructure for running multiple model calls concurrently (like Claude Code's `/batch` spawning 5–30 agents). |
| **Skill argument substitution** | No `$ARGUMENTS` or `$N` templating in skill bodies. |
| **Progressive disclosure** | All skill content is either fully loaded (TOOLS.md) or not loaded. No tier 1 catalog → tier 2 full body → tier 3 resources progression. |
| **User-invokable workflow skills** | No `/skill-name` slash command that activates a workflow skill. |
| **Skill content protection** | No mechanism to protect injected skill content from context compaction. |

### Bottom line

The M11 skill system is a **tool declaration layer**. It tells the agent what
tools exist and how to call them. It does NOT tell the agent how to approach
complex tasks. M39 evolves skills from tool declarations into workflow
playbooks.

---

## 4. Architectural Diagnosis

### The fundamental gap

M38's execution planner (`chatExecutionPlanner.ts`) produces typed
`IExecutionPlan` objects for 7 workflow types. The evidence gatherer
(`chatEvidenceGatherer.ts`) pre-gathers evidence per the plan. But the plan
steps are **engine-executed** — the code directly calls `list_files`,
`read_file`, and retrieval APIs.

This works for pre-defined workflows the engine knows about, but:

1. **Not extensible** — every new workflow requires new planner code.
2. **Not user-customizable** — users can't define their own workflows.
3. **Not model-guided** — the engine gathers evidence blindly; the model
   doesn't participate in planning.
4. **No isolation** — large workflows compete for the main conversation's
   context window.

### The skill-based solution

Instead of hard-coding workflow logic in the engine:

1. **Define workflow skills** — `SKILL.md` files whose body contains
   multi-step instructions, not just tool parameter docs.
2. **Planner selects skills** — the planner matches user intent against skill
   descriptions and activates the relevant workflow skill.
3. **Model follows the playbook** — the skill's instructions are injected
   into context, guiding the model's tool-calling behavior.

### How this complements M38

M38 and M39 are not alternatives — they compose.

| Layer | M38 provides | M39 adds |
|-------|-------------|---------|
| Scope resolution | `resolveQueryScope()` → `IQueryScope` | Skills receive the resolved scope as context |
| Workflow detection | Router classifies workflow type | Planner maps workflow type → skill |
| Evidence gathering | Engine pre-gathers typed evidence | Skill instructions guide what evidence to gather |
| Execution | Engine-driven step execution | Model-driven execution guided by skill playbook |
| Coverage | `ICoverageRecord` tracking | Skills define their own coverage criteria |

M38's scope resolution and typed evidence feed INTO M39's skill activation.
The skill receives a resolved scope and uses it to guide tool calls.

---

## 5. Milestone 39 Product Contract

After Milestone 39, the system should satisfy:

1. **Workflow skills exist** — `.parallx/skills/<name>/SKILL.md` files can
   contain multi-step workflow instructions, not just tool parameter docs.
2. **Skill catalog is visible** — the model sees a lightweight catalog
   (name + description) of available workflow skills at the start of every
   grounded turn.
3. **Planner activates skills** — when user intent matches a workflow skill's
   description, the planner injects the skill's full body into the model's
   context before the agentic loop begins.
4. **Built-in workflow skills ship** — at minimum: exhaustive-summary,
   folder-overview, document-comparison, scoped-extraction.
5. **User can invoke skills directly** — `/skill-name` syntax in the chat
   input activates a workflow skill explicitly.
6. **Skill argument substitution works** — `$ARGUMENTS` in skill bodies is
   replaced with user-provided text.
7. **Skill content is protected** — injected skill instructions survive
   context compaction.
8. **No regression** — ordinary grounded Q&A, conversational turns, and
   existing tool-based skills continue to work unchanged.
9. **Skills are user-extensible** — users can create `.parallx/skills/<name>/SKILL.md`
    workflow skills that the system discovers and activates.

### Where skill files live

> **M39 scope: workspace-only.**
>
> All skills live inside the workspace at `.parallx/skills/<name>/SKILL.md`.
> They travel with the workspace — when you copy, zip, or share a workspace,
> its skills come along. There are no global or user-level skills in M39.
>
> Future milestones may add a user-level `~/.parallx/skills/` directory for
> skills that apply to all workspaces.

### Creating your first workflow skill

Users don't need to understand the internals. Three steps:

1. **Create the folder.**
   ```
   .parallx/skills/my-workflow/
   ```

2. **Create `SKILL.md`** in that folder with YAML frontmatter and markdown
   instructions:
   ```yaml
   ---
   name: my-workflow
   description: >
     One sentence explaining when this skill should activate.
     Be specific — the system matches user messages against this.
   kind: workflow
   tags: [workflow, my-topic]
   ---

   # My Workflow

   When the user asks to [do X]:

   1. **Step one**: Call `list_files` to enumerate the scope
   2. **Step two**: For each file, call `read_file` and extract [Y]
   3. **Step three**: Combine results into a structured answer
   4. **Verify**: Confirm no items were skipped
   ```

3. **Done.** Parallx discovers the skill automatically on the next chat turn.
   Users can also type `/my-workflow` in chat to activate it explicitly.

**Tips for writing good skill instructions:**
- Write procedures, not declarations — tell the model *how* to do it step by
  step.
- Include a verification step so the model checks its own work.
- Keep `SKILL.md` under 500 lines (~5000 tokens).
- Use tool names the model already knows (`list_files`, `read_file`,
  `search_knowledge`, etc.).

---

## 6. Target Architecture

### 6.1. Skill type taxonomy

Current M11 skills are all **tool skills** — they declare a tool's interface.
M39 adds **workflow skills** — they declare how to orchestrate tools for a
task class.

| Skill type | `SKILL.md` content | How activated | Execution model |
|-----------|-------------------|--------------|----------------|
| **Tool skill** (M11) | Parameter schema + usage docs | Model calls the tool by name | Single tool invocation via `invokeTool()` |
| **Workflow skill** (M39) | Multi-step instructions + checklists | Planner detects intent → injects body | Model follows instructions in agentic loop |

Differentiated by frontmatter:

```yaml
# Tool skill (M11 — existing)
---
name: read_file
description: Read the contents of a file within the workspace.
version: 1.0.0
permission: always-allowed
parameters:
  - name: path
    type: string
    required: true
tags: [filesystem, read]
---
```

```yaml
# Workflow skill (M39 — new)
---
name: exhaustive-summary
description: >
  Summarize every file in the workspace or a specified folder.
  Use when the user asks to summarize all files, each file,
  or every document in the workspace.
version: 1.0.0
author: parallx
kind: workflow
context: inline
tags: [workflow, summary, exhaustive]
---

# Exhaustive File Summary

When the user asks to summarize all/each/every file:

1. **Enumerate**: Call `list_files` to get the complete file list
   - If a folder was specified, pass the folder path
   - Record the total file count — this is your coverage target
2. **Iterate**: For each file in the list:
   - Call `read_file` with the file path
   - Produce a 2–3 sentence summary of that file's content
   - Note the key topics covered
3. **Combine**: Present all summaries in a structured format:
   - File name as heading
   - Summary underneath
   - Key topics as bullet points
4. **Verify coverage**: Count your summaries against the file list
   - If any file was skipped, note it explicitly
   - Never silently omit files

Do NOT attempt a single search query for all files.
Process files one at a time to guarantee coverage.
```

### 6.2. Skill activation flow

```
User message: "Summarize each file in the RF Guides folder"
                │
                ▼
┌─ determineChatTurnRoute() ─────────────────────────────┐
│  kind: 'grounded'                                       │
│  coverageMode: 'exhaustive'                             │
│  workflowType: 'folder-summary'                         │
└─────────────────────────────────────────────────────────┘
                │
                ▼
┌─ resolveQueryScope() (M38) ────────────────────────────┐
│  level: 'folder'                                        │
│  pathPrefixes: ['RF Guides/']                           │
│  resolvedEntities: [{ naturalName: 'RF Guides',         │
│    resolvedPath: 'RF Guides/', kind: 'folder' }]        │
└─────────────────────────────────────────────────────────┘
                │
                ▼
┌─ matchWorkflowSkill() ★ NEW ───────────────────────────┐
│  Scans skill catalog for matching description           │
│  Match: 'exhaustive-summary' skill                      │
│  Loads full SKILL.md body                               │
│  Resolves $ARGUMENTS → "RF Guides folder"               │
└─────────────────────────────────────────────────────────┘
                │
                ▼
┌─ Inject into model context ────────────────────────────┐
│  System prompt: [normal system prompt]                   │
│  + <skill_instructions name="exhaustive-summary">       │
│      [full SKILL.md body with substitutions]            │
│    </skill_instructions>                                │
│  + [scope context: "Target folder: RF Guides/"]         │
└─────────────────────────────────────────────────────────┘
                │
                ▼
┌─ executeChatGrounded() — agentic loop ─────────────────┐
│  Model reads skill instructions + scope                 │
│  Iteration 1: calls list_files("RF Guides/")            │
│  Iteration 2: calls read_file("RF Guides/file1.pdf")    │
│  Iteration 3: calls read_file("RF Guides/file2.pdf")    │
│  ...                                                    │
│  Final: produces structured summary with coverage check │
└─────────────────────────────────────────────────────────┘
```

### 6.3. Pipeline upgrade — target shape

```
handleChatTurn()
 ├─ 1. determineChatTurnRoute()       — classify intent + workflow type
 ├─ 2. resolveQueryScope()            — M38: entity + scope resolution
 ├─ 3. matchWorkflowSkill()           — ★ NEW: match intent to skill catalog
 ├─ 4. if skill matched:
 │     └─ inject skill body into system prompt section
 ├─ 5. buildExecutionPlan()           — M38: typed plan (for non-skill paths)
 ├─ 6. gatherEvidence()              — M38: pre-gather (for non-skill paths)
 ├─ 7. prepareChatTurnContext()       — existing context preparation
 ├─ 8. composeChatUserContent()       — existing, with skill-aware sections
 ├─ 9. buildSystemPrompt()            — existing, with skill injection slot
 ├─10. executePreparedChatTurn()      — existing model synthesis / agentic loop
 └─11. validateAnswer()               — M38: coverage + scope validation
```

> **Deferred to M40 — Subagent executor.** Skills with `context: fork` that
> execute in an isolated context window (separate message history, restricted
> tool set, independent token budget) are deferred. M39 delivers inline
> workflow skills only. All built-in skills use `context: inline`.

**Key principle:** Skill-matched paths and engine-planned paths coexist. If
no workflow skill matches, the M38 execution planner handles it. Skills are
the user-extensible layer; the engine planner is the fallback.

---

## 7. Canonical Internal Objects

### A. Workflow skill manifest (extends M11 ISkillManifest)

```ts
// Location: skillLoaderService.ts (extend existing ISkillManifest)

interface ISkillManifest {
  // Existing M11 fields
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  readonly author?: string;
  readonly permission: ToolPermissionLevel;
  readonly parameters: ISkillParameter[];
  readonly tags: string[];
  readonly body: string;
  readonly relativePath: string;

  // New M39 fields
  readonly kind: 'tool' | 'workflow';           // default: 'tool'
  readonly disableModelInvocation?: boolean;     // only user can trigger
  readonly userInvocable?: boolean;              // appears in / menu (default: true)
}
```

> **Deferred to M40:** `context: 'inline' | 'fork'` and `allowedTools`
> fields will be added when subagent execution lands.
```

### B. Skill catalog entry (tier 1 — lightweight)

```ts
// Location: chatTypes.ts (new)

interface ISkillCatalogEntry {
  readonly name: string;
  readonly description: string;
  readonly kind: 'tool' | 'workflow';
  readonly tags: string[];
}
```

### C. Activated skill (tier 2 — full body)

```ts
// Location: chatTypes.ts (new)

interface IActivatedSkill {
  readonly manifest: ISkillManifest;
  readonly resolvedBody: string;        // body with $ARGUMENTS substituted
  readonly activatedBy: 'planner' | 'user';
  readonly scope?: IQueryScope;         // from M38
}
```

### D. Skill match result

```ts
// Location: chatTypes.ts (new)

interface ISkillMatchResult {
  readonly matched: boolean;
  readonly skill?: ISkillCatalogEntry;
  readonly reason: string;              // why it matched (or didn't)
}
```

> **Deferred to M40:** `ISubagentRequest` and `ISubagentResult` types for
> forked skill execution. See §6.3 note.

---

## 8. Stress-Test Workspace

The demo workspace (6 clean markdown files, auto insurance domain) is too
well-structured to validate real-world skill behavior. M39 needs a **messy,
realistic test workspace** that exercises edge cases the skill system must
handle.

### 8.1. Design principles

1. **Mixed formatting** — some files have headers, some don't. Inconsistent
   bullet styles, tables vs prose, numbered vs unnumbered lists.
2. **Overlapping content** — multiple files cover similar topics with
   different details, forcing the model to reconcile or distinguish.
3. **Contradictory information** — deliberate conflicts between files to test
   whether skills surface contradictions rather than silently picking one.
4. **Nested folders** — 3 levels deep, some nearly empty, some dense.
5. **Varying file sizes** — from 2-line stubs to 500+ line reference docs.
6. **Near-empty files** — files with only a title or a single sentence.
7. **Irrelevant files** — noise files the model should skip or deprioritize.
8. **Duplicate file names** — same filename in different folders.
9. **Real-world naming** — spaces, abbreviations, version suffixes
   (`policy-v2-FINAL.md`, `Notes (old).md`).

### 8.2. Workspace layout

```
tests/ai-eval/stress-workspace/
├── README.md                          # 3 lines — just a title, no real overview
├── policies/
│   ├── auto-policy-2024.md            # Full policy doc, clean tables
│   ├── auto-policy-2023.md            # Older version — different deductibles ($750)
│   ├── homeowners-draft.md            # Incomplete draft — missing sections, TODOs
│   └── umbrella/
│       ├── overview.md                # 2 sentences — stub file
│       └── umbrella-coverage.md       # Detailed umbrella policy
├── claims/
│   ├── how-to-file.md                 # Step-by-step, clean formatting
│   ├── how-to-file.md                 # (DUPLICATE NAME in different path — see notes/)
│   ├── settlement-calculations.md     # Dense math — formulas, edge cases
│   └── archived/
│       ├── claim-2019-johnson.md      # Old case file — narrative style, no headers
│       └── claim-2020-martinez.md     # Old case file — partially redacted paragraphs
├── contacts/
│   ├── agent-directory.md             # 8 agents, table format
│   └── vendors-and-shops.md           # Repair shops — inconsistent formatting (some
│                                      #   table rows, some bullet lists, some just text)
├── notes/
│   ├── how-to-file.md                 # Different content than claims/how-to-file.md —
│   │                                  #   informal personal notes, contradicts official steps
│   ├── meeting-2024-03.md             # Meeting minutes — rambling, no structure
│   ├── random-thoughts.md             # Completely irrelevant — weekend plans, recipes
│   └── policy-comparison.md           # Compares 2023 vs 2024 policy — has errors
├── reference/
│   ├── state-regulations.md           # Long doc (400+ lines) — dense legal text
│   ├── glossary.md                    # Terms and definitions — some overlap with policy
│   └── FAQ.md                         # 30 Q&A pairs — some contradict the policy docs
└── .parallx/
    └── workspace-identity.json        # Pre-seeded identity for test reproducibility
```

**20+ files, 3 folders deep, 3 duplicate filenames across paths, 2
deliberately contradictory file pairs, 2 near-empty stubs, 1 irrelevant
noise file, 1 incomplete draft.**

### 8.3. Built-in contradictions (ground truth for tests)

| Contradiction | File A | File B | Detail |
|--------------|--------|--------|--------|
| Collision deductible | `auto-policy-2024.md` ($500) | `auto-policy-2023.md` ($750) | Version conflict — both are "the policy" |
| Filing steps | `claims/how-to-file.md` (official: 5 steps) | `notes/how-to-file.md` (informal: 3 steps, wrong order) | Same filename, different content |
| Coverage limit | `FAQ.md` (states $100K liability) | `auto-policy-2024.md` ($250K liability) | FAQ is outdated/wrong |

### 8.4. What this workspace tests that demo-workspace doesn't

| Challenge | Demo workspace | Stress workspace |
|-----------|---------------|-----------------|
| Files with same name in different folders | No | Yes (3 instances) |
| Contradictory information across files | No | Yes (3 pairs) |
| Near-empty / stub files mixed with real content | No | Yes (2 stubs) |
| Irrelevant noise files | No | Yes (random-thoughts.md) |
| Files > 300 lines | No | Yes (state-regulations.md) |
| 3+ levels of folder nesting | No | Yes (policies/umbrella/) |
| Inconsistent formatting within a single file | No | Yes (vendors-and-shops.md) |
| Incomplete drafts with TODOs | No | Yes (homeowners-draft.md) |
| 20+ files requiring exhaustive enumeration | No | Yes (20+ files) |

---

## 9. Execution Plan

### Phase A — Stress-Test Workspace & Manifest Extension

**Goal:** Build the stress-test workspace (§8) and extend the skill loader
to parse workflow skills.

**Files affected:**
- `tests/ai-eval/stress-workspace/**` — ★ NEW (all workspace files)
- `tests/ai-eval/stressGroundTruth.ts` — ★ NEW (contradiction pairs, file counts)
- `src/services/skillLoaderService.ts` — extend parser + validator
- `tests/unit/skillLoaderService.test.ts` — test new fields

**Tasks:**

A.1. **Build the stress-test workspace** per §8.2 layout. Create all 20+
     files with realistic content, deliberate contradictions (§8.3),
     near-empty stubs, noise files, and inconsistent formatting. Pre-seed
     `.parallx/workspace-identity.json`.

A.2. **Create `stressGroundTruth.ts`** with:
     - Complete file inventory (path, line count, content summary)
     - Contradiction pairs with expected values from each side
     - Expected file counts per folder and total
     - Duplicate filename mapping → which folder has which version

A.3. Extend `ISkillManifest` with `kind`, `disableModelInvocation`, and
     `userInvocable` fields. Defaults: `kind: 'tool'`,
     `userInvocable: true`.

A.4. Update the YAML frontmatter parser to extract the new fields.

A.5. Update `validateSkillManifest()` to validate new fields (kind must be
     'tool' | 'workflow').

A.6. Add unit tests for parsing workflow skill manifests with all new fields,
     verifying defaults, and rejecting invalid values.

### Phase B — Skill Catalog & Progressive Disclosure

**Goal:** The model sees a lightweight catalog of workflow skills at the start
of every grounded turn, without loading full skill bodies.

**Files affected:**
- `src/services/skillLoaderService.ts` — add `getSkillCatalog()` method
- `src/built-in/chat/config/chatSystemPrompts.ts` — inject catalog
- `src/built-in/chat/utilities/chatTypes.ts` — add `ISkillCatalogEntry`

**Tasks:**

B.1. Define `ISkillCatalogEntry` in `chatTypes.ts`.

B.2. Add `getWorkflowSkillCatalog(): ISkillCatalogEntry[]` to
     `SkillLoaderService` — returns only workflow skills (kind === 'workflow')
     with `disableModelInvocation !== true`.

B.3. In `buildSystemPrompt()`, add a `<available_skills>` section when
     workflow skills exist. Format: XML catalog with name + description per
     skill. Budget: cap at ~2000 tokens (approximately 20–40 skill entries).

B.4. Add behavioral instruction text alongside the catalog:
     ```
     The following workflow skills provide specialized step-by-step
     instructions for complex tasks. When a task matches a skill's
     description, the skill will be activated automatically. You can
     also use your standard tools for tasks that don't match any skill.
     ```

B.5. Add unit tests for catalog generation, token budget enforcement, and
     system prompt injection.

B.6. **Playwright smoke test (stress workspace):** Open the stress workspace,
     send a trivial grounded question ("What is the collision deductible in
     the 2024 policy?"). Assert: answer is grounded, no regression from
     catalog injection, response arrives within normal timeout. This verifies
     the catalog section doesn't break ordinary Q&A in a messy workspace.

### Phase C — Skill Matching & Activation

**Goal:** The planner can match user intent to a workflow skill and inject the
skill's full body into the model's context.

**Files affected:**
- `src/built-in/chat/utilities/chatSkillMatcher.ts` — ★ NEW
- `src/built-in/chat/participants/defaultParticipant.ts` — wire in
- `src/built-in/chat/config/chatSystemPrompts.ts` — skill injection slot
- `src/built-in/chat/utilities/chatTypes.ts` — add types

**Tasks:**

C.1. Define `ISkillMatchResult` and `IActivatedSkill` in `chatTypes.ts`.

C.2. Create `chatSkillMatcher.ts` with function
     `matchWorkflowSkill(userText, route, scope, catalog)`:
     - Input: user text, turn route, query scope, skill catalog
     - Strategy: tag matching against route's `workflowType` + keyword
       overlap against skill descriptions. NOT an LLM call — deterministic
       and fast.
     - Match logic:
       - Route's `workflowType` maps to skill tags
         (e.g., `folder-summary` → skills tagged `[workflow, summary]`)
       - User text keywords checked against skill description words
       - First skill with matching tag + keyword overlap wins
       - If no match, return `{ matched: false }`
     - Output: `ISkillMatchResult`

C.3. Implement `activateSkill(match, userText, scope)`:
     - Loads full `SKILL.md` body from manifest
     - Applies `$ARGUMENTS` substitution (userText as arguments)
     - Returns `IActivatedSkill`

C.4. Wire skill matching into `defaultParticipant.ts` between scope
     resolution (step 2) and execution planning (step 6 in current pipeline).

C.5. When a skill is activated, inject the resolved body into the system
     prompt inside `<skill_instructions>` tags.

C.6. Mark skill content as protected from context compaction (add
     `isSkillContent: true` flag to the relevant message part).

C.7. Add unit tests for skill matching: exact matches, partial matches,
     no-match fallback, argument substitution.

C.8. **Playwright test (stress workspace) — skill activation for exhaustive
     prompt:** Send "Summarize every file in this workspace." Assert: the
     response mentions exhaustive-summary skill activation in trace/debug
     output (or produces a response that covers significantly more files
     than an unskilled baseline). This validates that the matcher fires on
     realistic phrasing against a 20+ file workspace.

C.9. **Playwright test (stress workspace) — no false activation:** Send a
     simple factual question ("Who is agent Sarah Chen?"). Assert: no
     workflow skill activates — response comes from normal grounded path.
     Verifies the matcher doesn't over-trigger on ordinary queries.

### Phase D — User-Invoked Skills (Slash Commands)

**Goal:** Users can type `/skill-name` in chat to explicitly activate a
workflow skill.

**Files affected:**
- `src/built-in/chat/utilities/chatSlashCommands.ts` — dynamic registration
- `src/built-in/chat/participants/defaultParticipant.ts` — slash skill handling

**Tasks:**

D.1. When `SkillLoaderService` discovers workflow skills with
     `userInvocable !== false`, register each as a slash command in
     `SlashCommandRegistry` with the skill's name and description.

D.2. When a slash command matches a skill name, bypass the skill matcher
     and directly activate the skill with `activatedBy: 'user'`.

D.3. Pass text after the slash command name as `$ARGUMENTS`.

D.4. Add unit tests for slash command registration, activation, and
     argument passing.

D.5. **Playwright test (stress workspace) — slash command activation:** Type
     `/exhaustive-summary` in chat. Assert: skill activates (response
     begins enumerating files). Verifies the slash command wiring works
     end-to-end with a real model and messy workspace.

D.6. **Playwright test (stress workspace) — slash command with arguments:**
     Type `/folder-overview policies/umbrella`. Assert: response focuses on
     the umbrella subfolder (2 files), not the whole workspace. Verifies
     `$ARGUMENTS` substitution works with nested folder paths.

### Phase E — Built-in Workflow Skills

**Goal:** Ship 4 built-in workflow skills that cover the most common composite
task patterns. All use `context: inline` (inline injection).

**Files affected:**
- `.parallx/skills/exhaustive-summary/SKILL.md` — ★ NEW
- `.parallx/skills/folder-overview/SKILL.md` — ★ NEW
- `.parallx/skills/document-comparison/SKILL.md` — ★ NEW
- `.parallx/skills/scoped-extraction/SKILL.md` — ★ NEW

**Tasks:**

E.1. **`exhaustive-summary`** — summarize every file in a folder or the
     entire workspace. Step-by-step: enumerate → iterate (read + summarize)
     → combine → verify coverage. Tags: `[workflow, summary, exhaustive]`.

E.2. **`folder-overview`** — provide an overview of a folder's contents,
     including file count, file types, and brief descriptions. Step-by-step:
     enumerate → classify → describe → format. Tags:
     `[workflow, overview, structural]`.

E.3. **`document-comparison`** — compare two or more documents in detail.
     Step-by-step: identify targets → read each → analyze dimensions →
     synthesize comparison. Tags: `[workflow, comparison, analysis]`.

E.4. **`scoped-extraction`** — extract specific information from all files
     in a scope. Step-by-step: enumerate scope → read each file → extract
     target facts → aggregate → validate completeness. Tags:
     `[workflow, extraction, exhaustive]`.

E.5. Validate each skill with manual testing: run the prompt against the
     stress workspace. Iterate on instructions based on actual model behavior.

E.6. **Playwright test — exhaustive-summary (stress workspace):** Send
     "Summarize each file in this workspace." Assert: response contains a
     summary for **every file** in the workspace (20+ files). Count
     mentioned filenames against `stressGroundTruth.ts` inventory. Fail if
     any file is silently omitted. This is the primary M39 success test.

E.7. **Playwright test — exhaustive-summary on nested subfolder:** Send
     "Summarize each file in the policies folder." Assert: response covers
     all 5 files in `policies/` (including `policies/umbrella/`), not the
     whole workspace. Verifies folder-scoped exhaustive iteration.

E.8. **Playwright test — folder-overview (stress workspace):** Send "Give me
     an overview of the notes folder." Assert: lists all 4 files in
     `notes/`, reports correct count, mentions the noise file
     (`random-thoughts.md`) without treating it as important content.

E.9. **Playwright test — document-comparison with contradictions:** Send
     "Compare auto-policy-2024.md and auto-policy-2023.md." Assert: response
     identifies the collision deductible difference ($500 vs $750). This
     tests handling of deliberately contradictory files.

E.10. **Playwright test — document-comparison with same-name files:** Send
      "Compare the two how-to-file documents." Assert: response correctly
      identifies there are two files with the same name in different folders,
      reads both, and highlights differences (official 5-step vs informal
      3-step). Tests duplicate filename resolution.

E.11. **Playwright test — scoped-extraction (stress workspace):** Send
      "Extract all deductible amounts from every policy document." Assert:
      response finds $500 (2024 collision), $250 (comprehensive), $750
      (2023 collision) from the correct files. Verifies extraction across
      multiple files with overlapping content.

E.12. **Playwright test — handles near-empty files gracefully:** Send
      "Summarize umbrella/overview.md." Assert: response acknowledges the
      file has minimal content (2 sentences) rather than hallucinating
      details. Tests stub file handling.

E.13. **Playwright test — handles irrelevant files:** Send "Summarize the
      notes folder." Assert: response includes `random-thoughts.md` but
      notes it's not insurance-related (weekend plans). Verifies the model
      doesn't skip files or hallucinate relevance.

### Phase F — Integration, Regression & Final Eval

**Goal:** Full regression, cross-workspace validation, and final scoring.

**Tasks:**

F.1. **Regression: existing 37/37 eval tests (demo workspace)** — run the
     full demo + books eval suites with skill system active. All must remain
     at 100%. Catalog injection must not degrade ordinary Q&A.

F.2. **Regression: M38 rubric tests (demo workspace)** — run the 7 M38
     workflow tests. All must pass. Skills must not interfere with the
     engine-planned path when no skill matches.

F.3. **Stress workspace Playwright rubric** — formalize all Phase E
     Playwright tests (E.6–E.13) into a `stress-quality.spec.ts` with a
     `stressRubric.ts` rubric file, scored like the existing eval suites.
     Define per-test ground truth, keyword assertions, and coverage checks
     against `stressGroundTruth.ts`.

F.4. **Cross-workspace portability** — run the exhaustive-summary skill
     against the Books workspace (10 real PDFs, env var override). Assert:
     all 10 files mentioned. This validates skill behavior generalizes
     beyond the workspace it was tuned against.

F.5. **Performance validation** — measure prompt token count with vs without
     skill catalog. Assert: catalog adds < 500 tokens with 4 built-in
     workflow skills.

F.6. **Stress test: ambiguous phrasing** — send prompts with vague wording
     ("Tell me about everything in here", "What's in my files?", "Go
     through all my stuff"). Assert: skill activates on at least 2 of 3
     phrasings. Tests real-world user language, not test-optimized prompts.

F.7. **Stress test: multi-turn with skill** — send "Summarize each file in
     policies/", then follow up "Now do the same for claims/". Assert: both
     turns activate the skill and produce complete coverage for their
     respective folders. Tests skill re-activation across turns.

---

## 10. Exact File Map

### New files

| File | Purpose | Phase |
|------|---------|-------|
| `tests/ai-eval/stress-workspace/**` | Stress-test workspace (20+ messy files, §8) | A |
| `tests/ai-eval/stressGroundTruth.ts` | Ground truth: file inventory, contradictions, counts | A |
| `tests/ai-eval/stressRubric.ts` | Rubric for stress workspace Playwright tests | F |
| `tests/ai-eval/stress-quality.spec.ts` | Stress workspace Playwright eval spec | F |
| `src/built-in/chat/utilities/chatSkillMatcher.ts` | Intent → skill matching + activation | C |
| `.parallx/skills/exhaustive-summary/SKILL.md` | Built-in: summarize all files | E |
| `.parallx/skills/folder-overview/SKILL.md` | Built-in: folder structure overview | E |
| `.parallx/skills/document-comparison/SKILL.md` | Built-in: compare documents | E |
| `.parallx/skills/scoped-extraction/SKILL.md` | Built-in: extract facts across scope | E |
| `tests/unit/chatSkillMatcher.test.ts` | Skill matcher unit tests | C |

### Modified files

| File | Change | Phase |
|------|--------|-------|
| `src/services/skillLoaderService.ts` | Extend manifest with `kind`; add `getWorkflowSkillCatalog()` | A, B |
| `src/built-in/chat/config/chatSystemPrompts.ts` | Add skill catalog section + skill injection slot | B, C |
| `src/built-in/chat/utilities/chatTypes.ts` | Add `ISkillCatalogEntry`, `IActivatedSkill`, `ISkillMatchResult` | B, C |
| `src/built-in/chat/participants/defaultParticipant.ts` | Wire skill matching + activation | C |
| `src/built-in/chat/utilities/chatSlashCommands.ts` | Dynamic skill slash command registration | D |
| `tests/unit/skillLoaderService.test.ts` | Test new manifest fields | A |

### Unchanged files (verified no modification needed)

| File | Reason |
|------|--------|
| `src/built-in/chat/utilities/chatTurnRouter.ts` | Route kinds already sufficient; workflow type classification already exists |
| `src/built-in/chat/utilities/chatContextPlanner.ts` | Planning logic unchanged; skill activation is a new parallel path |
| `src/built-in/chat/utilities/chatExecutionPlanner.ts` | M38 engine planner remains as fallback for non-skill paths |
| `src/built-in/chat/utilities/chatEvidenceGatherer.ts` | M38 evidence gathering remains for non-skill paths |
| `src/built-in/chat/utilities/chatGroundedExecutor.ts` | Agentic loop unchanged; skill instructions guide tool calls, not loop logic |
| `src/services/retrievalService.ts` | Retrieval unchanged; skills guide tool calls, not retrieval |

---

## 11. Success Criteria

### Functional

| # | Criterion | How to verify |
|---|----------|---------------|
| 1 | Exhaustive summary of 20+ file stress workspace covers every file | Playwright: `stress-quality.spec.ts` E.6 — count filenames against ground truth |
| 2 | Exhaustive summary of nested subfolder covers all nested files | Playwright: E.7 — policies/ folder (5 files including umbrella/) |
| 3 | Folder overview lists correct count and all files | Playwright: E.8 — notes/ folder (4 files) |
| 4 | Document comparison surfaces contradictions between files | Playwright: E.9 — 2024 vs 2023 policy ($500 vs $750) |
| 5 | Document comparison resolves same-name files in different folders | Playwright: E.10 — two how-to-file.md files |
| 6 | Scoped extraction finds values across multiple files | Playwright: E.11 — all deductible amounts |
| 7 | Near-empty files handled without hallucination | Playwright: E.12 — umbrella/overview.md (2 sentences) |
| 8 | Irrelevant files acknowledged, not skipped | Playwright: E.13 — random-thoughts.md in notes/ |
| 9 | `/exhaustive-summary` slash command activates the skill | Playwright: D.5 |
| 10 | `/folder-overview` with path argument works | Playwright: D.6 — umbrella subfolder |
| 11 | User-created workflow skill is discovered and usable | Drop custom SKILL.md → verify activation |
| 12 | Existing 37/37 demo + 8 books eval tests remain at 100% | Playwright: F.1 regression suite |
| 13 | Skills work on real PDFs (Books workspace, 10 files) | Playwright: F.4 cross-workspace portability |
| 14 | Ambiguous user phrasing triggers skill activation | Playwright: F.6 — 3 vague prompts, ≥2 activate |

### Non-functional

| # | Criterion | Target |
|---|----------|--------|
| 15 | Skill catalog injection adds < 500 tokens to system prompt | Measure with 4 built-in workflow skills |
| 16 | Skill matching latency < 10ms | Deterministic tag/keyword matching, no LLM call |
| 17 | tsc --noEmit clean | Zero type errors |
| 18 | All unit tests pass | `npx vitest run` |

---

## 12. Non-Goals

| # | Explicitly excluded | Rationale |
|---|-------------------|-----------|
| 1 | LLM-based skill matching | Must be deterministic and fast. Tag/keyword matching is sufficient for M39. |
| 2 | Subagent / forked execution (`context: fork`) | Deferred to M40. M39 delivers inline workflow skills only. |
| 3 | Parallel subagent spawning (like Claude Code `/batch`) | Requires concurrent model calls and subagent infrastructure. Future work. |
| 4 | Dynamic skill creation by the model | The model should not create new skills during a conversation. Users author skills. |
| 5 | Skill marketplace / sharing | Distribution infrastructure is out of scope. Skills are local files. |
| 6 | Shell script execution from skills | No `scripts/` directory support in M39. Skills are prompt-based only — no code execution beyond existing tools. |
| 7 | User-level or global skills (`~/.parallx/skills/`) | Only workspace-level (`.parallx/skills/`) skills in M39. See §5 "Where skill files live". |
| 8 | Skill chaining (one skill activates another) | Single skill activation per turn. Composition is future work. |
| 9 | `!`command`` dynamic context injection | No shell command execution in skill bodies. Static content only. |
