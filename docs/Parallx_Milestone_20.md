# Milestone 20 — Unified AI Configuration Hub

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 20.
> All implementation must conform to the structures and boundaries defined here.
> Milestones 1–19 established the workbench shell, tool system, local AI chat,
> RAG pipeline, session memory, workspace session isolation, AI personality
> settings, and cross-cutting polish. This milestone **unifies all AI
> configuration surfaces** — the AI Settings panel, `.parallx/config.json`,
> tool picker, and preset system — into a single, coherent hub that gives the
> user complete control over how AI works in each workspace.

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Prior Art Research](#prior-art-research)
3. [Vision](#vision)
4. [Architecture](#architecture)
5. [Design Principles](#design-principles)
6. [Phase A — Foundation: Unified Config Model](#phase-a--foundation-unified-config-model)
7. [Phase B — Workspace Overrides & Preset Scoping](#phase-b--workspace-overrides--preset-scoping)
8. [Phase C — UI Consolidation](#phase-c--ui-consolidation)
9. [Phase D — Save Feedback & User Communication](#phase-d--save-feedback--user-communication)
10. [Phase E — Tool Configuration Integration](#phase-e--tool-configuration-integration)
11. [Phase F — Memory Management](#phase-f--memory-management)
12. [Migration & Backward Compatibility](#migration--backward-compatibility)
13. [Task Tracker](#task-tracker)
14. [Verification Checklist](#verification-checklist)
15. [Risk Register](#risk-register)

---

## Problem Statement

### What the user experiences today

Parallx has **four disconnected configuration surfaces** for AI behavior:

1. **AI Settings panel** (M15) — Global presets controlling personality, tone,
   temperature, response style, system prompt, suggestions, and default model. Auto-saves
   silently with no confirmation. Supports named presets but they are global-only.

2. **`.parallx/config.json`** (M11) — Per-workspace JSON file for RAG behavior
   (`ragTopK`, `ragScoreThreshold`, `autoRag`), token budgets, permissions,
   indexing, model names, and iteration limits. **Loaded but not wired** — changing
   these values has zero effect on runtime behavior.

3. **Tool Picker** (M11) — A modal dialog triggered from a wrench icon in chat
   input. Allows enabling/disabling individual tools for agent mode. Disconnected
   from both settings surfaces above.

4. **Hardcoded constants** — The actual values controlling RAG behavior, token
   budgets, and iteration limits are scattered across `retrievalService.ts`,
   `vectorStoreService.ts`, `defaultParticipant.ts`, and `tokenBudgetManager.ts`
   as `const` declarations. No configuration system reads them.

### The result

- A user who edits `.parallx/config.json` per the docs sees **no effect**.
- A user who creates an AI Settings preset and switches workspaces has **no way
  to use different presets per workspace**.
- A user who changes a setting gets **no visual feedback** that it saved.
- A user must navigate to **two different places** (AI Settings panel + chat
  toolbar wrench icon) to configure the AI for their workspace.
- The model selection in AI Settings (`defaultModel`) and config.json
  (`model.chat`) **conflict** with no reconciliation.
- There is **no way** for the user to view, manage, or clear session memories.

### What this milestone fixes

One **AI Configuration Hub** — a unified panel with clear sections, immediate
visual feedback, workspace-scoped presets, and wired-through values that
actually control runtime behavior.

---

## Prior Art Research

### Continue (IDE extension)

- **Two-tier config**: Global `~/.continue/config.yaml` + workspace `.continuerc.json`
- **Merge behavior**: Workspace config specifies `mergeBehavior: "merge" | "overwrite"`
  to overlay on global config — explicit precedence
- **Agent selector**: Dropdown above chat input to switch agents/configs
- **Key insight**: Workspace-level config is a sparse patch on top of global defaults,
  not a full copy. This keeps workspace overrides small and forward-compatible.

### GitHub Copilot

- **Scoped policies**: Global settings at account level, per-organization overrides,
  per-repository opt-in/out for specific features (coding agent, public code matching)
- **Feature toggles**: Simple enable/disable for capabilities with clear scope labels
  ("all repositories" / "selected repositories" / "no repositories")
- **Key insight**: Settings UI communicates scope clearly at every toggle — the user
  always knows what level they're configuring.

### JetBrains AI Assistant

- **IDE settings integration**: AI config lives in the standard IDE Settings dialog,
  same as editor/project settings. Not a separate panel.
- **Model selection per role**: Different models for chat, completion, commit messages
- **Key insight**: AI settings feel like a natural part of the app settings, not a
  bolted-on panel. Context management (adding files/folders/symbols) is inline.

### Cursor

- **Rules for AI**: Project-level `.cursorrules` file + global rules — similar to
  Continue's two-tier config. Rules are prompt directives, not structured config.
- **Model picker**: Dropdown in the primary UI, not buried in settings
- **Key insight**: The most-changed setting (model) is accessible without opening
  settings at all. Deep settings are in a separate panel.

### LM Studio / Jan AI (from M15 research)

- **Named presets**: Full bundles of system prompt + temperature + params, switchable
  with one click
- **Friendly labels**: "Personality settings and performance controls" framing
- **Per-model config**: Different defaults per model, not just one global set
- **Key insight**: Presets are the primary interaction model — users think in
  "personas", not individual parameters.

### Synthesis

| Pattern | Who does it | Adoption for Parallx |
|---------|-------------|---------------------|
| **Two-tier config (global + workspace)** | Continue, Cursor, Copilot | ✅ Global presets + per-workspace override |
| **Sparse workspace overlay** | Continue (`.continuerc.json`) | ✅ Workspace stores only differences from active preset |
| **Scope labels on every control** | Copilot | ✅ "Global" / "This workspace" badge per section |
| **Model picker in primary UI** | Cursor, JetBrains | ✅ Keep status bar model indicator, add to hub |
| **Preset-first interaction** | LM Studio, Jan, M15 | ✅ Presets are the main entry point |
| **Save confirmation** | Standard UX practice | ✅ Toast/inline feedback on every save |
| **Integrated settings (not separate app)** | JetBrains | ✅ AI Hub is a sidebar panel, same as today |

---

## Vision

### Before M20

> You open AI Settings and see persona, chat, model, and suggestion controls.
> You create a "Research Mode" preset with high temperature and detailed tone.
> You switch to another workspace — same preset applies. You edit
> `.parallx/config.json` to set `ragTopK: 3` — nothing changes. You click the
> wrench icon in chat to disable a tool, but wonder why it's not in the settings
> panel. You're not sure if your settings saved. You can't view or clear the
> memories the AI has built about your conversations.

### After M20

> You open the **AI Hub** — a unified panel in the sidebar. At the top, your
> active preset ("Research Mode") with a dropdown to switch. Below, tabbed
> sections: **Behavior** (persona, tone, response style), **Retrieval** (RAG
> topK, score threshold, auto-RAG toggle, context budgets), **Model** (chat
> model, temperature, max tokens, embedding model), **Tools** (the full tool
> picker, inline — no popup), and **Memory** (view stored memories, clear all,
> toggle memory on/off).
>
> A small badge on each section says "Global" or "Workspace" — you can override
> any setting for this workspace by clicking a per-field override toggle. Changes
> auto-save with a brief "Saved" toast. When you switch workspaces, the hub
> shows the merged result: your global preset with workspace overrides applied.
>
> The `.parallx/config.json` file still works as a power-user escape hatch and
> is read at startup. If it exists, its values are imported into the workspace
> override layer the first time and the user is notified.

---

## Architecture

### Config Resolution Order (lowest → highest priority)

```
Built-in defaults (hardcoded)
    ↓
Active global preset (AI Settings profile)
    ↓
Workspace override (per-workspace sparse patch, stored in .parallx/ai-config.json)
    ↓
.parallx/config.json (legacy, imported once → workspace override)
```

### Unified Config Shape

The unified config model merges all settings from both systems:

```typescript
interface IUnifiedAIConfig {
  // ── Behavior (from M15 AI Settings) ──
  persona: {
    name: string;
    description: string;
    avatarEmoji: string;
  };
  chat: {
    systemPrompt: string;
    systemPromptIsCustom: boolean;
    responseLength: 'short' | 'medium' | 'long' | 'adaptive';
    tone: 'concise' | 'balanced' | 'detailed';
    focusDomain: 'general' | 'finance' | 'writing' | 'coding' | 'research' | 'custom';
    customFocusDescription: string;
  };

  // ── Model (merged from M15 + config.json) ──
  model: {
    chatModel: string;        // was: M15 defaultModel + config.json model.chat
    embeddingModel: string;   // was: config.json model.embedding
    temperature: number;      // was: M15 model.temperature
    maxTokens: number;        // was: M15 model.maxTokens
    contextWindow: number;    // was: M15 model.contextWindow + config.json model.contextLength
  };

  // ── Retrieval (from config.json — NEW to UI) ──
  retrieval: {
    autoRag: boolean;
    ragTopK: number;
    ragScoreThreshold: number;
    contextBudget: {
      systemPrompt: number;   // percentage
      ragContext: number;
      history: number;
      userMessage: number;
    };
  };

  // ── Suggestions (from M15) ──
  suggestions: {
    suggestionsEnabled: boolean;
    suggestionConfidenceThreshold: number;
    maxPendingSuggestions: number;
  };

  // ── Agent (from config.json — NEW to UI) ──
  agent: {
    maxIterations: number;
  };

  // ── Memory (NEW) ──
  memory: {
    memoryEnabled: boolean;
    autoSummarize: boolean;
    evictionDays: number;
  };

  // ── Indexing (from config.json — NEW to UI) ──
  indexing: {
    autoIndex: boolean;
    watchFiles: boolean;
    maxFileSize: number;
    excludePatterns: string[];
  };
}
```

### Storage

| Scope | Location | Format |
|-------|----------|--------|
| Global presets | `IStorage` (existing key `ai-settings.profiles`) | JSON array of full `IUnifiedAIConfig` + metadata |
| Active preset ID | `IStorage` (existing key `ai-settings.activeProfileId`) | string |
| Workspace override | `.parallx/ai-config.json` in workspace root | Sparse partial `IUnifiedAIConfig` (only overridden fields) |
| Legacy import | `.parallx/config.json` (read-only, one-time import) | Original M11 format |

### Service Architecture

```
┌─────────────────────────────┐
│   UnifiedAIConfigService    │  ← replaces AISettingsService + ParallxConfigService
│                             │
│  getEffectiveConfig()       │  ← merged result: preset + workspace override
│  getGlobalPreset()          │
│  getWorkspaceOverride()     │
│  updateGlobalPreset(patch)  │
│  updateWorkspaceOverride(patch) │
│  onDidChange: Event         │
└──────────┬──────────────────┘
           │ consumed by
    ┌──────┴──────────────────────────────────┐
    │                                         │
    ▼                                         ▼
RetrievalService          DefaultParticipant
  reads: ragTopK,           reads: maxIterations,
  ragScoreThreshold,        temperature, systemPrompt
  autoRag
    │                                         │
    ▼                                         ▼
VectorStoreService        TokenBudgetManager
  reads: (unchanged,         reads: contextBudget.*
  uses retrieval topK)
```

---

## Design Principles

1. **One place for everything.** If a user needs to configure AI behavior, the AI
   Hub is the only destination. No hunting across menus, popups, or config files.

2. **Scope is always visible.** Every field shows whether it's set at the global
   preset level or overridden for this workspace. A small "↩ Reset to global"
   icon appears next to workspace-overridden values.

3. **Changes are acknowledged.** A brief inline "✓ Saved" indicator appears on
   each field change. A toast notification fires on significant actions (preset
   switch, workspace override reset, memory clear).

4. **Presets are the big lever.** Switching presets changes many settings at once.
   The preset switcher is prominent — top of the panel, plus the existing status
   bar indicator.

5. **Workspace overrides are small adjustments.** They are sparse patches, not
   full copies. The UI shows the effective (merged) value with a visual indicator
   when it differs from the global preset.

6. **Power users still have files.** `.parallx/config.json` is still read. On
   first detection, values are imported into the workspace override layer and the
   user is notified. Subsequent edits to the file are watched and re-imported.

7. **Tools belong in the hub.** The tool picker is a section in the AI Hub, not
   a floating modal. It uses the same visual language as other sections.

---

## Phase A — Foundation: Unified Config Model

> Replace `AISettingsService` + `ParallxConfigService` with a single
> `UnifiedAIConfigService` that owns the merged config resolution.

### Task A.1 — Define `IUnifiedAIConfig` type (1h)
- New file: `src/aiSettings/unifiedConfigTypes.ts`
- Full interface as described above
- Migration helpers: `fromLegacyProfile()` and `fromLegacyParallxConfig()`
- Default values constant: `DEFAULT_UNIFIED_CONFIG`

### Task A.2 — Implement `UnifiedAIConfigService` (4h)
- Extends `Disposable`, implements new `IUnifiedAIConfigService` interface
- Constructor: `(storage: IStorage, workspaceRoot?: string)`
- Loads global presets from `IStorage` (migrate from old `AISettingsProfile` format)
- Loads workspace override from `.parallx/ai-config.json` if present
- `getEffectiveConfig()`: deep-merge active preset + workspace override
- `updateGlobalPreset(patch)`: updates active preset, persists, fires event
- `updateWorkspaceOverride(patch)`: updates override, writes file, fires event
- `clearWorkspaceOverride(key?)`: clears one or all overrides
- `onDidChange: Event<IUnifiedAIConfig>` fires effective config on any change
- All existing preset operations preserved: create, delete, rename, switch, clone-on-write
- Register as `IUnifiedAIConfigService` via `createServiceIdentifier` in `serviceTypes.ts`

### Task A.3 — Legacy import from `.parallx/config.json` (2h)
- On first load, if `.parallx/config.json` exists AND no workspace override exists:
  - Parse it, convert to `IUnifiedAIConfig` partial (the workspace override shape)
  - Write to `.parallx/ai-config.json` as the workspace override
  - Show notification: "Imported workspace AI settings from .parallx/config.json"
- Optional: watch `.parallx/config.json` for changes, re-import on change

### Task A.4 — Wire consumers to `UnifiedAIConfigService` (3h)
- `RetrievalService`: read `retrieval.ragTopK`, `retrieval.ragScoreThreshold` from
  effective config instead of hardcoded `DEFAULT_TOP_K`, `DEFAULT_MIN_SCORE`
- `DefaultParticipant`: read `agent.maxIterations` instead of `DEFAULT_MAX_ITERATIONS`
- `TokenBudgetManager`: read `retrieval.contextBudget.*` (if not already wired)
- `ProactiveSuggestionsService`: already reads from AI settings → no change needed
- `VectorStoreService`: no direct change (receives topK from callers)
- Subscribe to `onDidChange` to pick up live updates

### Task A.5 — Retire `ParallxConfigService` usage (1h)
- Remove instantiation in `chat/main.ts`
- Keep the file for backward compatibility (other tools may import types)
- Mark as deprecated with JSDoc

### Task A.6 — Update `AISettingsService` to delegate (2h)
- Option 1: `AISettingsService` becomes a thin facade over `UnifiedAIConfigService`
- Option 2: Replace all imports of `IAISettingsService` with `IUnifiedAIConfigService`
- Existing consumers (`ProactiveSuggestionsService`, `systemPromptGenerator`, etc.)
  should work through the unified service
- Preserve backward compatibility for the `onDidChange` event shape

---

## Phase B — Workspace Overrides & Preset Scoping

> Give the user the ability to use different presets and overrides per workspace.

### Task B.1 — Workspace override persistence (2h)
- Read/write `.parallx/ai-config.json` through `IFileService` + workspace root
- File format: `{ _presetId?: string, overrides: Partial<IUnifiedAIConfig> }`
- `_presetId` pins a specific global preset for this workspace (optional — if
  absent, uses the globally active preset)
- File watcher for external edits (optional, can defer)

### Task B.2 — Per-workspace preset selection (1h)
- `setWorkspacePreset(presetId)`: writes `_presetId` to workspace override file
- `clearWorkspacePreset()`: removes pinning, falls back to global active preset
- Status bar indicator updates: "AI: Research Mode (workspace)" vs "AI: Default"

### Task B.3 — Override resolution logic (2h)
- Deep merge: `defaultConfig ← activePreset ← workspaceOverride`
- Only non-undefined keys from override are applied
- `isOverridden(path: string): boolean` — for UI to show override indicator
- `getOverriddenKeys(): string[]` — list all workspace-overridden paths

---

## Phase C — UI Consolidation

> Redesign the AI Settings panel into the AI Hub with new sections.

### Task C.1 — Rename and restructure panel sections (3h)
- Rename panel title: "AI Settings" → "AI Hub" (or "AI Configuration")
- Restructure sections into tabs or collapsible groups:
  - **Behavior**: Persona + Chat sections merged (name, description, avatar, tone,
    response length, focus domain, system prompt)
  - **Retrieval**: NEW section — auto-RAG toggle, ragTopK slider (1–30), score
    threshold slider (0–1), context budget allocation (4 sliders summing to 100%)
  - **Model**: Existing model section + embedding model dropdown
  - **Suggestions**: Existing suggestions section (no change)
  - **Tools**: Tool picker moved inline (Phase E)
  - **Memory**: NEW section (Phase F)
  - **Advanced**: Export/Import, Reset All, Raw JSON editor toggle

### Task C.2 — Scope indicator per field (2h)
- Each setting row gets a visual indicator: "Global" (default) or "Workspace ↩"
- Clicking "Workspace ↩" resets that field to the global preset value
- A toggle to "Override for this workspace" sets the field in workspace override
- Implementation: extend `_createRow()` in `sectionBase.ts`

### Task C.3 — Retrieval section UI (3h)
- New file: `src/aiSettings/ui/sections/retrievalSection.ts`
- Controls:
  - Auto-RAG toggle (Toggle widget)
  - RAG Top K (Slider: 1–30, default from effective config)
  - Score Threshold (Slider: 0.0–1.0, step 0.05)
  - Context Budget: 4 sliders (System / RAG / History / User) with a visual bar
    showing allocation. Sliders are linked — adjusting one redistributes others.
- Each control reads/writes through `UnifiedAIConfigService`

### Task C.4 — Agent section or inline controls (1h)
- `maxIterations` control (InputBox, 1–50) — can live in Advanced or Behavior
- Consider: expose `autoRag` and `maxIterations` as a small "Agent Behavior"
  subsection within Behavior or as part of Retrieval

### Task C.5 — Indexing section UI (2h)
- New file: `src/aiSettings/ui/sections/indexingSection.ts`
- Controls:
  - Auto-index toggle
  - Watch files toggle
  - Max file size (InputBox, bytes or human-readable "256 KB")
  - Exclude patterns (multi-line Textarea, glob patterns)
- May be in Advanced section rather than top-level, depending on UX judgment

---

## Phase D — Save Feedback & User Communication

> Ensure the user always knows what happened.

### Task D.1 — Inline save indicators (2h)
- After any field change: show a brief "✓ Saved" label next to the control
  (fade in, hold 1.5s, fade out)
- Implementation: utility function `showSaveIndicator(element: HTMLElement)`
- Applied universally in `sectionBase.ts`'s `_onFieldChange()` handler

### Task D.2 — Toast notifications for significant actions (1h)
- Preset switched → toast: "Switched to preset: Research Mode"
- Workspace override created → toast: "Workspace override saved"
- Workspace override cleared → toast: "Reset to global preset"
- Memory cleared → toast: "All session memories cleared"
- Imported from config.json → toast: "Imported AI settings from .parallx/config.json"
- Use existing `INotificationService`

### Task D.3 — Clone-on-write notification (1h)
- When editing a built-in preset triggers clone-on-write, show a toast:
  "Built-in preset 'Default' is read-only. Created editable copy: 'Default (Modified)'"
- Currently this happens silently — user may not realize they're on a new preset

### Task D.4 — Status bar enhancements (1h)
- Show preset name + workspace indicator: "AI: Research Mode" or "AI: Research Mode ⚙" (if workspace override active)
- Tooltip: "Click to open AI Hub. Active preset: Research Mode. Workspace overrides: 3 fields."

---

## Phase E — Tool Configuration Integration

> Move the tool picker from a floating modal into the AI Hub.

### Task E.1 — Tool section in AI Hub (3h)
- New section: "Tools" in the AI Hub panel
- Render the tool tree inline (same checkbox-tree UX as current picker, but
  embedded in the panel instead of a modal overlay)
- Search/filter input within the section
- "N tools enabled" summary at the section header
- Uses same `IToolPickerServices` interface — no backend changes

### Task E.2 — Deprecate modal tool picker (1h)
- Remove or redirect the wrench icon in chat toolbar → opens AI Hub scrolled to
  Tools section
- Keep the `chatToolPicker.ts` file but mark as deprecated
- The wrench icon can become a shortcut: "⚙ Configure AI" → opens hub

### Task E.3 — Per-workspace tool overrides (2h, optional)
- Store tool enable/disable state in workspace override
- Allows different tool sets per workspace (e.g., disable `write_file` in a
  read-only reference workspace)

---

## Phase F — Memory Management

> Give the user visibility and control over session memories.

### Task F.1 — Memory section in AI Hub (3h)
- New file: `src/aiSettings/ui/sections/memorySection.ts`
- **Summary stats**: "12 session memories, 8 concepts, 3 preferences"
- **Memory toggle**: Enable/disable automatic memory creation
- **Memory list**: Scrollable list of stored memories showing:
  - Session date
  - Summary text (truncated, expandable)
  - Decay score (visual bar or percentage)
  - Delete button per memory
- **Concept list**: Similar list for learning concepts
- **Preferences list**: Key-value pairs with delete buttons
- **Clear All button**: Danger-styled, with inline confirmation

### Task F.2 — Wire `clearAll()` and per-item deletion (2h)
- "Clear All" button calls `IMemoryService.clearAll()` (already fixed in this session)
- Per-memory delete calls `IMemoryService` with new `deleteMemory(sessionId)` method
- Per-concept delete calls new `deleteConcept(conceptId)` method
- Per-preference delete calls existing `deletePreference(key)` method

### Task F.3 — Memory creation toggle (1h)
- New config field: `memory.memoryEnabled` (default: true)
- When false: `defaultParticipant.ts` skips the post-response summarization step
- Reads from `UnifiedAIConfigService.getEffectiveConfig().memory.memoryEnabled`

---

## Migration & Backward Compatibility

### Profile migration (A.2)
- On first load with new service, detect old-format profiles in `IStorage`
- Convert each `AISettingsProfile` → `IUnifiedAIConfig` preset
- Preserve IDs, names, built-in flags
- One-time migration, silent

### Config.json migration (A.3)
- `.parallx/config.json` values imported into workspace override layer
- Original file is NOT deleted or modified
- Notification informs the user
- If both `.parallx/ai-config.json` (new) and `.parallx/config.json` (old) exist,
  the new format takes precedence. A warning is logged.

### API compatibility (A.6)
- `IAISettingsService` remains as a facade or type alias during transition
- Consumers that import `IAISettingsService.getActiveProfile()` continue to work
- Gradual migration over multiple commits

---

## Task Tracker

| ID | Task | Est. | Depends | Status |
|----|------|------|---------|--------|
| **A.1** | Define `IUnifiedAIConfig` type | 1h | — | ⬜ |
| **A.2** | Implement `UnifiedAIConfigService` | 4h | A.1 | ⬜ |
| **A.3** | Legacy import from config.json | 2h | A.2 | ⬜ |
| **A.4** | Wire consumers to unified service | 3h | A.2 | ⬜ |
| **A.5** | Retire `ParallxConfigService` usage | 1h | A.4 | ⬜ |
| **A.6** | Update `AISettingsService` delegation | 2h | A.2 | ⬜ |
| **B.1** | Workspace override persistence | 2h | A.2 | ⬜ |
| **B.2** | Per-workspace preset selection | 1h | B.1 | ⬜ |
| **B.3** | Override resolution logic | 2h | B.1 | ⬜ |
| **C.1** | Rename and restructure panel sections | 3h | A.6 | ⬜ |
| **C.2** | Scope indicator per field | 2h | B.3, C.1 | ⬜ |
| **C.3** | Retrieval section UI | 3h | C.1, A.4 | ⬜ |
| **C.4** | Agent controls | 1h | C.1, A.4 | ⬜ |
| **C.5** | Indexing section UI | 2h | C.1, A.4 | ⬜ |
| **D.1** | Inline save indicators | 2h | C.1 | ⬜ |
| **D.2** | Toast notifications | 1h | A.2 | ⬜ |
| **D.3** | Clone-on-write notification | 1h | D.2 | ⬜ |
| **D.4** | Status bar enhancements | 1h | B.2 | ⬜ |
| **E.1** | Tool section in AI Hub | 3h | C.1 | ⬜ |
| **E.2** | Deprecate modal tool picker | 1h | E.1 | ⬜ |
| **E.3** | Per-workspace tool overrides | 2h | E.1, B.1 | ⬜ |
| **F.1** | Memory section in AI Hub | 3h | C.1 | ⬜ |
| **F.2** | Wire clearAll and per-item deletion | 2h | F.1 | ⬜ |
| **F.3** | Memory creation toggle | 1h | F.2, A.4 | ⬜ |

**Total estimated: ~44 hours across 23 tasks**

---

## Verification Checklist

### Phase A
- [ ] `UnifiedAIConfigService` loads old profiles and converts them
- [ ] `getEffectiveConfig()` returns merged preset + workspace override
- [ ] Changing `ragTopK` in UI → `RetrievalService` uses new value on next query
- [ ] Changing `maxIterations` → `DefaultParticipant` uses new value on next chat
- [ ] `.parallx/config.json` is imported on first detection
- [ ] All existing AI Settings tests still pass

### Phase B
- [ ] Switching presets per-workspace persists to `.parallx/ai-config.json`
- [ ] Opening a different workspace shows its own preset/overrides
- [ ] `isOverridden(path)` correctly identifies workspace-level changes

### Phase C
- [ ] AI Hub shows all sections: Behavior, Retrieval, Model, Suggestions, Tools, Memory, Advanced
- [ ] Retrieval section sliders control `ragTopK` and `ragScoreThreshold`
- [ ] Context budget sliders sum to 100%
- [ ] Scope indicators show "Global" vs "Workspace" correctly

### Phase D
- [ ] "✓ Saved" indicator appears after every field change
- [ ] Toast fires on preset switch, override clear, memory clear
- [ ] Clone-on-write shows explanatory toast
- [ ] Status bar shows workspace override indicator

### Phase E
- [ ] Tool picker is rendered inline in AI Hub
- [ ] Wrench icon in chat opens AI Hub tools section
- [ ] Tool enable/disable persists per-workspace (if E.3 completed)

### Phase F
- [ ] Memory section shows count of memories, concepts, preferences
- [ ] Individual memories can be deleted
- [ ] "Clear All" works with confirmation
- [ ] Memory toggle prevents new memory creation when disabled

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Profile migration corrupts existing presets | High | Backup old storage before migration. Validate converted profiles against schema. One-time migration with version flag. |
| Workspace override file grows unbounded | Low | Override is sparse — only changed fields. Typical size < 1KB. |
| Two config files in `.parallx/` confuse users | Medium | Notification on import. Documentation. Eventually deprecate `config.json` in favor of `ai-config.json`. |
| Panel becomes overwhelming with too many sections | Medium | Collapsible sections with smart defaults hidden. Most users interact only with preset switcher and a few toggles. |
| Breaking change for `IAISettingsService` consumers | Medium | Facade pattern — old interface wraps new service. Gradual migration. |
| Tool picker loses discoverability when moved from chat | Low | Keep a shortcut icon in chat toolbar that opens hub's tool section. Status bar shows tool count. |
| Context budget sliders UX (linked sliders are hard) | Medium | Research VS Code's approach to percentage allocation. Consider alternative: preset allocation templates (Balanced / RAG-Heavy / History-Heavy) with manual override. |
