# Milestone 81 — Memory the Agent Owns

> **Status:** Phases 1–9 shipped 2026-05-26. Phase 10 (tool categories +
> AI-visible structure) in progress 2026-05-26. Phase 9 was a small
> canvas-tool consolidation pass added after Phase 8 in response to the
> same "feels clunky" report that drove M81 — the canvas tool set had
> two redundancies (get_page vs read_page, compose_page vs create_page)
> that small models routinely fumbled.
>
> Supersedes the half-wired preference auto-extraction path introduced in
> M10 Phase 5. Builds directly on the file-based canonical memory substrate
> (M32) and the skill catalog infrastructure (M11 + M65b parity).
>
> **Shipped scope (7 phases):**
> 1. ✅ USER.md as a bootstrap layer. Scaffolded via `/init` (single activation path, matches SOUL.md / TOOLS.md). In-memory fallback in `OPENCLAW_BOOTSTRAP_DEFAULTS` so the prompt always has it.
> 2. ✅ `memory_edit` tool with add/replace/remove on USER.md / MEMORY.md / daily. Bounded files (USER 1,500 / MEMORY 2,500 chars) with error-on-full → consolidate-then-add discipline.
> 3. ✅ Concept auto-extraction **removed entirely** (Stage 2 cleanup — three-layer verification revealed the original "wire it up" premise was wrong; the extraction was already wired but competed with bounded curation).
> 4. ✅ Preference auto-extraction **removed entirely** (the same regex-vs-agent-curation conflict; subagent caught that `detectPreferences` was live, not dead as the milestone draft assumed, and we deleted the full chain including the `queueMemoryWriteBack` caller).
> 5. ✅ `buildMemorySection` rewritten as one coherent surface: identity files (always loaded), curated memory store (read/write tools), explicit write triggers.
> 6. ✅ agentskills.io subfolder alignment — skill catalog now surfaces `scripts/` / `references/` / `assets/` files alongside `SKILL.md`. Skills authored to the open standard load with their bundled files visible to the agent.
> 7. ✅ Docs (`ARCHITECTURE.md`, `docs/ai/AI_USER_GUIDE.md`) updated to reflect the new memory surface.

## Why

Parallx today has the **substrate** of a Hermes-class memory system but
the substrate is fragmented across services, half-wired, and invisible
to the AI as a single surface. The user experience is that the AI
"doesn't really learn" — and the audit confirms the felt clunkiness
maps to real architectural fragmentation, not a missing feature.

What exists today (verified):

- **File-based canonical memory** at `.parallx/memory/MEMORY.md` (durable)
  and `.parallx/memory/YYYY-MM-DD.md` (daily). Scaffolded by
  [WorkspaceMemoryService.ensureScaffold](../src/services/workspaceMemoryService.ts).
