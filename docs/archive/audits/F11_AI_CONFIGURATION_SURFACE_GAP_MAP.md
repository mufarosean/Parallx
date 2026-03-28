# F11: AI Configuration Surface — Gap Map (Iteration 1)

**Date:** 2026-03-27  
**Author:** Gap Mapper  
**Input:** `docs/F11_AI_CONFIGURATION_SURFACE_AUDIT.md`  
**Scope:** Iteration 1 — highest-impact fixes only  
**User decision:** Clean break — remove legacy personality/prompt surfaces, align to OpenClaw file-based config

---

## Change Plan Summary

| Gap ID | Capability | Severity | Status → Target | Summary |
|--------|-----------|----------|-----------------|---------|
| F11-G01 | C5: Model Parameters | HIGH | MISALIGNED → ALIGNED | Wire temperature + maxTokens to default participant |
| F11-G02 | C2: Bootstrap File Loading | HIGH | MISALIGNED → ALIGNED | Add built-in defaults for SOUL.md and TOOLS.md |
| F11-G03 | C3: Bootstrap File Scaffolding | MEDIUM | MISALIGNED → ALIGNED | Remove phantom bootstrap files from array |
| F11-G04 | C3: Bootstrap File Scaffolding | MEDIUM | MISALIGNED → ALIGNED | Expand /init to scaffold SOUL.md + TOOLS.md |
| F11-G05 | C12: Legacy System Prompt Builders | MEDIUM | LEGACY → ALIGNED | Fix token status bar to use OpenClaw prompt report |
| F11-G06 | C16: Runtime Selector | LOW | DEAD → ALIGNED | Remove dead runtime selector config |

---

## F11-G01: Wire temperature + maxTokens to default participant

