# Milestone 42 — Surface, Adapt, Discover: Making Parallx Usable for Everyone

**Status:** Planning  
**Branch:** `m42-surface-adapt-discover`  
**Depends on:** Milestone 41 (commit `7e0c498` on `m41-openclaw-rebuild-plan`)  
**Gate before start:** 0 compile errors, 152 test files, 2,446 tests pass

---

## Motivation

Milestone 41 rebuilt the engine — execution pipeline, context engine, skill
system, system prompt builder, tool policy, error recovery. The engine is
production-grade.

The gap is the **surface**. The system has capabilities that users cannot find.
A holistic gap analysis (2026-03-26) identified 15 gaps across power, stability,
user-friendliness, dynamism, and breadth. This milestone closes all 15.

### Design Principle

> **The best feature is one users discover without reading documentation.**

OpenClaw works for users from all backgrounds because it auto-configures, shows
what it can do, and adapts to the user's environment. Parallx must match that:
open it, and it works — for everyone.

---

## Table of Contents

1. [Gap Inventory](#1-gap-inventory)
2. [Phase Plan](#2-phase-plan)
3. [Phase 1 — Discoverability Surface](#3-phase-1--discoverability-surface)
4. [Phase 2 — Adaptive Model Intelligence](#4-phase-2--adaptive-model-intelligence)
5. [Phase 3 — Status Transparency](#5-phase-3--status-transparency)
6. [Phase 4 — In-App Help System](#6-phase-4--in-app-help-system)
7. [Phase 5 — Agent Autonomy UX](#7-phase-5--agent-autonomy-ux)
8. [Phase 6 — Resilience Hardening](#8-phase-6--resilience-hardening)
9. [Phase 7 — Polish & Consistency](#9-phase-7--polish--consistency)
10. [Verification Plan](#10-verification-plan)

---

## 1. Gap Inventory

All 15 gaps from the holistic analysis, categorized by severity and grouped by
implementation dependency.

### Critical (blocks non-technical users)

| ID | Gap | Current State | Target |
|----|-----|---------------|--------|
| B1 | No guided onboarding | Static welcome page, no AI guidance | Welcome page with AI Quick Start section, link to User Guide |
| B2 | Chat empty state doesn't teach enough | 6 hints (modes only) | Add /init, /explain, /search hints + plain-English descriptions |
| B3 | No in-app help system | Zero tooltips or contextual help | Field-level help in Settings, mode descriptions in picker |
| B4 | Indexing/status transparency | No visibility into indexing, connection, tool execution | Status bar badges for indexing + connection health |
| B5 | No model capability detection or fallback | One-size-fits-all prompts, no auto-detect | Probe /api/show on model switch, auto-set context window, per-model profiles |

### Moderate (limits power users and adaptability)

| ID | Gap | Current State | Target |
|----|-----|---------------|--------|
| C6 | Limited tool breadth | 20 tools, no web/git/PDF | Add git, fetch-webpage, PDF-extract tools via SKILL.md |
| C7 | Agent mode safe but passive | Approval gates not explained in UI | Autonomy level selector with plain-English descriptions |
| C8 | No slash command discovery | Dropdown exists but not surfaced from hints | Wire /init hint, improve empty state copy |

### Minor (polish)

| ID | Gap | Current State | Target |
|----|-----|---------------|--------|
| D1 | Settings: no workspace vs global scope indicator | No visual distinction | Badge on workspace-overridden settings |
| D2 | No settings change confirmation | Silent persistence | Toast notification on save |
| D3 | `.parallx/` structure invisible | Users can't see workspace config | Tree view or explorer entry |
| D4 | No skill dependency chaining | Skills are isolated | Documented limitation (future milestone) |
| D5 | Fixed 2.5s retry backoff | No exponential growth | Exponential backoff with cap |
| D6 | No re-ranking in RAG | Top-20 by RRF only | Documented limitation (future milestone) |
| D7 | Ask mode hidden but selectable | UI inconsistency | Restore in picker with clear description |

---

## 2. Phase Plan

Phases are ordered by user impact and implementation dependency. Each phase is
independently committable and verifiable.

| Phase | Name | Gaps Closed | Estimated Changes |
|-------|------|-------------|-------------------|
| 1 | Discoverability Surface | B1, B2, C8 | welcome/main.ts, chatWidget.ts |
| 2 | Adaptive Model Intelligence | B5 | ollamaProvider.ts, languageModelsService.ts, openclawSystemPrompt.ts |
| 3 | Status Transparency | B4 | chatTokenStatusBar.ts, chatWidget.ts |
| 4 | In-App Help System | B3, D1, D2 | aiSettingsPanel.ts + section files, chatModePicker.ts |
| 5 | Agent Autonomy UX | C7, D7 | chatModePicker.ts, agent config types |
| 6 | Resilience Hardening | D5, C6 | openclawTurnRunner.ts, new skill manifests |
| 7 | Polish & Consistency | D3, D4, D6 | Documentation + minor UI |

---

## 3. Phase 1 — Discoverability Surface

**Gaps closed:** B1 (no guided onboarding), B2 (empty state too sparse), C8 (slash command discovery)

### 3.1 Welcome Page — AI Quick Start Section

**File:** `src/built-in/welcome/main.ts`

**Current state:** Two columns — Start (New/Open/Folder), Help (CommandPalette/Settings/Keybindings), Recent.

**Changes:**
Add a third section "AI Quick Start" to the left column after Help:

| Item | Icon | Label | Action |
|------|------|-------|--------|
| 1 | sparkle | Open AI Chat | `workbench.action.chat.open` |
| 2 | wand | Set Up Workspace AI | Inserts `/init` into chat input and opens chat |
| 3 | book | AI User Guide | Opens `docs/ai/AI_USER_GUIDE.md` in editor |

**Implementation:**
- New `aiItems` array after `helpItems` (line ~170)
- New section title "AI Quick Start" with `welcome-section-title` class
- Each item uses existing `_createActionRow()` pattern
- Item 2 chains: `chat.open` → `chat.insertText('/init ')` via sequential command execution

**Success criteria:**
- Welcome page shows 3 AI quick start items
- "Set Up Workspace AI" opens chat with `/init` pre-filled
- "AI User Guide" opens the guide in the editor

### 3.2 Chat Empty State — Expanded Hints

**File:** `src/built-in/chat/widgets/chatWidget.ts` (method `_buildEmptyState`, lines 1003-1057)

**Current hints (6):** Ask mode, Edit mode, Agent mode, @workspace, @canvas, Ctrl+L

**New hints to add:**

| Hint | Icon | Label | Description | Insert |
|------|------|-------|-------------|--------|
| /init | wand | Set up workspace | Generate project context for better answers | /init |
| /explain | lightbulb | Explain something | Get a clear explanation of any concept | /explain |
| /search | search | Search workspace | Find information across all your files | @workspace |

**Changes:**
- Replace terse descriptions with plain English:
  - "Awake by default; read-first answers" → "Get answers grounded in your workspace"
  - "AI-assisted canvas editing" → "AI proposes edits for you to review"
  - "Action tools with approval gates" → "AI takes multi-step actions with your OK"
- Add divider between mode hints and action hints
- Add the 3 new hint items above

**Success criteria:**
- 9 hints visible in empty state
- Descriptions understandable by non-technical users
- Clicking /init hint inserts `/init ` into input

### 3.3 Slash Command — Empty State Integration

Already handled by 3.2 — the `/init` hint card in the empty state surfaces
the most important first command.

### Verification

```
npx tsc --noEmit
npx vitest run
```
Visual: Welcome page shows AI section. Chat empty state shows 9 hints.

---

## 4. Phase 2 — Adaptive Model Intelligence

**Gaps closed:** B5 (no model capability detection or fallback)

### 4.1 Model Probing on Selection

**File:** `src/built-in/chat/providers/ollamaProvider.ts`

**Current state:** `getModelInfo()` (line 328) already calls `/api/show` and
extracts context length, capabilities (tools, vision, thinking).

**What's missing:** This data isn't used to adapt behavior. The extracted
`contextLength` enriches `ILanguageModelInfo` but the system prompt and tool
policy don't react to capabilities.

**Changes:**

1. **Auto-set context window on model switch** — When `languageModelsService`
   sets a new active model, call `getModelInfo()` and store the detected
   `contextLength` as the effective context window (replacing the hardcoded
   AI Settings value unless user explicitly overrides it).
   
   **File:** `src/services/languageModelsService.ts`
   - Add `_modelContextLengths: Map<string, number>` cache
   - On model switch, if provider supports `getModelInfo`, fetch and cache
   - Add `getActiveModelContextLength(): number` that checks cache → settings → default (4096)

2. **Capability-aware tool filtering** — If model doesn't support tool use,
   disable tool calling and add a system prompt note instructing it to produce
   structured output instead.

   **File:** `src/openclaw/openclawToolPolicy.ts`
   - Add `modelCapabilities?: { tools: boolean; vision: boolean; thinking: boolean }` 
     to `IOpenclawToolPolicyParams`
   - If `tools === false`, return empty tool array (no tool calling)

3. **Per-model-tier prompt guidance** — Small models (≤8B parameters) get
   additional behavioral guidance in the system prompt.

   **File:** `src/openclaw/openclawSystemPrompt.ts`
   - Add optional `modelTier: 'small' | 'medium' | 'large'` param
   - If `small`: inject concise-response, step-by-step reasoning instructions
   - Tier derived from parameter count (already in `ILanguageModelInfo.parameterSize`)

### Verification

```
npx tsc --noEmit
npx vitest run
```
Behavioral: Switch to a 7B model → verify system prompt includes small-model guidance.

---

## 5. Phase 3 — Status Transparency

**Gaps closed:** B4 (no indexing/connection/tool status)

### 5.1 Connection Health Badge

**File:** `src/built-in/chat/widgets/chatTokenStatusBar.ts`

**Current state:** Shows token usage + indexing indicator. No connection health.

**Changes:**
- Add a connection health indicator (dot/icon) to the left of the token label
- States: connected (green), disconnected (red), connecting (yellow pulse)
- Wire to `ollamaProvider.checkHealth()` on a 30-second interval
- On click: show popup with model name, provider, last health check time

**CSS additions:** `chatWidget.css` — classes for `.parallx-health-dot--connected`,
`--disconnected`, `--connecting`.

### 5.2 Indexing Progress Badge

**File:** `src/built-in/chat/widgets/chatTokenStatusBar.ts`

**Current state:** Already has indexing display (lines 235-271) but
investigation needed on whether it's currently visible.

**Changes:**
- Ensure the indexing badge shows during initial indexing
- Format: "Indexing: 42/120 files" with animated progress
- Wire to `indexingPipeline.onDidChangeProgress` event
- Hide when idle

### 5.3 Tool Execution Feedback

**File:** `src/built-in/chat/widgets/chatWidget.ts`

**Changes:**
- During turn execution, show tool invocation status in the response stream
- Format: "⚡ Searching workspace..." / "⚡ Reading file..." / "⚡ Running command..."
- Wire to tool execution callbacks in the participant

### Verification

```
npx tsc --noEmit
npx vitest run
```
Visual: Status bar shows green dot when Ollama connected. Shows indexing progress
during initial scan. Tool execution shows inline status during turns.

---

## 6. Phase 4 — In-App Help System

**Gaps closed:** B3 (no contextual help), D1 (settings scope), D2 (settings save confirmation)

### 6.1 Settings Field Descriptions

**Files:** `src/aiSettings/ui/sections/*.ts` (all section files)

**Changes:**
- Add `description` field to each setting control
- Render as subtle text below the control (same pattern as VS Code settings)
- Key descriptions:

| Section | Field | Description |
|---------|-------|-------------|
| Model | Temperature | "Controls randomness. Lower = more focused, higher = more creative. Default: 0.7" |
| Model | Max Tokens | "Maximum length of AI responses. Higher = longer answers but slower." |
| Model | Context Window | "How much text the AI can consider at once. Auto-detected from your model." |
| Chat | System Prompt | "Base instructions the AI follows every turn. Edit SOUL.md for full control." |
| Tools | Permission | "always-allowed: runs without asking. requires-approval: asks first. never-allowed: disabled." |
| Agent | Autonomy | "Controls how much the AI can do without asking. Start with 'Manual' if unsure." |

### 6.2 Mode Picker Descriptions

**File:** `src/built-in/chat/pickers/chatModePicker.ts`

**Changes:**
- Add one-line description below each mode in the dropdown
- Ask: "Get answers grounded in your workspace files and pages"
- Edit: "AI proposes changes for you to review and accept"
- Agent: "AI takes multi-step actions with your approval"

### 6.3 Workspace vs Global Scope Badge

**Files:** AI Settings section files

**Changes:**
- If a setting value differs from the global default (i.e., workspace override
  exists in `.parallx/ai-config.json`), show a "Workspace" badge next to it
- Badge is clickable → resets to global default

### 6.4 Settings Save Confirmation

**File:** `src/aiSettings/ui/aiSettingsPanel.ts`

**Changes:**
- After any setting change persists, show a brief toast: "Settings saved"
- Use existing notification infrastructure from `INotificationService`
- Auto-dismiss after 2 seconds

### Verification

```
npx tsc --noEmit
npx vitest run
```
Visual: Settings fields have descriptions. Mode picker shows descriptions.
Workspace overrides show badge. Settings save shows toast.

---

## 7. Phase 5 — Agent Autonomy UX

**Gaps closed:** C7 (agent mode passive), D7 (Ask mode hidden)

### 7.1 Autonomy Level Selector

**File:** `src/built-in/chat/pickers/chatModePicker.ts`

**Changes:**
When Agent mode is selected, show a secondary selector for autonomy level:

| Level | Label | Description |
|-------|-------|-------------|
| Manual | "I approve everything" | Every action requires your OK |
| Allow Reads | "Auto-search, ask for changes" | AI searches freely, asks before any writes |
| Allow Safe | "Auto for safe actions" | Reads + non-destructive edits run automatically |
| Custom | "I set the rules" | Opens AI Settings → Agent section |

Default: "Allow Reads" (researcher mode).

### 7.2 Restore Ask Mode

**File:** `src/built-in/chat/pickers/chatModePicker.ts`

**Changes:**
- Restore Ask mode as a visible option in the mode picker
- Description: "Get answers grounded in your workspace files and pages"
- This is read-only mode — no tool execution, pure Q&A

### Verification

```
npx tsc --noEmit
npx vitest run
```
Visual: Mode picker shows Ask/Edit/Agent. Selecting Agent shows autonomy selector.

---

## 8. Phase 6 — Resilience Hardening

**Gaps closed:** D5 (fixed retry backoff), C6 (limited tool breadth)

### 8.1 Exponential Backoff

**File:** `src/openclaw/openclawTurnRunner.ts`

**Current state:** Fixed `TRANSIENT_RETRY_DELAY = 2500` (line 38). Used for
all 3 transient retries.

**Changes:**
```typescript
// Replace fixed delay with exponential backoff:
// Attempt 0: 2500ms, Attempt 1: 5000ms, Attempt 2: 10000ms
// Cap at 15000ms to prevent excessive waits
const TRANSIENT_BASE_DELAY = 2500;
const TRANSIENT_MAX_DELAY = 15000;

function transientDelay(attempt: number): number {
  return Math.min(TRANSIENT_BASE_DELAY * Math.pow(2, attempt), TRANSIENT_MAX_DELAY);
}
```

### 8.2 New Workspace Skills (Tool Breadth)

Add new tools as workspace-compatible SKILL.md manifests in
`src/built-in/chat/skills/`. These use existing tool infrastructure
(run_command, read_file) but provide guided prompts:

| Skill | Name | What it does | Implementation |
|-------|------|-------------|----------------|
| git-status | Git Status | Run `git status`, `git diff`, `git log` | Workflow skill: runs terminal commands |
| fetch-url | Fetch URL | Retrieve content from a URL | New tool implementation needed |
| pdf-extract | PDF Extract | Extract text from PDF using Docling bridge | Wire existing `documentExtractor.cjs` as tool |

**Note:** `fetch-url` requires a new tool implementation in `src/built-in/chat/tools/`.
The Docling bridge (`electron/doclingBridge.cjs`) already exists but isn't
wired as a chat tool. `git-status` can be a pure workflow skill that chains
existing `run_command` tool.

### Verification

```
npx tsc --noEmit
npx vitest run
```
Behavioral: Model uses exponential backoff on transient errors.

---

## 9. Phase 7 — Polish & Consistency

**Gaps closed:** D3 (.parallx invisible), D4 (skill deps), D6 (no re-ranking)

### 7.1 `.parallx/` Visibility

**File:** `src/built-in/welcome/main.ts` or new view contribution

**Changes:**
- Add a "Workspace Config" link to the welcome page AI Quick Start section
- Clicking opens `.parallx/` folder in the file explorer
- Alternative: add `.parallx/` as a visible entry in the explorer tree

### 7.2 Document Limitations

**Gaps D4 (skill dependency chaining) and D6 (no re-ranking in RAG)** are
architectural limitations that require deeper work. Document as known
limitations:

- D4: Update `docs/ai/AI_USER_GUIDE.md` with note that skills are independent;
  future support for skill chaining planned.
- D6: Update architecture notes that RRF fusion is current strategy; LLM
  re-ranking is a future enhancement for Milestone 43+.

### Verification

```
npx tsc --noEmit
npx vitest run
```

---

## 10. Verification Plan

### Per-Phase Gate

Each phase must pass before proceeding to the next:

1. `npx tsc --noEmit` — 0 compile errors
2. `npx vitest run` — all tests pass (≥2,446)
3. Visual verification of new UI elements
4. Commit with descriptive message

### Final Gate (all phases complete)

1. All per-phase gates pass
2. Welcome page shows AI Quick Start section
3. Empty state shows 9+ hints with plain-English descriptions
4. Model switch auto-detects context window
5. Status bar shows connection health + indexing progress
6. Settings have field descriptions and save confirmation
7. Agent mode has autonomy selector
8. Retry uses exponential backoff
9. New skills are available
10. User Guide accessible from UI

---

## Implementation Notes

### Files Modified Per Phase

| Phase | Files |
|-------|-------|
| 1 | `src/built-in/welcome/main.ts`, `src/built-in/welcome/welcome.css`, `src/built-in/chat/widgets/chatWidget.ts`, `src/built-in/chat/widgets/chatWidget.css` |
| 2 | `src/services/languageModelsService.ts`, `src/openclaw/openclawToolPolicy.ts`, `src/openclaw/openclawSystemPrompt.ts` |
| 3 | `src/built-in/chat/widgets/chatTokenStatusBar.ts`, `src/built-in/chat/widgets/chatWidget.css` |
| 4 | `src/aiSettings/ui/sections/*.ts`, `src/built-in/chat/pickers/chatModePicker.ts`, `src/aiSettings/ui/aiSettingsPanel.ts` |
| 5 | `src/built-in/chat/pickers/chatModePicker.ts` |
| 6 | `src/openclaw/openclawTurnRunner.ts`, `src/built-in/chat/skills/builtInSkillManifests.ts` |
| 7 | `src/built-in/welcome/main.ts`, `docs/ai/AI_USER_GUIDE.md` |

### Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Welcome page changes break first-launch detection | Test with fresh `globalState` |
| Model probing slows startup | Cache results, don't block UI |
| Status bar overload (too many badges) | Compact design, hide when not needed |
| Settings descriptions crowd the UI | Use subtle styling, collapsible |
| New tools introduce security surface | All new tools require approval by default |