- **Section-aware writers** for MEMORY.md: `syncPreferences`, `syncConcepts`,
  `upsertPreferences`, `upsertConcepts`, `appendSessionSummary`,
  `appendDailyMemory` ([workspaceMemoryService.ts L267-L423](../src/services/workspaceMemoryService.ts#L267-L423)).
- **Read tools for the AI**: `memory_get` and `memory_search`
  ([memoryTools.ts](../src/built-in/chat/tools/memoryTools.ts)).
- **SQLite memory** with vector retrieval: conversation summaries, learning
  concepts, decay scoring, eviction ([memoryService.ts](../src/services/memoryService.ts)).
- **Bootstrap prompt layer**: SOUL.md, AGENTS.md, TOOLS.md, rules/, loaded
  into every system prompt ([promptFileService.ts L247-L255](../src/services/promptFileService.ts#L247-L255)).
- **Memory section in system prompt** at
  [openclawSystemPrompt.ts L463-L477](../src/openclaw/openclawSystemPrompt.ts#L463-L477)
  tells the AI memory exists — but only lists read tools.
- **Skill catalog** discovered from `.parallx/skills/*/SKILL.md`, surfaced
  in every system prompt via `buildSkillsSection` ([skillLoaderService.ts](../src/services/skillLoaderService.ts)
  + [openclawSystemPrompt.ts L271-L306](../src/openclaw/openclawSystemPrompt.ts#L271-L306)).

What is broken or missing (verified):

- **No agent-callable write tool.** `memoryTools.ts` exposes only read.
  `WorkspaceMemoryService` write methods exist but are not surfaced as
  chat tools.
- **Preference auto-extraction is dead code.** `MemoryService.extractAndStorePreferences`
  ([memoryService.ts L716](../src/services/memoryService.ts#L716)) has
  zero callers in production — only test files reference it. The
  function is fully implemented (regex patterns + SQLite writes) but
  the wiring was never finished. Concepts pipeline IS wired (via
  [openclawContextEngine.ts L400-L525](../src/openclaw/openclawContextEngine.ts#L400-L525)).
- **Concept extraction only writes to SQLite, not to MEMORY.md.** The
  context engine calls `storeConceptsFromSession` → `memoryService.storeConcepts`
  → SQLite + vector store. `WorkspaceMemoryService.syncConcepts` exists
  to write the `## Concepts` section in MEMORY.md but is never called
  from the chat path. Result: the AI can semantically retrieve concepts
  via `recallConcepts`, but `memory_get` on MEMORY.md never shows them.
- **No USER.md.** SOUL.md is the agent's identity. AGENTS.md is the
  project's context. There is no equivalent file for the user as a
  person — preferences, role, focus, constraints. Hermes ships this as
  `~/.hermes/memories/USER.md`, 1,375 char bound. Parallx does not.
- **No bounded curation.** `MEMORY.md` and the daily files are unbounded.
  Hermes treats this as a load-bearing design choice: bounded files
  force the agent to `replace`/`remove` instead of accumulating. Without
  bounds, an agent-writable memory just sprawls.
- **Two retrieval paths, overlapping but not identical results.** File-
  based (`memory_search` via indexed `.md` files) and SQLite-based
  (`memoryService.recallMemories` / `recallConcepts`). The AI doesn't
  know they are the same conceptual thing.
- **Skill catalog only loads `SKILL.md`.** [skillLoaderService.ts L414-L451](../src/services/skillLoaderService.ts#L414-L451)
  reads the manifest file only — it does not enumerate or surface
  `scripts/`, `references/`, `assets/` subfolders that the agentskills.io
  open standard defines. Result: skills authored to the standard can
  load their metadata but the AI cannot reach their bundled resources.

## Cohesion as the design constraint

This milestone is explicit about cohesion because the user has named
fragmentation as Parallx's central UX problem. Three concrete rules
shape every phase:

1. **One substrate, multiple writers.** All memory writes — agent-
   initiated and auto-extracted — go through `WorkspaceMemoryService`.
   No parallel SQL-only path that the file viewer can't see. The
   context-engine concept pipeline gets re-routed through `upsertConcepts`
   so SQLite and MEMORY.md stay in lockstep.

2. **One mental model for the AI.** The system prompt presents memory
   as one surface with consistent verbs: read, search, edit. Not
   "memory tools vs prompt files vs SQLite recall." `buildMemorySection`
   is rewritten to name everything the agent can do, in one paragraph,
   with no surprise tools surfaced elsewhere.

3. **One file convention.** USER.md joins SOUL.md / AGENTS.md / TOOLS.md
   as a bootstrap layer at `.parallx/USER.md` — not under `.parallx/memory/`.
   Identity files are workspace-root; memory files are
   `.parallx/memory/`. The split mirrors the existing SOUL/AGENTS shape
   so the user doesn't have to learn a new convention.

If a phase below would add a feature that doesn't satisfy all three
rules, the phase is incorrect and must be redesigned. The point of the
milestone is to reduce surface count, not grow it.

## UX contract

> **The agent has identity files it always sees and a small bounded
> memory it writes and curates itself. The user edits SOUL/AGENTS/USER
> when they want; the agent edits MEMORY/daily when it learns. There
> is one tool family for memory and one prompt section that describes
> the whole surface. The auto-extraction the system already does for
> concepts shows up in the same files the agent writes to, so reading
> MEMORY.md tells the user exactly what the AI knows.**

- No new console, no new panel, no new event bus.
- USER.md ships scaffolded with a starter template, like SOUL.md.
- `memory_edit` is a single tool with `action ∈ {add, replace, remove}`
  and `file ∈ {USER, MEMORY, daily}`. Mirrors the Hermes `memory` tool
  shape because that shape is the load-bearing pattern: full-file →
  error → agent consolidates.
- Bounded: USER.md ≤ 1,500 chars, MEMORY.md ≤ 2,500 chars. Daily files
  unbounded (they are a log, not a curated surface). When a bounded
  write would exceed cap, the tool returns the current contents and an
  error so the AI must consolidate before retrying.
- All file paths the AI writes are also paths the user can open in the
  editor. No invisible state.

## Reference precedents (verified)

- **Hermes Agent** — `~/.hermes/memories/MEMORY.md` (~2,200 chars,
  ~800 tokens) and `USER.md` (~1,375 chars, ~500 tokens), single `memory`
  tool with `add` / `replace` / `remove` actions, `§` delimiter, error-
  on-full consolidation loop. Verified at
  [hermes-agent.nousresearch.com/docs/user-guide/features/memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)
  and `/features/personality`.
- **agentskills.io open standard** — `<skill>/SKILL.md` + optional
  `scripts/`, `references/`, `assets/`. Required fields: `name`,
  `description`. Three-stage progressive disclosure: Discovery,
  Activation, Execution. Standard verified at
  [agentskills.io](https://agentskills.io). Parallx skill loader
  already satisfies the required-field minimum
  ([skillLoaderService.ts L225](../src/services/skillLoaderService.ts#L225));
  what's missing is subfolder discovery.

## Verified codebase facts

Confirmed by reading actual code before phase work. Use these as the
contract — do not re-derive.

**Prompt-file bootstrap layer:**
- `PromptFileService.loadLayers` parallel-loads
  `.parallx/SOUL.md`, `.parallx/AGENTS.md`, `.parallx/TOOLS.md`, and
  `.parallx/rules/*.md` ([promptFileService.ts L247-L255](../src/services/promptFileService.ts#L247-L255)).
- Cache is invalidated via `invalidate()` when file watchers fire
  ([promptFileService.ts L222-L225](../src/services/promptFileService.ts#L222-L225)).
- Layered output type is `IPromptFileLayers` — adding USER.md means
  adding one field to this type and one entry to the `Promise.all`.

**Memory file substrate:**
- Scaffold at `WorkspaceMemoryService.ensureScaffold`
  ([workspaceMemoryService.ts L195-L218](../src/services/workspaceMemoryService.ts#L195-L218))
  creates `.parallx/`, `.parallx/memory/`, and an initial MEMORY.md.
- Section writes via `replaceMarkdownSection` are idempotent and
  preserve content outside the replaced section
  ([workspaceMemoryService.ts L30-L50](../src/services/workspaceMemoryService.ts#L30-L50)).
- Existing sections: `## Preferences`, `## Concepts`, `## Legacy Import`,
  and per-session `## Session <id>` blocks in daily files.
- Section parsing for read-back: `parsePreferenceLines`, `parseConceptSection`
  ([workspaceMemoryService.ts L76-L143](../src/services/workspaceMemoryService.ts#L76-L143)).
  These let the agent read its own past entries before deciding to
  add/replace/remove.
- `upsertPreferences` and `upsertConcepts` merge against current file
  state ([workspaceMemoryService.ts L341-L423](../src/services/workspaceMemoryService.ts#L341-L423))
  — these are the clean APIs to wrap, not the raw `sync*` methods.

**Memory read tools:**
- `createMemoryGetTool(fs)` and `createMemorySearchTool(memorySearch)`
  ([memoryTools.ts](../src/built-in/chat/tools/memoryTools.ts)) — both
  permission-level `always-allowed`, no confirmation.
- `memory_search` routes through `ICanonicalMemorySearchService` which
  is backed by the indexing pipeline + retrieval service
  ([canonicalMemorySearchService.ts](../src/services/canonicalMemorySearchService.ts)).

**Concept pipeline (currently SQLite-only):**
- Context engine extracts concepts on session events at
  [openclawContextEngine.ts L400-L525](../src/openclaw/openclawContextEngine.ts#L400-L525).
- Calls `storeConceptsFromSession(concepts, sessionId)` →
  `memoryService.storeConcepts` → SQLite `learning_concepts` table +
  vector store `concept` source type
  ([memoryService.ts L540-L618](../src/services/memoryService.ts#L540-L618)).
- Does **not** call `WorkspaceMemoryService.upsertConcepts` — so
  MEMORY.md's `## Concepts` section is never populated by this path
  in production.

**Dead preference path:**
- `MemoryService.extractAndStorePreferences` ([memoryService.ts L716](../src/services/memoryService.ts#L716))
  and `detectPreferences` ([memoryService.ts L68-L103](../src/services/memoryService.ts#L68-L103))
  are fully implemented but have **no production callers** — only test
  files (`tests/unit/memoryService.test.ts`, `tests/unit/chatDataServiceMemoryRecall.test.ts`)
  reference them. Verified via grep.

**Skill catalog:**
- `SkillLoaderService.scanSkills` reads only `<dir>/SKILL.md` at
  [skillLoaderService.ts L426-L451](../src/services/skillLoaderService.ts#L426-L451).
  Does not enumerate sibling files or subfolders.
- Required frontmatter fields: `name` + `description`
  ([skillLoaderService.ts L222-L225](../src/services/skillLoaderService.ts#L222-L225)).
  All Parallx-specific fields (`kind`, `permission`, `parameters`,
  `userInvocable`, `disableModelInvocation`) have defaults — Parallx
  skills already satisfy the agentskills.io minimum.
- Skill body is returned via the manifest's `handler` so the AI gets
  the content when it invokes the skill
  ([skillLoaderService.ts L297-L329](../src/services/skillLoaderService.ts#L297-L329)).

## Out of scope

These were considered and explicitly deferred — listing so future
milestones don't relitigate:

- **`skill_save` tool / agent-authored skills.** User deferred. The
  substrate for it exists; revisit in a later milestone.
- **Workspace checkpoints + `/rollback`.** Real Hermes feature but
  bigger surface; design discussion needed (git stash vs sibling
  files vs full snapshots). Separate milestone.
- **Background curation agent.** Hermes does not actually have one
  either (verified); the chat agent itself does the curation via
  `memory_edit`'s error-on-full loop. Revisit only if the in-line
  curation proves insufficient after this milestone ships.
- **Replacing SQLite memory entirely.** Concepts still benefit from
  vector retrieval for `recallConcepts`-style semantic lookup. This
  milestone makes the two paths consistent, not collapsed.
- **Removing `memory_get` / `memory_search`.** They stay. They are
  the read half of the surface and they work.

---

## Phase 1 — USER.md as a bootstrap layer

**Goal:** USER.md exists at `.parallx/USER.md`, is auto-scaffolded with a
starter template on first workspace open, is loaded into every system
prompt alongside SOUL.md / AGENTS.md / TOOLS.md, and is invalidated on
file change like the others.

**Files touched:**
- [src/services/promptFileService.ts](../src/services/promptFileService.ts):
  add `user` to `IPromptFileLayers`; add `'.parallx/USER.md'` to the
  `Promise.all` at L247; add a `DEFAULT_USER` constant with starter
  template; extend the no-workspace fallback at L238-L243.
- Caller list: anywhere `loadLayers()` is consumed and the resulting
  layers are flattened into bootstrap files for the OpenClaw participant
  needs USER.md added in the same order convention (after SOUL,
  before AGENTS — identity-first reading).
  - **Verify before edit:** grep `loadLayers\(\)` to find every
    consumer and confirm the order convention is consistent.
- Scaffold: `ensureScaffold` in `WorkspaceMemoryService` currently
  creates MEMORY.md only. Add a sibling step that creates
  `.parallx/USER.md` if missing. Alternative: scaffold lives in `/init`
  ([initCommand.ts L145-L153](../src/built-in/chat/commands/initCommand.ts#L145-L153))
  alongside the other default files. Decide based on whether USER.md
  should exist before `/init` is ever run. **Recommendation:** scaffold
  on first workspace open via `ensureScaffold` so USER.md is there even
  for users who never run `/init`.
- File watcher: ensure the watcher that calls
  `PromptFileService.invalidate()` for SOUL/AGENTS/TOOLS also watches
  USER.md. Verify by grep on `invalidate\(\)` call sites.

**Starter template (proposed):**

```markdown
# User

This file tells the AI who you are, what you're working on, and how
you like to work. The AI reads this every turn and can update it via
the `memory_edit` tool when you confirm a preference or fact.

## About
- (Replace this with: your name, role, what you do)

## Current focus
- (What you're working on right now)

## Preferences
- (How you like the AI to behave — tone, depth, format)
```

**Token cost:** USER.md ≤ 1,500 chars = ~375 tokens added to every
system prompt. Within the M11 budget (~10% of context window). No
budget review needed.

**Verification before close:**
- USER.md is scaffolded on first workspace open.
- System prompt contains USER.md content (test by editing the file and
  asking the AI "what's in my user profile").
- Cache invalidation works when USER.md is edited externally.

---

## Phase 2 — `memory_edit` tool

**Goal:** A single chat tool the agent can call to add, replace, or
remove entries in USER.md, MEMORY.md, or today's daily log. Routes
through `WorkspaceMemoryService.upsertPreferences`/`upsertConcepts`/
`appendDailyMemory` so SQLite and file state stay coherent. Bounded
files return an error-with-current-contents when a write would exceed
cap so the agent must consolidate.

**Tool shape:**

```ts
memory_edit({
  file: 'USER' | 'MEMORY' | 'daily',
  action: 'add' | 'replace' | 'remove',
  entry: string,        // for add and replace: the new content
  target?: string,      // for replace and remove: identifying substring
  date?: string,        // for file='daily', YYYY-MM-DD, defaults today
})
```

Semantics by file:
- **`USER`**: entries are markdown lines or sections appended to the
  body; `replace` matches `target` substring within the file; `remove`
  deletes lines containing `target`. Bound: 1,500 chars.
- **`MEMORY`**: entries route through the existing section model.
  `entry` is auto-classified by leading marker: `key: value` → goes
  to `## Preferences` section via `upsertPreferences`; `### Concept Name`
  → `## Concepts` via `upsertConcepts`; otherwise free-form goes to a
  new `## Notes` section. Bound: 2,500 chars. (Decide in phase 2
  whether to expose the section selector explicitly to the agent or
  keep auto-classification. **Recommendation:** explicit `section`
  parameter — less magic, easier for the model to reason about.)
- **`daily`**: append-only via `appendDailyMemory` for `action='add'`;
  `replace` and `remove` operate on the day's file by `target` substring.
  No bound.

**Bounded-write protocol:**
- Read current file size before write.
- If `action='add'` and new content would exceed cap, return:
  ```
  Cannot add — <file> is at <N>/<CAP> chars. Current contents:

  <full file contents>

  Use action='replace' or action='remove' to free space before adding.
  ```
- This mirrors Hermes's error-on-full pattern verbatim. Tested in
  their docs to be load-bearing for actual agent curation behavior.

**Files touched:**
- [src/built-in/chat/tools/memoryTools.ts](../src/built-in/chat/tools/memoryTools.ts):
  add `createMemoryEditTool(workspaceMemoryService, fs)`.
- Tool registration site: find where `createMemoryGetTool` and
  `createMemorySearchTool` are registered and add `createMemoryEditTool`
  alongside. **Verify before edit:** grep `createMemoryGetTool\(`.
- [src/built-in/chat/chatTypes.ts](../src/built-in/chat/chatTypes.ts):
  if a service interface needs extending to expose
  `WorkspaceMemoryService` to the tool factory, add it here.
- Permission level: `requires-approval` for first ship, can relax to
  `always-allowed` later if the UX shows the approval prompt is
  unnecessary friction. **Recommendation:** `requires-approval`
  initially — memory writes are user-visible and reversible (file is
  in git), but the approval rail teaches the user what's being saved.

**Verification before close:**
- AI can call `memory_edit` and the change shows up in the .md file
  immediately.
- Bounded write rejection shows the current file content in the tool
  result.
- After a `memory_edit` to USER.md, the next turn's system prompt
  reflects the change (depends on file-watcher → `invalidate()`).
- `MEMORY.md` `## Preferences` section is now writable by the agent
  via the same path that `syncPreferences` uses internally.

---

## Phase 3 — Wire concept extraction to MEMORY.md

**Goal:** When the context engine extracts concepts and calls
`storeConceptsFromSession`, the result also lands in MEMORY.md's
`## Concepts` section via `WorkspaceMemoryService.upsertConcepts`.
SQLite and file stay in sync. Reading `MEMORY.md` shows the user
exactly what the AI has learned.

**Files touched:**
- [src/openclaw/openclawContextEngine.ts L400-L525](../src/openclaw/openclawContextEngine.ts#L400-L525):
  the existing `storeConceptsFromSession` callback gets a paired
  `upsertConcepts` call. Either add a second callback to the participant
  services (preferred — keeps separation between SQLite path and file
  path) or have `storeConceptsFromSession` internally fan out.
- [src/built-in/chat/main.ts L1079](../src/built-in/chat/main.ts#L1079):
  wire the new callback at the data-service registration point.

**Order decision:** SQLite first, MEMORY.md second. If MEMORY.md write
fails (bounded? file lock?), SQLite still has the data and the next
session start can attempt a sync. The reverse order would risk losing
the structured record on file errors.

**Verification before close:**
- After a session with conceptual content, MEMORY.md's `## Concepts`
  section reflects the extracted concepts.
- The same concepts are also queryable via `recallConcepts` from
  SQLite.
- `memory_get` on MEMORY.md and `memory_search` on the concepts
  section return the same conceptual content.

---

## Phase 4 — Remove dead preference auto-extraction

**Goal:** Delete `extractAndStorePreferences` and `detectPreferences`
from MemoryService and the corresponding interface declaration. The
agent now writes preferences explicitly via `memory_edit` (phase 2),
so the regex path is both unused and undesirable (agent has better
signal than regex for what's actually a preference).

**Files touched:**
- [src/services/memoryService.ts L68-L103](../src/services/memoryService.ts#L68-L103):
  remove `detectPreferences` and its export.
- [src/services/memoryService.ts L716+](../src/services/memoryService.ts#L716):
  remove `extractAndStorePreferences` method.
- [src/services/serviceTypes.ts L1791](../src/services/serviceTypes.ts#L1791):
  remove from `IMemoryService` interface.
- Test cleanup:
  - `tests/unit/memoryService.test.ts` — remove the
    `extractAndStorePreferences` describe block (L682+).
  - `tests/unit/chatDataServiceMemoryRecall.test.ts` — remove the
    `extractAndStorePreferences` mock (L10, L252).

**Verification:**
- Grep `extractAndStorePreferences` returns zero matches in `src/`
  and `tests/`.
- Build passes. Existing tests still pass.

**Why this is in the milestone:** dead code is a cohesion hazard. A
future contributor finding `detectPreferences` next to the new agent-
authored preferences path would reasonably assume both paths run,
introducing parallel writes and confusion. Removing it locks in the
"one substrate, multiple writers" rule.

---

## Phase 5 — Unified `buildMemorySection` rewrite

**Goal:** The system-prompt memory section names the whole surface in
one paragraph — identity files (SOUL/AGENTS/USER), memory files
(MEMORY/daily), and the tools that operate on them — with consistent
verbs. The agent stops seeing memory as three disconnected boxes.

**Files touched:**
- [src/openclaw/openclawSystemPrompt.ts L463-L478](../src/openclaw/openclawSystemPrompt.ts#L463-L478):
  rewrite `buildMemorySection` to cover:
  - "You have identity files (`SOUL.md`, `AGENTS.md`, `USER.md`) loaded
    automatically every turn — read them via your context."
  - "You have a bounded memory at `MEMORY.md` and daily logs at
    `<date>.md` under `.parallx/memory/`."
  - "Use `memory_get` to read a specific layer, `memory_search` for
    topic-based recall across all memory, and `memory_edit` to add,
    replace, or remove entries when you've learned something durable.
    MEMORY.md and USER.md are bounded — when full, you'll get an
    error listing current entries; consolidate before adding."
  - When to use which: explicit triggers (user states a preference,
    a project decision is made, a recurring fact is referenced).

**Verification:**
- The section reads as one coherent surface, not three boxes.
- An eval run on a fresh chat: ask the AI "what's in your memory
  system" — expected to enumerate identity files + memory files +
  three tools, not just the read tools.

---

## Phase 6 — agentskills.io subfolder alignment

**Goal:** `SkillLoaderService.scanSkills` enumerates `<skill>/scripts/`,
`<skill>/references/`, `<skill>/assets/` and surfaces them to the
agent. Skills authored against the open standard load without
modification. Skills the agent might author later (deferred to a
future milestone) can bundle helper scripts or reference files.

**Files touched:**
- [src/services/skillLoaderService.ts L394-L408](../src/services/skillLoaderService.ts#L394-L408):
  extend `getSkillCatalog` to include a `bundledFiles: string[]`
  field — relative paths of any sibling files under the skill
  directory.
- [src/services/skillLoaderService.ts L426-L451](../src/services/skillLoaderService.ts#L426-L451):
  in `scanSkills`, after locating `SKILL.md`, also call `listDirs`
  on the skill directory and recurse one level into `scripts/`,
  `references/`, `assets/` (the three standard names).
- [src/openclaw/openclawSystemPrompt.ts L271-L306](../src/openclaw/openclawSystemPrompt.ts#L271-L306):
  the `<skill>` XML emission gains an optional `<bundle>` child
  listing bundled file paths so the agent knows to `read_file` them
  on demand (Execution stage of progressive disclosure).

**Verification:**
- Drop a skill folder with `SKILL.md` + `scripts/foo.py` into
  `.parallx/skills/`. The skill catalog reports the script path. The
  agent's system prompt mentions the bundled file. `read_file` works
  on the path.
- Existing default skills (without subfolders) load unchanged.

---

## Phase 7 — Documentation and migration notes

**Goal:** Update the user-facing docs and inline references so the
new surface is documented and any users with pre-M81 workspaces get
a clean upgrade.

**Files touched:**
- [docs/ai/AI_USER_GUIDE.md](../docs/ai/AI_USER_GUIDE.md): add
  USER.md to the prompt-files section; document `memory_edit`.
- [docs/Future_Improvements.md](../docs/Future_Improvements.md):
  remove any entries this milestone closes.
- [ARCHITECTURE.md](../ARCHITECTURE.md): update the prompt-file
  list (currently mentions SOUL/AGENTS only at L339-L340).

**Migration:** for existing workspaces — `ensureScaffold` is
idempotent and creates USER.md only if missing. No destructive
change. The dead preference code deletion (phase 4) has no runtime
effect since it was never called. The `memory_edit` tool is purely
additive. The skill subfolder loader is purely additive.

---

## Phase 8 — Memory as index + topic files (progressive disclosure)

**Status:** ✅ Shipped 2026-05-26. Three subagents in coordinated parallel:
Agent A delivered the service foundation (lesson CRUD + index helpers +
archive migration); Agent B extended `memory_edit` with `file=lesson` and
`memory_get` with `name=<slug>`; Agent C rewrote `buildMemorySection` and
wired the legacy-archive + LLM consolidation pass into `/init`. Supervisor
verified each agent's claims via 3-layer code-checking, integrated the
results, ran the full test suite (3,185 passed / 1 skipped / 0 failed),
and updated user-facing docs.

**Why this phase exists:** Reviewing the user's personal workspace
MEMORY.md after Phases 1–7 revealed the file was 100% regex-extraction
noise from the pre-M81 pipeline — hundreds of `### Foo / - Category /
- Encounters / - Mastery` blocks generated by `extractConceptsFromTranscript`
(removed in Phase 3) and the dead preference auto-extractor (removed in
Phase 4). Worse, the substrate itself is wrong: MEMORY.md gets loaded
*in full* into every system prompt via the bootstrap-file path, so a
polluted MEMORY.md doesn't just sit on disk, it poisons every turn.
Even a perfectly curated agent-written MEMORY.md would compete for prompt
budget with skills, identity files, and RAG.

The fix is structural, not janitorial: model memory exactly like the
skill catalog already works. The catalog injects `<name>/<description>/
<location>` per skill into the prompt; the body is read on demand via
`read_file`. Apply the same shape to memory.

**Goal:** Restructure `.parallx/memory/MEMORY.md` from a single content
file into a bounded INDEX of topic-file pointers. Topic files (called
"lessons") live at `.parallx/memory/lessons/<slug>.md` and are read
on-demand by the agent, not auto-loaded. Mirrors the Claude Code
auto-memory pattern verbatim (index + topic files, progressive disclosure)
and the existing Parallx skills shape.

**New on-disk layout:**

```
.parallx/memory/
├── MEMORY.md          ← INDEX only, bounded ~2,500 chars (~25 entries)
├── lessons/           ← NEW. Topic files, NOT auto-loaded.
│   ├── <slug>.md      ← Each lesson is its own file
│   └── ...
├── YYYY-MM-DD.md      ← unchanged — daily logs (append-only, unbounded)
└── _archive/          ← NEW. Archived lessons + pre-M81 noise.
    └── pre-m81-concepts.md  ← Old regex blocks moved here on /init.
```

**MEMORY.md content shape:**

```markdown
# Memory Index

Long-term lessons. Each line points to a lesson file with the full body.
Bounded — when the index is full the agent removes an old entry before
adding a new one.

- [Canvas: no page-move tool](lessons/canvas-no-move-tool.md) — `canvas_set_page_property` only sets metadata; page hierarchy isn't programmable
- [Ollama: tool content must be string](lessons/ollama-tool-result-string.md) — extensions returning MCP-shape arrays cause HTTP 400
- [Qwen3 MoE thinking loops](lessons/qwen3-moe-thinking-loops.md) — upstream-unresolved infinite-loop in reasoning mode; switch to non-thinking variant
```

**What goes in lessons (per user direction):** Long-term learnings that
help the AI use a tool / write code / make decisions better next time.
Tool-use gotchas, workarounds, project-state-that-persists. **Not**
preferences (USER.md), **not** events (dailies), **not** general project
context (AGENTS.md). User's phrasing: *"helpers to remember to use a
particular tool in a particular way."*

**Scope:**

1. **`WorkspaceMemoryService` additions** ([src/services/workspaceMemoryService.ts](../src/services/workspaceMemoryService.ts)):
   - `getLessonsRootRelativePath()` → `.parallx/memory/lessons`
   - `getLessonFileRelativePath(slug)` → `.parallx/memory/lessons/<slug>.md`
   - `readLessonFile(slug)` → content or empty string
   - `writeLessonFile(slug, content)` → write to disk; create lessons/ if missing
   - `archiveLessonFile(slug)` → move file to `_archive/lessons/<slug>.md`; return true if archived, false if didn't exist
   - `listLessons()` → string[] of slugs present on disk under lessons/
   - `parseMemoryIndex()` → `Array<{ slug, description, path }>` — parses `- [Title](lessons/slug.md) — desc` lines
   - `addMemoryIndexEntry(slug, description)` → idempotent: replace if slug already in index, else append
   - `removeMemoryIndexEntry(slug)` → remove the line matching slug from index
   - `archiveLegacyConceptSection()` → idempotent migration: if MEMORY.md `## Concepts` matches regex-extraction signature (`Mastery: N.N` + `Encounters: N` + `- Category:`), move the whole section to `_archive/pre-m81-concepts.md` and rewrite MEMORY.md to clean index header
   - Update `IWorkspaceMemoryService` interface in [serviceTypes.ts](../src/services/serviceTypes.ts)

2. **`IBuiltInToolWorkspaceMemory` accessor** extended in [chatTypes.ts](../src/built-in/chat/chatTypes.ts) to expose the new lesson methods.

3. **`memory_edit` tool extension** ([memoryTools.ts](../src/built-in/chat/tools/memoryTools.ts)):
   - New `file: 'lesson'` value.
   - For `file=lesson`:
     - `add`: requires `slug` (kebab-case, ≤40 chars), `entry` (body), `description` (≤120 chars). Creates `lessons/<slug>.md`, adds index entry. Enforces index cap; on full returns current index + error.
     - `replace`: requires `slug` and `entry`. Overwrites body. If `description` supplied, updates index entry too.
     - `remove`: requires `slug`. Archives the file via `archiveLessonFile`, removes the index entry.
   - Existing `USER` / `MEMORY` / `daily` actions stay (additive change).

4. **`memory_get` tool extension** ([memoryTools.ts](../src/built-in/chat/tools/memoryTools.ts)):
   - New optional `name: <slug>` parameter to fetch a specific lesson body.
   - Existing `layer=durable|daily` behavior unchanged.

5. **`/init` extension** ([openclawDefaultRuntimeSupport.ts](../src/openclaw/openclawDefaultRuntimeSupport.ts)):
   - On invocation:
     - Call `archiveLegacyConceptSection()` first (idempotent — no-op if MEMORY.md is already clean).
     - If `lessons/` is empty AND daily files OR session transcripts exist: run an LLM consolidation pass. Prompt: read the most recent N dailies + transcripts, propose 3–8 candidate durable lessons. Write each as `lessons/<slug>.md` + index entry.
     - Re-runnable: subsequent `/init` calls only propose NEW slugs (skip any already on disk).

6. **`buildMemorySection` rewrite** ([openclawSystemPrompt.ts](../src/openclaw/openclawSystemPrompt.ts)):
   - Explain the index model: MEMORY.md is an INDEX, not content.
   - Tell the agent: read the index every turn; when a description matches, call `memory_get name=<slug>` (or `read_file lessons/<slug>.md`) to load the body.
   - Update write triggers to explicitly mention:
     - The user corrected you about a tool or fact ("don't use X, use Y instead", "you got Z wrong") → `memory_edit file=lesson add`.
     - You noticed a recurring tool-use mistake you should not repeat.
     - A workaround / gotcha emerges that future sessions will need.
   - Reinforce cap discipline (remove an old lesson before adding when index is full).

7. **Tests**:
   - `workspaceMemoryService.test.ts`: lesson CRUD, index parsing, archive migration of regex-style content, archive idempotency
   - `memoryEditTool.test.ts`: `file=lesson` add/replace/remove, index cap behavior, slug validation
   - `openclawSystemPrompt.test.ts`: new memory section content, write triggers

**Cohesion guarantees:**
- Memory and skills become structurally identical: `<name>/<description>/<location>` in the prompt, body loaded on demand.
- One `memory_edit` tool covers everything; one new `file=lesson` value, no separate tool.
- Archive-don't-delete throughout — no data loss on migration or on lesson removal.
- `/init` is the single command that scaffolds + consolidates (matches the M81 Phase 1 decision to keep `/init` as the single activation path).

**Out of scope for this phase:**
- UI surface for browsing / editing lessons from inside Parallx (deferred — file editing in any text editor is sufficient short-term).
- Auto-consolidation outside of `/init` (no background pass; user controls when consolidation happens).
- Cross-workspace lesson sharing.

---

## Phase 9 — Canvas tool consolidation

**Status:** ✅ Shipped 2026-05-26.

**Why this phase exists:** While reviewing M81 the user surfaced two
canvas-tool redundancies that small models routinely fumble:

1. `canvas_compose_page` is the tool for editing an existing page, but
   its name is so close to `canvas_create_page` that the model often
   skipped it and tried to use `canvas_create_page` to "edit" a page
   (which silently creates a duplicate). The intent was "one tool to
   create, one tool to edit" — the names didn't carry that.
2. `canvas_get_page` and `canvas_read_page` both took a single page
   identifier and returned info about that one page. The split was body
   (read) vs. metadata + properties (get). That's not a true surface
   distinction — it's two queries against the same row.

**Scope:**

1. **Merge `canvas_get_page` into `canvas_read_page`.** The merged tool
   returns body + metadata (title, id, icon, created/updated, archived
   state, block count) + custom properties in one call. Workspace-wide
   property definitions are not part of read_page — use
   `canvas_list_property_definitions` for those. Tool count drops by 1.

2. **Rename `canvas_compose_page` → `canvas_edit_page`** to mirror the
   `create / edit` mental model used elsewhere in the codebase
   (`write_file` / `edit_file`). The factory becomes `createEditPageTool`;
   the wire-protocol name is `canvas_edit_page`.

3. **Sharpen `canvas_create_page` description** to explicitly state the
   UUID is auto-assigned and to point at `canvas_edit_page` for existing
   pages, so the model can never confuse them again.

**Files touched:**
- `src/built-in/chat/tools/pageTools.ts` — merge get_page body into
  read_page; delete createGetPageTool; rename createComposePageTool to
  createEditPageTool; tighten create_page description.
- `src/built-in/chat/tools/builtInTools.ts` — drop the createGetPageTool
  import + registration; rename compose → edit in import + registration.
- `src/openclaw/openclawToolPolicy.ts` — remove `canvas_get_page` from
  both readonly + standard profiles; rename `canvas_compose_page` →
  `canvas_edit_page` in standard profile + approval list.
- `src/built-in/chat/tools/blockTools.ts` + `writeTools.ts` — descriptions
  that pointed at `canvas_compose_page` now point at `canvas_edit_page`.
- `src/built-in/chat/defaults/TOOLS.md` — remove get_page bullet,
  rewrite read_page / create_page / edit_page bullets to make the
  create-vs-edit distinction explicit.
- `tests/unit/builtInTools.test.ts` — tool count assertion 38 → 37;
  sorted name list updated; read_page tests rewritten to cover the
  merged metadata + properties; two `get_page` describe blocks deleted;
  `compose_page` describe renamed to `edit_page`; db-backed set updated.
- `tests/unit/openclawToolPolicy.test.ts` — `canvas_compose_page` →
  `canvas_edit_page` in color classification test.
- `tests/eval/tool-skill-manifest.json` — drop canvas_get_page entry;
  rename canvas_compose_page entry to canvas_edit_page; update the
  research-topic skill's expectedToolChain; update cross-references in
  canvas_edit_block + write_file descriptions.
- `tests/e2e/23-chat-context.spec.ts` — expectation flipped from
  "toolNames toContain 'canvas_get_page'" to "toolNames NOT toContain
  'canvas_get_page'" so the test enforces the consolidation.

**Cohesion guarantees:**
- create_page and edit_page now mirror write_file / edit_file naming.
  Single mental model across file + canvas writes.
- read_page returns everything the agent typically wants about a page in
  one call — no chained tool dance.
- Property definitions live in one place (`canvas_list_property_definitions`),
  not duplicated inside read_page.

**Out of scope for this phase:**
- Further merging of find / read into one polymorphic tool — verified
  in the design conversation that they have genuinely distinct return
  shapes and arg shapes; merging would just hide the routing inside a
  schema instead of names.
- Block-level tool consolidation (`canvas_edit_block`,
  `canvas_insert_block_after`, `canvas_link_block`) — separate concern,
  deferred.

---

## Phase 10 — Tool categories visible to settings UI and to the AI

**Status:** In progress 2026-05-26.

**Why this phase exists:** Real-workspace evidence — the AI repeatedly
misroutes between similar tool families. Example reported by the user:
calling `read_file` on a canvas page UUID instead of `canvas_read_page`.
The existing defense is anti-routing prose inside each tool description
("For canvas pages use `canvas_read_page`"), which small models ignore.
The settings UI lumps all 37 built-in tools under one flat "Built-In"
bucket, so the user can't see the conceptual structure either. Two
symptoms, one root cause: there's no first-class **category** on tools.

**Design:** Add a single `category` field on `IChatTool` that drives
both surfaces. Source of truth lives on the tool itself, populated at
factory time. No new schema, no separate registry.

**On-disk surface change:**

```ts
// src/services/chatTypes.ts
export type ToolCategory =
  | 'canvas' | 'file-system' | 'memory' | 'transcript'
  | 'cron' | 'surface' | 'subagent' | 'autonomy'
  | 'linking' | 'app-control' | 'terminal';

export interface IChatTool {
  // ...existing fields...
  readonly category?: ToolCategory;
}
```

**Scope:**

1. **Type + interface** (already landed in this turn before Agent A
   spawns): `ToolCategory` added at [chatTypes.ts](../src/services/chatTypes.ts);
   optional `category` field added to `IChatTool`.

2. **Populate `category` on every built-in tool factory** (Agent A
   territory — mechanical work across ~13 files):
   - `canvas` → all `canvas_*` factories in `pageTools.ts` + `blockTools.ts`
   - `file-system` → `list_files`, `read_file`, `search_files`, `grep_search`,
     `search_knowledge` in `fileTools.ts`; `write_file`, `edit_file`,
     `delete_file` in `writeTools.ts`
   - `memory` → all three memory tools in `memoryTools.ts`
   - `transcript` → both transcript tools in `transcriptTools.ts`
   - `terminal` → `run_command` in `terminalTools.ts`
   - `surface` → both surface tools in `surfaceTools.ts`
   - `cron` → all 8 cron tools in `cronTools.ts`
   - `subagent` → `sessions_spawn` in `subagentTools.ts`
   - `autonomy` → `autonomy_log` in `autonomyLogTool.ts`
   - `linking` → `parallx_link` in `parallxLinkTool.ts`
   - `app-control` → any `app_*` tools in `appCommandTools.ts`

3. **Settings UI sub-grouping** ([toolsSection.ts](../src/aiSettings/ui/sections/toolsSection.ts)):
   inside the existing "Built-In" bucket, sub-group by `category`. Render
   as collapsible sub-headers (Canvas, File System, Memory, …) so the
   user sees the conceptual structure. Tools without a `category` fall
   into a "General" sub-bucket at the bottom of "Built-In" for now.

4. **System prompt category map** ([openclawSystemPrompt.ts](../src/openclaw/openclawSystemPrompt.ts)
   `buildToolSummariesSection`): prepend a short category map that tells
   the model which tool family operates on which surface. Format:

   ```
   ## Tooling
   Each tool belongs to a category that names its operational surface.
   Pick tools from the category that matches the resource type:
   - canvas — canvas page DB (titles, IDs, blocks, properties).
     Tools: canvas_*
   - file-system — workspace files on disk (paths under the workspace root).
     Tools: read_file, write_file, edit_file, delete_file, list_files,
     search_files, grep_search, search_knowledge
   - memory — .parallx/memory/ index + lessons + daily logs.
     Tools: memory_get, memory_search, memory_edit
   - transcript — session transcripts. Tools: transcript_get, transcript_search
   - cron — scheduled tasks. Tools: cron_*
   - terminal — shell execution. Tools: run_command
   - surface — UI surface routing. Tools: surface_send, surface_list
   - subagent — child agent runs. Tools: sessions_spawn
   - autonomy — autonomy log read. Tools: autonomy_log
   - linking — parallx:// URIs. Tools: parallx_link
   - app-control — workbench commands.

   If the user asks about a "page" or names something that looks like a
   page title or UUID, prefer canvas_* tools. If the path looks like a
   filesystem path (`src/foo/bar.ts`, `docs/README.md`), prefer
   file-system tools. The full per-tool description + parameter schema
   for every available tool is provided by the function-calling schema
   for this turn — read each tool's description before calling.
   ```

   This replaces the current generic preamble.

5. **Tests**:
   - Add an assertion in `builtInTools.test.ts` that every registered
     built-in tool has a `category` field set (regression guard so
     future tools don't slip through uncategorized).
   - `openclawSystemPrompt.test.ts` — assert the new section emits the
     category map and the canvas/file-system routing rules.

**Cohesion guarantees:**
- One source of truth (`IChatTool.category`). No parallel registry, no
  string-matching heuristics on tool names.
- Settings UI and system prompt read from the same place, so they can't
  drift apart.
- Optional field — extensions don't have to opt in. Their tools fall
  into a "General" sub-bucket today; future work can decide whether to
  require category on extension tools too.

**Out of scope:**
- Cross-cutting consolidation (e.g. unifying memory_get + memory_search).
  Categories make the structure visible; consolidation is a separate
  decision per pair.
- Reorganizing tool descriptions to be more compact now that the
  prompt section explains categories — possible future cleanup.

---

## Phase dependency graph

```
Phase 1 (USER.md)  ─┐
                    ├─→ Phase 2 (memory_edit) ─→ Phase 5 (prompt rewrite) ─→ Phase 7 (docs)
Phase 3 (concepts) ─┤
Phase 4 (dead code) ┘
Phase 6 (skill subfolders)  — independent, can ship any time after Phase 2
```

Phases 1, 3, 4, and 6 are independent and can land in parallel commits
if convenient. Phase 2 depends on Phase 1 because `memory_edit`
references USER.md. Phase 5 depends on Phases 1–4 because the prompt
rewrite describes the new unified surface. Phase 7 is last.

## Cohesion checklist (close-out)

Before this milestone is marked closed, every item below must be true.
This is the verification that the milestone delivered cohesion, not
just features:

- [ ] Reading the system prompt's memory section shows ONE surface
      with identity + memory + tools described together.
- [ ] Every agent-initiated memory write goes through
      `WorkspaceMemoryService`. No new SQL-only write path was added.
- [ ] Every system-initiated memory write that previously went only
      to SQLite (concepts) now also lands in MEMORY.md.
- [ ] No dead code referencing the old regex preference path remains.
- [ ] USER.md scaffold + load + invalidate works the same way as
      SOUL.md / AGENTS.md / TOOLS.md (verified by grep — the calling
      conventions match).
- [ ] A skill authored to the agentskills.io standard loads in
      Parallx with its bundled files reachable to the agent.
- [ ] User-facing docs reflect the new surface.

If any item fails verification, the milestone is not done.