- **Capability:** C5 — Model Parameters
- **Status:** MISALIGNED → ALIGNED
- **Severity:** HIGH (CRITICAL-1 — #1 user-facing bug)

### Upstream Reference

`applyExtraParamsToAgent` in `pi-embedded-runner/extra-params.ts:178-220` reads `config.agents.defaults.params` and applies temperature + other model parameters to the agent stream function. The config schema (`zod-schema.agent-defaults.ts`) includes a `params` record for per-model overrides of arbitrary parameters including temperature.

Workspace + canvas participants already implement this pattern correctly — they read `effectiveConfig?.model?.temperature` and `effectiveConfig?.model?.maxTokens` and pass them to `buildOpenclawReadOnlyRequestOptions`. The default participant is the only one that doesn't.

### Parallx Files to Modify

1. **`src/openclaw/openclawAttempt.ts`** — `IOpenclawTurnContext` interface + `requestOptions` construction
2. **`src/openclaw/participants/openclawDefaultParticipant.ts`** — `buildOpenclawTurnContext` population

### Change Description

**Step 1: Add `temperature` and `maxTokens` to `IOpenclawTurnContext`**

In `src/openclaw/openclawAttempt.ts`, add two optional fields to the `IOpenclawTurnContext` interface:

```typescript
// File: src/openclaw/openclawAttempt.ts
// In interface IOpenclawTurnContext, after the existing fields in "Tool inputs" section:

  // Model parameters (from unified config)
  readonly temperature?: number;
  readonly maxTokens?: number;
```

**Step 2: Wire temperature + maxTokens into requestOptions**

In `src/openclaw/openclawAttempt.ts`, in `executeOpenclawAttempt`, change the `requestOptions` construction (around line 210):

**Before:**
```typescript
  const requestOptions: IChatRequestOptions = {
    think: true,
    tools: context.toolState.availableDefinitions.length > 0 ? context.toolState.availableDefinitions : undefined,
    numCtx: context.tokenBudget,
  };
```

**After:**
```typescript
  const requestOptions: IChatRequestOptions = {
    think: true,
    tools: context.toolState.availableDefinitions.length > 0 ? context.toolState.availableDefinitions : undefined,
    numCtx: context.tokenBudget,
    temperature: context.temperature,
    maxTokens: context.maxTokens || undefined,
  };
```

**Step 3: Populate from unified config in `buildOpenclawTurnContext`**

In `src/openclaw/participants/openclawDefaultParticipant.ts`, in `buildOpenclawTurnContext`, add config reading before the return statement (around line 279):

**Before:**
```typescript
  return {
    sessionId: context.sessionId,
    history,
    tokenBudget: budget.total,
    // ... rest of return
```

**After:**
```typescript
  const effectiveConfig = services.unifiedConfigService?.getEffectiveConfig();

  return {
    sessionId: context.sessionId,
    history,
    tokenBudget: budget.total,
    temperature: effectiveConfig?.model?.temperature,
    maxTokens: effectiveConfig?.model?.maxTokens,
    // ... rest of return
```

### What to Remove

Nothing — this is additive wiring. No heuristic code exists for this path.

### Verification

1. Open Settings UI → Model section → change temperature to 0.1
2. Send a chat message in the default participant
3. Verify via Ollama server logs that the request includes the configured temperature
4. Repeat for maxTokens — verify the response respects the limit

### Risk Assessment

- **Low risk.** Workspace + canvas participants already use this exact pattern.
- `temperature: undefined` is a no-op — Ollama falls back to model default when the field is absent.
- `maxTokens: undefined` (via the `|| undefined` guard) is also a no-op.
- No existing tests should break — this adds optional parameters that were previously absent.
- The `|| undefined` guard on maxTokens prevents sending `maxTokens: 0` which would be invalid.

---

## F11-G02: Add built-in defaults for SOUL.md and TOOLS.md in bootstrap loader

- **Capability:** C2 — Bootstrap File Loading
- **Status:** MISALIGNED → ALIGNED
- **Severity:** HIGH (CRITICAL-3)

### Upstream Reference

Upstream avoids missing bootstrap files by design: `ensureAgentWorkspace` in `agents/workspace.ts:155+` seeds bootstrap files on workspace creation via the `agents.commands.bind.ts:648-659` → `gateway/server-methods/agents.ts:663-665` call path.

Parallx cannot scaffold on "workspace open" (it's a desktop app, not a workspace manager), so the adaptation is: **provide built-in defaults for the two most important files** when they're missing from the workspace. This is analogous to how `PromptFileService` already has `DEFAULT_SOUL` — but that code is dead for the active runtime.

### Parallx Files to Modify

1. **`src/openclaw/participants/openclawParticipantRuntime.ts`** — `loadOpenclawBootstrapEntries` function

### Change Description

Modify `loadOpenclawBootstrapEntries` to inject built-in defaults for SOUL.md and TOOLS.md when they're missing from the workspace, instead of returning `{ missing: true }`.

**Before (lines 55-68):**
```typescript
  const entries: IOpenclawBootstrapEntry[] = [];
  for (const path of OPENCLAW_BOOTSTRAP_FILES) {
    const content = await readWorkspaceFile(path);
    if (typeof content === 'string') {
      entries.push({ name: path, path, content, missing: false });
      continue;
    }
    entries.push({ name: path, path, missing: true });
  }
```

**After:**
```typescript
  const entries: IOpenclawBootstrapEntry[] = [];
  for (const path of OPENCLAW_BOOTSTRAP_FILES) {
    const content = await readWorkspaceFile(path);
    if (typeof content === 'string') {
      entries.push({ name: path, path, content, missing: false });
      continue;
    }
    // Fall back to built-in defaults for core bootstrap files
    const builtIn = OPENCLAW_BOOTSTRAP_DEFAULTS.get(path);
    if (builtIn) {
      entries.push({ name: path, path, content: builtIn, missing: false });
      continue;
    }
    entries.push({ name: path, path, missing: true });
  }
```

**Add the defaults map** at module scope, after the existing constants:

```typescript
/**
 * Built-in defaults for core bootstrap files.
 *
 * Upstream seeds bootstrap files on workspace creation (ensureAgentWorkspace).
 * Parallx cannot do that at workspace-open time, so we inject sensible defaults
 * when the files are missing. Users can override by creating the files in their
 * workspace root.
 */
const OPENCLAW_BOOTSTRAP_DEFAULTS = new Map<string, string>([
  ['SOUL.md', `# Parallx AI Assistant

You are Parallx, a local AI assistant running entirely on the user's machine.
You help the user understand and work with their project files and canvas pages.

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
- For long explanations, use headers and bullet points`],
  ['TOOLS.md', `# Available Tools

## Workspace Skills
- **search_workspace** — Full-text search across all workspace files
- **search_knowledge** — Semantic (RAG) search using embeddings. Covers all indexed content including PDFs, DOCX, XLSX, and other rich documents. Best tool for searching large documents.
- **read_file** — Read file contents (supports text files and rich documents like PDF, DOCX, XLSX)
- **list_files** — List directory contents

## Canvas Skills
- **read_page** — Read a canvas page by ID
- **read_page_by_title** — Find and read a page by title
- **list_pages** — List all canvas pages
- **create_page** — Create a new canvas page (requires approval)
- **get_page_properties** — Get page metadata (icon, cover, dates)
- **read_current_page** — Read the currently open canvas page

## Tool Usage Guidelines
- When context from files is already in the message (via automatic retrieval), use it directly — do not re-read the file
- Use search_knowledge for conceptual questions ("how does auth work?") and for large documents (books, reports)
- Use search_workspace for exact string matches ("where is handleLogin defined?")
- Use read_file for small files or when you need the full content of a specific file
- When editing files, make the smallest change necessary
- Explain what you're changing and why before proposing edits`],
]);
```

These defaults are identical to the content in `src/built-in/chat/defaults/SOUL.md` and `src/built-in/chat/defaults/TOOLS.md`.

### What to Remove

After this change, the `[MISSING]` marker injection for SOUL.md and TOOLS.md will never fire because the defaults map will catch them first. No code needs to be removed — the `[MISSING]` path in `buildOpenclawBootstrapContext` still exists for any other files that genuinely have no default.

### Verification

1. Open a workspace with NO SOUL.md or TOOLS.md files
2. Send a chat message → `/context` command
3. Confirm the system prompt includes the default SOUL.md and TOOLS.md content
4. Confirm NO `[MISSING]` markers for SOUL.md or TOOLS.md in the bootstrap debug report
5. Create a custom SOUL.md in the workspace → confirm it overrides the default
6. Existing unit tests for `loadOpenclawBootstrapEntries` should still pass (they mock `readWorkspaceFile`)

### Risk Assessment

- **Low risk.** The defaults are identical to the already-shipped files in `src/built-in/chat/defaults/`.
- The change is additive — if a workspace file exists, it takes priority.
- The `missing: false` flag means `buildOpenclawBootstrapContext` treats built-in defaults identically to user files.
- Only SOUL.md and TOOLS.md get defaults. AGENTS.md is intentionally excluded because it should be workspace-specific (generated by `/init`).

---

## F11-G03: Remove phantom bootstrap files from OPENCLAW_BOOTSTRAP_FILES

- **Capability:** C3 — Bootstrap File Scaffolding
- **Status:** MISALIGNED → ALIGNED
- **Severity:** MEDIUM

### Upstream Reference

`VALID_BOOTSTRAP_NAMES` in `agents/workspace.ts:174-184` includes IDENTITY.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md as valid workspace files. However, upstream also seeds these files via `ensureAgentWorkspace` — they're optional extensions of the multi-channel gateway model, not core requirements.

In Parallx's single-user desktop context:
- **IDENTITY.md** — upstream uses this for multi-agent identity. Parallx has one agent. → Not applicable.
- **USER.md** — upstream stores user preferences per-agent. Parallx already has `preferencesPrompt` from memory. → Duplicate.
- **HEARTBEAT.md** — upstream daemon health/status. Parallx is a desktop app. → Not applicable.
- **BOOTSTRAP.md** — upstream meta-bootstrap. In Parallx, SOUL.md + AGENTS.md + TOOLS.md cover this. → Redundant.

### Parallx Files to Modify

1. **`src/openclaw/participants/openclawParticipantRuntime.ts`** — `OPENCLAW_BOOTSTRAP_FILES` constant

### Change Description

**Before (line 24-30):**
```typescript
export const OPENCLAW_BOOTSTRAP_FILES = [
  'SOUL.md',
  'AGENTS.md',
  'TOOLS.md',
  'IDENTITY.md',
  'USER.md',
  'HEARTBEAT.md',
  'BOOTSTRAP.md',
] as const;
```

**After:**
```typescript
export const OPENCLAW_BOOTSTRAP_FILES = [
  'SOUL.md',
  'AGENTS.md',
  'TOOLS.md',
] as const;
```

### What to Remove

4 entries from the array: `'IDENTITY.md'`, `'USER.md'`, `'HEARTBEAT.md'`, `'BOOTSTRAP.md'`. This eliminates 4 `[MISSING]` markers from every system prompt in a fresh workspace.

The MEMORY.md scan below the main loop (lines 70-80) is unaffected — it's a separate block that looks for `MEMORY.md` / `memory.md` independently.

### Verification

1. Open a fresh workspace with no bootstrap files
2. Send a message → `/context` command
3. Confirm the bootstrap debug report only lists SOUL.md, AGENTS.md, TOOLS.md (plus MEMORY.md from the secondary scan)
4. Confirm NO `[MISSING]` markers for IDENTITY.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md
5. If a user has a legacy IDENTITY.md, it simply won't be loaded — it was never consumed meaningfully anyway

### Risk Assessment

- **Low risk.** These 4 files have no defaults, no scaffolding, no documentation, and no user path to create them. They've only ever produced `[MISSING]` markers.
- The `buildOpenclawBootstrapContext` function iterates over the entries array, so reducing the array has no structural impact.
- No tests reference these specific file names in assertions.

---

## F11-G04: Expand /init to scaffold SOUL.md + TOOLS.md

- **Capability:** C3 — Bootstrap File Scaffolding
- **Status:** MISALIGNED → ALIGNED
- **Severity:** MEDIUM

### Upstream Reference

`ensureAgentWorkspace` in `agents/workspace.ts:155+` creates workspace bootstrap files proactively when binding an agent workspace. The upstream setup path (`agents.commands.bind.ts:648-659`, `gateway/server-methods/agents.ts:663-665`) calls `ensureAgentWorkspace({ dir, ensureBootstrapFiles: !skipBootstrap })`.

Parallx adaptation: `/init` is the user-facing equivalent. It already scaffolds AGENTS.md and `.parallx/` directories. Extend it to also scaffold SOUL.md and TOOLS.md from built-in defaults.

### Parallx Files to Modify

1. **`src/openclaw/openclawDefaultRuntimeSupport.ts`** — `executeOpenclawInitCommand` function

### Change Description

In `executeOpenclawInitCommand`, after the AGENTS.md write and directory creation (around line 235), add scaffolding for SOUL.md and TOOLS.md:

**Before (around lines 229-242):**
```typescript
      await services.writeFile('AGENTS.md', `${generatedContent.trim()}\n`);
      response.markdown('\n\n---\n✅ **AGENTS.md** has been created at the workspace root.');
      for (const dir of ['.parallx', '.parallx/rules', '.parallx/commands', '.parallx/skills']) {
        const exists = await services.exists?.(dir);
        if (!exists) {
          await services.writeFile(`${dir}/.gitkeep`, '');
        }
      }
      response.markdown('\n📁 `.parallx/` directory structure created (rules, commands, skills).');
      services.invalidatePromptFiles?.();
```

**After:**
```typescript
      await services.writeFile('AGENTS.md', `${generatedContent.trim()}\n`);
      response.markdown('\n\n---\n✅ **AGENTS.md** has been created at the workspace root.');
      // Scaffold SOUL.md and TOOLS.md if they don't exist
      for (const bootstrapFile of INIT_BOOTSTRAP_DEFAULTS) {
        const exists = await services.exists?.(bootstrapFile.name);
        if (!exists) {
          await services.writeFile(bootstrapFile.name, bootstrapFile.content);
          response.markdown(`\n✅ **${bootstrapFile.name}** created with defaults.`);
        }
      }
      for (const dir of ['.parallx', '.parallx/rules', '.parallx/commands', '.parallx/skills']) {
        const exists = await services.exists?.(dir);
        if (!exists) {
          await services.writeFile(`${dir}/.gitkeep`, '');
        }
      }
      response.markdown('\n📁 `.parallx/` directory structure created (rules, commands, skills).');
      services.invalidatePromptFiles?.();
```

**Add `INIT_BOOTSTRAP_DEFAULTS` at module scope:**

```typescript
/**
 * Default bootstrap files scaffolded by /init.
 * Content matches src/built-in/chat/defaults/ shipped files.
 *
 * Upstream: ensureAgentWorkspace seeds these on workspace bind.
 */
const INIT_BOOTSTRAP_DEFAULTS = [
  {
    name: 'SOUL.md',
    content: `# Parallx AI Assistant

You are Parallx, a local AI assistant running entirely on the user's machine.
You help the user understand and work with their project files and canvas pages.

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
`,
  },
  {
    name: 'TOOLS.md',
    content: `# Available Tools

## Workspace Skills
- **search_workspace** — Full-text search across all workspace files
- **search_knowledge** — Semantic (RAG) search using embeddings. Covers all indexed content including PDFs, DOCX, XLSX, and other rich documents. Best tool for searching large documents.
- **read_file** — Read file contents (supports text files and rich documents like PDF, DOCX, XLSX)
- **list_files** — List directory contents

## Canvas Skills
- **read_page** — Read a canvas page by ID
- **read_page_by_title** — Find and read a page by title
- **list_pages** — List all canvas pages
- **create_page** — Create a new canvas page (requires approval)
- **get_page_properties** — Get page metadata (icon, cover, dates)
- **read_current_page** — Read the currently open canvas page

## Tool Usage Guidelines
- When context from files is already in the message (via automatic retrieval), use it directly — do not re-read the file
- Use search_knowledge for conceptual questions ("how does auth work?") and for large documents (books, reports)
- Use search_workspace for exact string matches ("where is handleLogin defined?")
- Use read_file for small files or when you need the full content of a specific file
- When editing files, make the smallest change necessary
- Explain what you're changing and why before proposing edits
`,
  },
] as const;
```

### What to Remove

Nothing — this is additive scaffolding. The existing AGENTS.md generation is unchanged.

### Verification

1. Open a fresh workspace with no SOUL.md, TOOLS.md, or AGENTS.md
2. Run `/init`
3. Confirm AGENTS.md is generated (existing behavior)
4. Confirm SOUL.md and TOOLS.md are created with defaults
5. Confirm the response stream mentions all 3 files
6. Run `/init` again on a workspace that already has SOUL.md → confirm it's NOT overwritten
7. Confirm `.parallx/` directories are still created

### Risk Assessment

- **Low risk.** `/init` already writes files — this adds 2 more with the same `exists?` guard.
- Files are never overwritten if they already exist.
- The `invalidatePromptFiles?.()` call at the end already handles cache invalidation.

---

## F11-G05: Fix token status bar to use OpenClaw system prompt report

- **Capability:** C12 — Legacy System Prompt Builders
- **Status:** LEGACY → ALIGNED
- **Severity:** MEDIUM (CRITICAL-5)

### Upstream Reference

OpenClaw has a single system prompt path. There is no separate "estimation" prompt — the report from the actual prompt build is the source of truth. Upstream records full prompt metadata in the run result.

In Parallx, `IOpenclawSystemPromptReport` (defined in `src/services/chatRuntimeTypes.ts:112+`) already captures `systemPrompt.chars`, `systemPrompt.projectContextChars`, and `systemPrompt.nonProjectContextChars`. It's reported via `reportSystemPromptReport` on every turn and stored via `getLastSystemPromptReport`.

### Parallx Files to Modify

1. **`src/built-in/chat/widgets/chatTokenStatusBar.ts`** — replace `buildSystemPrompt` usage with `getLastSystemPromptReport`
2. **`src/built-in/chat/chatTypes.ts`** — add `getLastSystemPromptReport` to `ITokenStatusBarServices`

### Change Description

**Step 1: Add `getLastSystemPromptReport` to `ITokenStatusBarServices`**

In `src/built-in/chat/chatTypes.ts`, extend the interface (around line 493):

**Before:**
```typescript
export interface ITokenStatusBarServices {
  getActiveSession(): IChatSession | undefined;
  getContextLength(): Promise<number>;
  getMode(): ChatMode;
  getWorkspaceName(): string;
  getPageCount(): Promise<number>;
  getCurrentPageTitle(): string | undefined;
  getToolDefinitions(): readonly IToolDefinition[];
  getFileCount(): Promise<number>;
  isRAGAvailable(): boolean;
  isIndexing(): boolean;
  getIndexingProgress?(): import('../../services/indexingPipeline.js').IndexingProgress;
  getIndexStats?(): { pages: number; files: number } | undefined;
  /** M42 Phase 3: Check provider connection health. */
  checkConnectionHealth?(): Promise<{ available: boolean; model?: string; error?: string }>;
}
```

**After:**
```typescript
export interface ITokenStatusBarServices {
  getActiveSession(): IChatSession | undefined;
  getContextLength(): Promise<number>;
  getMode(): ChatMode;
  getWorkspaceName(): string;
  getPageCount(): Promise<number>;
  getCurrentPageTitle(): string | undefined;
  getToolDefinitions(): readonly IToolDefinition[];
  getFileCount(): Promise<number>;
  isRAGAvailable(): boolean;
  isIndexing(): boolean;
  getIndexingProgress?(): import('../../services/indexingPipeline.js').IndexingProgress;
  getIndexStats?(): { pages: number; files: number } | undefined;
  /** M42 Phase 3: Check provider connection health. */
  checkConnectionHealth?(): Promise<{ available: boolean; model?: string; error?: string }>;
  /** F11: Last OpenClaw system prompt report for accurate token estimation. */
  getLastSystemPromptReport?(): IOpenclawSystemPromptReport | undefined;
}
```

(The `IOpenclawSystemPromptReport` import already exists in this file at line 59.)

**Step 2: Replace buildSystemPrompt calls in chatTokenStatusBar.ts**

In `src/built-in/chat/widgets/chatTokenStatusBar.ts`, replace the `_updateEstimates` section that calls `buildSystemPrompt` (around lines 270-315):

**Before:**
```typescript
      // Full system prompt (with tools for Agent mode)
      const fullCtx: ISystemPromptContext = {
        workspaceName: this._services.getWorkspaceName(),
        pageCount,
        currentPageTitle: this._services.getCurrentPageTitle(),
        tools: mode === ChatMode.Agent ? toolDefs : undefined,
        fileCount,
        isRAGAvailable,
        isIndexing,
      };
      const fullSystemPrompt = buildSystemPrompt(mode, fullCtx);

      // Without tools (base instructions only)
      const baseCtx: ISystemPromptContext = {
        workspaceName: this._services.getWorkspaceName(),
        pageCount,
        currentPageTitle: this._services.getCurrentPageTitle(),
        fileCount,
        isRAGAvailable,
        isIndexing,
      };
      const basePrompt = buildSystemPrompt(mode, baseCtx);

      systemInstructionsEst = Math.ceil(basePrompt.length / 4);
      toolDefinitionsEst = Math.ceil((fullSystemPrompt.length - basePrompt.length) / 4);
```

**After:**
```typescript
      // Use the OpenClaw system prompt report if available (accurate),
      // otherwise fall back to legacy estimation (until first turn completes).
      const promptReport = this._services.getLastSystemPromptReport?.();
      if (promptReport) {
        systemInstructionsEst = Math.ceil(promptReport.systemPrompt.nonProjectContextChars / 4);
        toolDefinitionsEst = Math.ceil((promptReport.tools.listChars + promptReport.tools.schemaChars) / 4);
      } else {
        // Fallback: legacy estimation for before first turn
        const fullCtx: ISystemPromptContext = {
          workspaceName: this._services.getWorkspaceName(),
          pageCount,
          currentPageTitle: this._services.getCurrentPageTitle(),
          tools: mode === ChatMode.Agent ? toolDefs : undefined,
          fileCount,
          isRAGAvailable,
          isIndexing,
        };
        const fullSystemPrompt = buildSystemPrompt(mode, fullCtx);

        const baseCtx: ISystemPromptContext = {
          workspaceName: this._services.getWorkspaceName(),
          pageCount,
          currentPageTitle: this._services.getCurrentPageTitle(),
          fileCount,
          isRAGAvailable,
          isIndexing,
        };
        const basePrompt = buildSystemPrompt(mode, baseCtx);

        systemInstructionsEst = Math.ceil(basePrompt.length / 4);
        toolDefinitionsEst = Math.ceil((fullSystemPrompt.length - basePrompt.length) / 4);
      }
```

**Step 3: Wire `getLastSystemPromptReport` in main.ts token status bar construction**

The `ITokenStatusBarServices` is constructed in `main.ts`. The `getLastSystemPromptReport` callback needs to be wired from the services object that already has it. Locate the token status bar construction site and add the property.

### What to Remove

The `buildSystemPrompt` import can be left for now — it's still used in the fallback path before the first turn completes. Full removal happens in Iteration 2 when the legacy prompt builders are deleted.

### Verification

1. Open chat → verify token status bar shows reasonable numbers before first message (legacy fallback)
2. Send a message → token status bar should update to reflect the ACTUAL OpenClaw system prompt size
3. Compare the "system instructions" number with the `/context` report — they should be consistent
4. Verify in Agent mode that tool definition estimates match the actual tool schema size

### Risk Assessment

- **Medium risk.** The token status bar is user-visible, so incorrect numbers would be noticed.
- The fallback path preserves existing behavior before the first turn — users see the same estimates initially.
- After the first turn, the data comes from the real prompt report — strictly more accurate.
- The `getLastSystemPromptReport` is optional (`?.`) so it gracefully degrades.
- The main.ts wiring needs to be verified — the `getLastSystemPromptReport` must be available in the services object passed to the token status bar.

---

## F11-G06: Remove dead runtime selector config

- **Capability:** C16 — Runtime Selector
- **Status:** DEAD → ALIGNED
- **Severity:** LOW

### Upstream Reference

OpenClaw has no runtime selection mechanism — it IS the runtime. There's no `implementation` config toggle because there's only one implementation.

### Parallx Files to Modify

1. **`src/services/chatRuntimeSelector.ts`** — remove `_getConfig` parameter
2. **`src/aiSettings/unifiedConfigTypes.ts`** — remove `'legacy-claw'` from union

### Change Description

**Step 1: Clean up `resolveChatRuntimeParticipantId` signature**

In `src/services/chatRuntimeSelector.ts`:

**Before:**
```typescript
import type { IUnifiedAIConfig } from '../aiSettings/unifiedConfigTypes.js';

export const DEFAULT_CHAT_PARTICIPANT_ID = 'parallx.chat.default';
export const OPENCLAW_DEFAULT_PARTICIPANT_ID = 'parallx.chat.openclaw-default';

/**
 * Resolves the active runtime participant ID. Non-default participants
 * pass through unchanged. The default participant maps to OpenClaw.
 */
export function resolveChatRuntimeParticipantId(
  participantId: string,
  _getConfig?: () => IUnifiedAIConfig | undefined,
): string {
  if (participantId !== DEFAULT_CHAT_PARTICIPANT_ID) {
    return participantId;
  }
  return OPENCLAW_DEFAULT_PARTICIPANT_ID;
}
```

**After:**
```typescript
export const DEFAULT_CHAT_PARTICIPANT_ID = 'parallx.chat.default';
export const OPENCLAW_DEFAULT_PARTICIPANT_ID = 'parallx.chat.openclaw-default';

/**
 * Resolves the active runtime participant ID. Non-default participants
 * pass through unchanged. The default participant maps to OpenClaw.
 */
export function resolveChatRuntimeParticipantId(
  participantId: string,
): string {
  if (participantId !== DEFAULT_CHAT_PARTICIPANT_ID) {
    return participantId;
  }
  return OPENCLAW_DEFAULT_PARTICIPANT_ID;
}
```

**Step 2: Simplify `IUnifiedRuntimeConfig`**

In `src/aiSettings/unifiedConfigTypes.ts`:

**Before:**
```typescript
export interface IUnifiedRuntimeConfig {
  /** Active chat runtime implementation used for the default chat surface. */
  readonly implementation: 'legacy-claw' | 'openclaw';
}
```

**After:**
```typescript
export interface IUnifiedRuntimeConfig {
  /** Active chat runtime implementation used for the default chat surface. */
  readonly implementation: 'openclaw';
}
```

**Step 3: Update all callers of `resolveChatRuntimeParticipantId`**

Callers currently passing the second argument need to be updated to drop it. Search for all call sites:

```
grep -rn "resolveChatRuntimeParticipantId" src/
```

Each call site passing `_getConfig` / a config lambda needs the second argument removed.

### What to Remove

1. The `import type { IUnifiedAIConfig }` from `chatRuntimeSelector.ts` (dead import)
2. The `_getConfig` parameter (dead code)
3. `'legacy-claw'` from the union (dead variant)

### Verification

1. TypeScript compilation — no errors after removing the union variant and parameter
2. Grep for `'legacy-claw'` anywhere in the codebase — confirm it only appeared in:
   - The type union (now removed)
   - Default config objects (should be `'openclaw'` already)
3. All existing tests pass — the function behavior is unchanged

### Risk Assessment

- **Very low risk.** The parameter was accepted but never read. The `'legacy-claw'` variant was never matched against.
- Any call site passing a second argument will get a TypeScript error at compile time — easy to find and fix.
- If any config object has `implementation: 'legacy-claw'` as a default value, it needs to be updated to `'openclaw'`.

---

## Cross-Cutting Considerations

### Dependency Order

These changes are independent and can be implemented in any order. Recommended implementation sequence for safety:

1. **F11-G03** (remove phantom bootstrap files) — smallest, zero-risk
2. **F11-G06** (remove dead runtime selector) — small, zero-risk
3. **F11-G02** (add bootstrap defaults) — depends on G03 (fewer files to default)
4. **F11-G04** (expand /init) — independent
5. **F11-G01** (wire temperature/maxTokens) — independent, highest user impact
6. **F11-G05** (fix token status bar) — most complex, needs verification

### Files Changed (Complete List)

| File | Changes |
|------|---------|
| `src/openclaw/openclawAttempt.ts` | G01: Add temperature/maxTokens to IOpenclawTurnContext + requestOptions |
| `src/openclaw/participants/openclawDefaultParticipant.ts` | G01: Populate temperature/maxTokens from effective config |
| `src/openclaw/participants/openclawParticipantRuntime.ts` | G02: Add OPENCLAW_BOOTSTRAP_DEFAULTS + fallback logic; G03: Trim OPENCLAW_BOOTSTRAP_FILES array |
| `src/openclaw/openclawDefaultRuntimeSupport.ts` | G04: Add INIT_BOOTSTRAP_DEFAULTS + scaffold in /init |
| `src/built-in/chat/widgets/chatTokenStatusBar.ts` | G05: Use prompt report for token estimation |
| `src/built-in/chat/chatTypes.ts` | G05: Add getLastSystemPromptReport to ITokenStatusBarServices |
| `src/services/chatRuntimeSelector.ts` | G06: Remove _getConfig param + dead import |
| `src/aiSettings/unifiedConfigTypes.ts` | G06: Remove 'legacy-claw' from union |

### What is NOT in Iteration 1

| Deferred to Iteration 2 | Reason |
|-------------------------|--------|
| Delete Settings UI dead sections | Need to verify wiring is solid first |
| Delete legacy prompt builders (`chatSystemPrompts.ts`, `systemPromptGenerator.ts`) | 3 live consumers need migration first; G05 partially handles one |
| Remove all 26 dead config fields | Needs careful dependency analysis across all consumers |
| Delete `AISettingsService` class | Safe to delete but low priority |
| Wire retrieval config to context engine | Large scope, needs its own audit |
| Wire verbosity/approvalStrictness/etc. | Need upstream pattern analysis |
