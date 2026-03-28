# D2 Chat Commands — Iteration 1 STRUCTURAL Audit

**Auditor:** AI Parity Auditor  
**Date:** 2026-03-28  
**Target:** OpenClaw (github.com/openclaw/openclaw, commit e635cedb)  
**Parallx Baseline:** 3 built-in slash commands (`/context`, `/init`, `/compact`)

---

## 1. Summary Table

| # | Command     | Classification | Existing Related Functionality |
|---|-------------|---------------|-------------------------------|
| 1 | `/status`   | **MISSING**   | `OllamaProvider.checkAvailability()` exists; `getActiveModel()` exists; no slash command wiring |
| 2 | `/new`      | **PARTIAL**   | `chat.newSession` / `chat.clearSession` commands exist in widget layer; `createSession()` in `IChatService`; no slash command entry |
| 3 | `/models`   | **MISSING**   | `OllamaProvider.listModels()` exists; `ILanguageModelsService.getModels()` exists; no slash command wiring |
| 4 | `/doctor`   | **MISSING**   | `checkAvailability()` exists for Ollama; some docling diagnostics in `doclingCommands.ts`; no unified diagnostic slash command |
| 5 | `/think`    | **PARTIAL**   | `options.think` flag in `IChatRequestOptions`; `_noThinkModels` set in OllamaProvider; no slash command to toggle |
| 6 | `/usage`    | **PARTIAL**   | `reportTokenUsage()` on `IChatResponseStream`; `chatTokenStatusBar.ts` shows per-turn usage; no cumulative session stats via slash command |
| 7 | `/tools`    | **PARTIAL**   | `getToolDefinitions()` / `getReadOnlyToolDefinitions()` / `getSkillCatalog()` available on services; `buildOpenclawRuntimeToolState()` builds tool report; no slash command |
| 8 | `/verbose`  | **MISSING**   | No debug/verbose toggle exists in the runtime at all |

**Score: 0/8 ALIGNED, 4/8 PARTIAL, 4/8 MISSING**

---

## 2. Per-Command Analysis

### 2.1 `/status` — Show current AI runtime status (MISSING)

**What exists:**
- `OllamaProvider.checkAvailability()` → `IProviderStatus { available, version, error }`
- `ILanguageModelsService.getActiveModel()` → current model ID
- `ILanguageModelsService.checkStatus()` → delegates to provider
- `computeTokenBudget()` → current context window budget
- `unifiedConfigService.getEffectiveConfig()` → active AI config

**What's missing:**
- No `OPENCLAW_COMMANDS.status` entry in the command registry
- No `tryHandleOpenclawStatusCommand()` handler
- No rendering of consolidated runtime status via `IChatResponseStream`

**Handler needs access to:**
- `ILanguageModelsService` (via `services.getActiveModel()`, model info)
- `OllamaProvider.checkAvailability()` (via `services` or a new `checkStatus` delegate)
- `unifiedConfigService` (for config display)
- `getModelContextLength()` (for budget info)

**Recommended file:** New `src/openclaw/commands/openclawStatusCommand.ts`

---

### 2.2 `/new` — Start a new conversation (PARTIAL)

**What exists:**
- `chat.newSession` command registered in `src/built-in/chat/main.ts:988` — creates session via `chatService.createSession()`
- `chat.clearSession` command registered in `src/built-in/chat/main.ts:998` — clears and creates new session
- `_handleClearSession()` in `chatWidget.ts:791` — UI-layer session swap
- `IChatService.createSession()` — the core session creation API
- `IChatWidgetServices.createSession` exposed on `openclawTypes.ts:348`

**What's missing:**
- No slash command registration in `OPENCLAW_COMMANDS`
- No `tryHandleOpenclawNewCommand()` handler
- The `/new` command needs to bridge from the participant layer back to the session/widget layer — currently session creation is only widget-initiated, not participant-initiated

**Key challenge:** The participant handler runs *within* a session turn. To start a new session from inside a turn, the handler needs to either:
1. Return a special result metadata that the widget layer interprets as "start new session after this turn completes", or
2. Invoke `chat.newSession` programmatically via a command bridge

**Handler needs access to:**
- `sessionManager` or `compactSession` to clear current session
- A `createSession` callback or command executor

**Recommended file:** New `src/openclaw/commands/openclawNewCommand.ts`

---

### 2.3 `/models` — List available Ollama models (MISSING)

**What exists:**
- `OllamaProvider.listModels()` → returns `ILanguageModelInfo[]` with id, displayName, family, parameterSize, quantization, contextLength, capabilities
- `ILanguageModelsService.getModels()` → aggregated model list
- `ILanguageModelsService.getActiveModel()` → current selection
- `OllamaProvider.getModelInfo(modelId)` → enriched per-model details

**What's missing:**
- No `OPENCLAW_COMMANDS.models` entry
- No `tryHandleOpenclawModelsCommand()` handler
- No markdown formatting of model list for chat display

**Handler needs access to:**
- `ILanguageModelsService.getModels()` — need a new delegate on `IDefaultParticipantServices` (currently only `getActiveModel()` and `getAvailableModelIds()` exist)
- `getActiveModel()` to mark the current selection

**Recommended file:** New `src/openclaw/commands/openclawModelsCommand.ts`

---

### 2.4 `/doctor` — Run diagnostics checks (MISSING)

**What exists (scattered):**
- `OllamaProvider.checkAvailability()` — connection check
- `OllamaProvider.listModels()` — model availability
- `isRAGAvailable()` / `isIndexing()` — RAG status
- `getFileCount()` — workspace file indexing status
- Bootstrap file loading in `loadOpenclawBootstrapEntries()` — AGENTS.md, SOUL.md etc.
- `doclingCommands.ts` — Docling service diagnostics (separate system)
- `unifiedConfigService._healthCheckPresets()` — config validation

**What's missing:**
- No unified diagnostic runner
- No slash command entry or handler
- No check for: model loaded in VRAM, embedding model available, memory service health, tool registration health, workspace bootstrap completeness

**Cross-domain dependency: D3 (Steer Check)** — diagnostic results should follow the same structured check pattern

**Handler needs access to:**
- Provider status (`checkAvailability`)
- Model list (`listModels` or delegate)
- RAG status (`isRAGAvailable`, `isIndexing`)
- Bootstrap health (`loadOpenclawBootstrapEntries`)
- `unifiedConfigService` for config validation
- Workspace presence checks (`existsRelative` for AGENTS.md etc.)

**Recommended file:** New `src/openclaw/commands/openclawDoctorCommand.ts`

---

### 2.5 `/think` — Enable extended thinking mode (PARTIAL)

**What exists:**
- `IChatRequestOptions.think?: boolean` — per-request thinking toggle
- `OllamaProvider` supports `think: true` in request options (line 413)
- `_noThinkModels` set tracks models that don't support thinking
- `IChatResponseChunk.thinking` and `IChatMessage.thinking` carry thinking content
- `ChatContentPartKind.Thinking` for rendering thinking blocks
- No persistent toggle — thinking is set per-request, not session-wide

**What's missing:**
- No slash command to toggle thinking mode on/off for the session
- No session-level thinking state (would need to be stored somewhere the turn runner reads)
- No `OPENCLAW_COMMANDS.think` entry

**Architecture question:** Should `/think` be a session-level toggle (all subsequent turns use thinking) or a one-shot directive (next turn only)?

**Handler needs access to:**
- A session-level state store for the thinking flag
- `unifiedConfigService` or a new session config overlay
- Model capability check (does current model support thinking?)

**Recommended file:** New `src/openclaw/commands/openclawThinkCommand.ts`

---

### 2.6 `/usage` — Show token usage statistics (PARTIAL)

**What exists:**
- `response.reportTokenUsage(promptTokens, completionTokens)` — per-turn real token reporting
- `chatTokenStatusBar.ts` — visual token usage bar (per-turn, not cumulative)
- Token data stored on `IChatAssistantResponse` as `promptTokens` / `completionTokens`
- `computeTokenBudget()` — budget computation
- `openclawTokenBudget.ts` — token estimation utilities
- Session history (`context.history`) contains all past turns with response objects

**What's missing:**
- No slash command entry
- No `tryHandleOpenclawUsageCommand()` handler
- No cumulative session-level token aggregation
- No formatted markdown output of token stats

**Cross-domain dependency: D7 (Token Budget)** — should align with token budget visualization

**Handler needs access to:**
- `context.history` — to iterate past turns and sum token usage
- `getModelContextLength()` — for budget percentage
- `getActiveModel()` — for display

**Recommended file:** New `src/openclaw/commands/openclawUsageCommand.ts`

---

### 2.7 `/tools` — List available tools and their status (PARTIAL)

**What exists:**
- `getToolDefinitions()` → active tool definitions (includes tool-calling tools)
- `getReadOnlyToolDefinitions()` → read-only mode tools
- `getSkillCatalog()` → skill entries
- `getToolPermissions()` → permission levels per tool
- `buildOpenclawRuntimeToolState()` → builds full tool state report with filtering/availability
- `resolveToolProfile()` → determines which tools are allowed per mode
- `IOpenclawToolCapabilityReportEntry` — rich tool report entry type
- `/context detail` already shows tool lists as part of the context report

**What's missing:**
- No dedicated `/tools` slash command (currently buried in `/context detail` output)
- No standalone handler that renders just tool information
- No interactive tool enable/disable from chat

**Handler needs access to:**
- `getToolDefinitions()`, `getReadOnlyToolDefinitions()`
- `getSkillCatalog()`
- `getToolPermissions()`
- `resolveToolProfile()` — to show current mode filtering

**Recommended file:** New `src/openclaw/commands/openclawToolsCommand.ts`

---

### 2.8 `/verbose` — Toggle verbose/debug output mode (MISSING)

**What exists:**
- No verbose/debug toggle anywhere in the runtime
- `reportRetrievalDebug()`, `reportResponseDebug()`, `reportRuntimeTrace()`, `reportBootstrapDebug()` exist as optional service methods — but they're for internal debug reporting, not user-facing verbose output
- No session-level `verbose` flag

**What's missing:**
- No verbose mode concept at all
- No slash command entry
- No session-level state for verbose mode
- No mechanism for the turn runner to emit extra debug info when verbose is on

**Handler needs access to:**
- A session-level state store for the verbose flag
- Integration with `reportRuntimeTrace()`, `reportRetrievalDebug()` etc. to surface debug info in the chat stream when verbose is active

**Recommended file:** New `src/openclaw/commands/openclawVerboseCommand.ts`

---

## 3. Architecture Recommendation

### File Organization

**Recommended: Separate command files in a `commands/` subdirectory**

```
src/openclaw/commands/
├── openclawStatusCommand.ts      — /status handler
├── openclawNewCommand.ts         — /new handler  
├── openclawModelsCommand.ts      — /models handler
├── openclawDoctorCommand.ts      — /doctor handler
├── openclawThinkCommand.ts       — /think handler
├── openclawUsageCommand.ts       — /usage handler
├── openclawToolsCommand.ts       — /tools handler
└── openclawVerboseCommand.ts     — /verbose handler
```

**Rationale:**
- Existing pattern: `/init` handler is in `openclawDefaultRuntimeSupport.ts` (250+ lines), `/context` is in `openclawContextReport.ts` (200+ lines). These are already large.
- Each new command has distinct service dependencies — separate files keep imports clean
- Follows the upstream OpenClaw pattern where command handlers are in `src/commands/`
- Each file exports a `tryHandleOpenclaw<Name>Command()` function matching the existing pattern

### Registration Pattern

In `openclawDefaultRuntimeSupport.ts`:
```typescript
const OPENCLAW_COMMANDS: Record<string, IChatSlashCommand> = {
  // existing
  context: { ... },
  init: { ... },
  compact: { ... },
  // new
  status:  { name: 'status',  description: 'Show AI runtime status',           promptTemplate: '{input}', isBuiltIn: true },
  new:     { name: 'new',     description: 'Start a new conversation',          promptTemplate: '{input}', isBuiltIn: true },
  models:  { name: 'models',  description: 'List available Ollama models',      promptTemplate: '{input}', isBuiltIn: true },
  doctor:  { name: 'doctor',  description: 'Run diagnostic checks',            promptTemplate: '{input}', isBuiltIn: true },
  think:   { name: 'think',   description: 'Toggle extended thinking mode',     promptTemplate: '{input}', isBuiltIn: true },
  usage:   { name: 'usage',   description: 'Show token usage statistics',       promptTemplate: '{input}', isBuiltIn: true },
  tools:   { name: 'tools',   description: 'List available tools',              promptTemplate: '{input}', isBuiltIn: true },
  verbose: { name: 'verbose', description: 'Toggle verbose/debug output',       promptTemplate: '{input}', isBuiltIn: true },

---

# D2 Chat Commands — Iteration 2 REFINEMENT Audit

**Auditor:** AI Parity Auditor  
**Date:** 2026-03-28  
**Baseline:** Iteration 1 complete — 8/8 commands implemented, 2707 tests

---

## Iteration 2 Summary Table

| ID | Severity | Finding | Resolution |
|----|----------|---------|------------|
| R1 | CRITICAL | 5 D2 service delegates (`listModels`, `checkProviderStatus`, `getSessionFlag`, `setSessionFlag`, `executeCommand`) not wired in `main.ts` adapter — all commands degraded to fallback/warning at runtime | Wired in `main.ts` with proper Ollama/services bindings |
| R2 | HIGH | `VERBOSE_SESSION_FLAG` never read during turn execution — toggle had zero runtime effect | Added verbose debug header in `openclawDefaultParticipant.ts` emitting model/budget/tools/history/agent/think/RAG details |
| R3 | MEDIUM | `/new` did not clear think/verbose session flags on session reset | Added `setSessionFlag(THINK_SESSION_FLAG, false)` and `setSessionFlag(VERBOSE_SESSION_FLAG, false)` to `/new` handler |
| R4 | LOW | `getAvailableModelIds`/`sendChatRequestForModel` also unwired in adapter | Wired alongside other D2 delegates |
| R5 | LOW | 13 untested edge case scenarios | Added 13 tests: verbose header, /new clears flags, /doctor partial failures, /models fallback, /usage empty history, etc. |

## Post-Iteration 2 Classification

| # | Command | Status | Notes |
|---|---------|--------|-------|
| 1 | `/status` | **ALIGNED** | Fully wired, error handling tested |
| 2 | `/new` | **ALIGNED** | Session flag cleanup added, executeCommand wired |
| 3 | `/models` | **ALIGNED** | Primary path (listModels) + fallback (getAvailableModelIds) both wired |
| 4 | `/doctor` | **ALIGNED** | 8 diagnostic checks, partial failure handling tested |
| 5 | `/think` | **ALIGNED** | Session flag wired, injected into sendChatRequest |
| 6 | `/usage` | **ALIGNED** | Empty history edge case tested |
| 7 | `/tools` | **ALIGNED** | Skill + tool listing with permission levels |
| 8 | `/verbose` | **ALIGNED** | Flag toggle + debug header in turn execution |

**Score: 8/8 ALIGNED**

---

# D2 Chat Commands — Iteration 3 PARITY CHECK Audit

**Auditor:** AI Parity Auditor  
**Date:** 2026-03-28  
**Baseline:** Iteration 2 complete — 8/8 ALIGNED, 2720 tests

---

## Final Parity Classification

| # | Command | Handler | Registry | Participant | Dispatch | Service | main.ts | Tests | ALIGNED? |
|---|---------|---------|----------|-------------|----------|---------|---------|-------|----------|
| 1 | `/status` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 5 | **YES** |
| 2 | `/new` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 4 | **YES** |
| 3 | `/models` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 6 | **YES** |
| 4 | `/doctor` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 5 | **YES** |
| 5 | `/think` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 6 | **YES** |
| 6 | `/usage` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 4 | **YES** |
| 7 | `/tools` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 4 | **YES** |
| 8 | `/verbose` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 6 | **YES** |

## Verification Summary

- **All 7 axes checked:** handler → registry → participant → dispatch → service adapter → main.ts → tests
- **M41 compliance:** CLEAN — no anti-patterns detected
- **Cross-domain readiness:** D3, D7, D8 extension points confirmed
- **Test coverage:** 39/39 passing

## Final Score: 8/8 ALIGNED ✅

**Verdict: PASS — D2 Chat Commands domain is CLOSED.**

## Files Changed in Iteration 2

| File | Change |
|------|--------|
| `src/built-in/chat/main.ts` | `_sessionFlags` map + 7 delegate wirings (listModels, checkProviderStatus, getSessionFlag, setSessionFlag, executeCommand, getAvailableModelIds, sendChatRequestForModel) |
| `src/openclaw/commands/openclawNewCommand.ts` | Clear think + verbose session flags on `/new` |
| `src/openclaw/participants/openclawDefaultParticipant.ts` | Import `VERBOSE_SESSION_FLAG` + verbose debug header block |
| `tests/unit/openclawSlashCommands.test.ts` | 13 new edge case tests (26 → 39 total) |

## Test Metrics
- **Before:** 141 files, 2707 tests, 0 failures
- **After:** 141 files, 2720 tests, 0 failures (+13 tests)
};
```

### Dispatch Pattern

In `openclawDefaultParticipant.ts` → `runOpenclawDefaultTurn()`, add dispatch after existing commands:

```typescript
// existing
const initResult = await tryHandleOpenclawInitCommand(...);
const contextResult = await tryHandleOpenclawContextCommand(...);
const compactResult = await tryHandleOpenclawCompactCommand(...);

// new D2 commands
const statusResult = await tryHandleOpenclawStatusCommand(services, request.command, response);
if (statusResult) return statusResult;
// ... etc for each command
```

### Session-Level State (for /think, /verbose)

Two commands (`/think`, `/verbose`) require session-scoped state that persists across turns. Options:

1. **Add to `IChatSession`** — add `sessionFlags: Record<string, boolean>` or specific `thinkingEnabled` / `verboseEnabled` fields
2. **Use `IDefaultParticipantServices` extension** — add optional `getSessionFlag(key)` / `setSessionFlag(key, value)` methods
3. **Use `unifiedConfigService` overlay** — session-scoped config overrides

**Recommended: Option 2** — lightweight, doesn't bloat the session model, follows the existing optional service pattern.

---

## 4. Cross-Domain Notes

| Command    | Cross-Domain | Notes |
|-----------|-------------|-------|
| `/status`  | D8 (Agent Config) | Should show active agent config if a custom agent is resolved |
| `/new`     | None | Pure session lifecycle — isolated |
| `/models`  | None | Pure provider query — isolated |
| `/doctor`  | **D3 (Steer Check)** | Doctor checks overlap with steer-check validation (RAG readiness, model availability). Should share diagnostic primitives |
| `/think`   | D7 (Token Budget) | Thinking mode uses more tokens; budget computation may need adjustment |
| `/usage`   | **D7 (Token Budget)** | Token usage display should align with token budget visualization in `chatTokenStatusBar.ts` |
| `/tools`   | D8 (Agent Config) | Tool availability can vary by agent configuration |
| `/verbose` | F12 (Runtime UX Fidelity) | Verbose mode surfaces runtime trace data — same data pipeline as debug reporting |

---

## 5. Test Coverage Assessment

### Existing Test Infrastructure

- **`tests/unit/chatService.test.ts`** — Has integration tests for `createOpenclawDefaultParticipant` with mock services. Tests command dispatch (init, context, compact) via `participant.handler()` calls. Good pattern to follow.
- **`tests/unit/registerOpenclawParticipants.test.ts`** — Tests `buildOpenclawDefaultParticipantServices` wiring
- **No dedicated slash command test file** — commands are tested inline within chatService tests

### Test Gaps

| Command    | Existing Tests | Gap |
|-----------|---------------|-----|
| `/status`  | None | Need handler unit test + integration test via participant |
| `/new`     | `chat.newSession` has E2E keybind test only | Need slash command handler test; need bridge-to-widget test |
| `/models`  | None | Need handler unit test with mocked `listModels()` |
| `/doctor`  | None | Need handler unit test with various failure scenarios |
| `/think`   | None | Need toggle test, model-capability check test |
| `/usage`   | `reportTokenUsage` tested in chatService | Need cumulative aggregation test via slash command |
| `/tools`   | Tool state tested in toolPolicy tests | Need formatted output test via slash command |
| `/verbose` | None | Need toggle test, verbose output pipeline test |

### Recommended Test File

Create `tests/unit/openclawSlashCommands.test.ts` with:
- One `describe` block per command
- Shared mock service factory (extend existing `stubDefaultServices()` pattern)
- Each command tested with: happy path, missing service graceful degradation, formatted output verification

---

## 6. Implementation Priority

| Priority | Command    | Effort | Rationale |
|----------|-----------|--------|-----------|
| 1        | `/status`  | Low    | Straightforward service aggregation, high user value |
| 2        | `/models`  | Low    | Direct `listModels()` wrapper, simple formatting |
| 3        | `/usage`   | Low    | History iteration + formatting, data already available |
| 4        | `/tools`   | Low    | Existing tool state builder, extract from /context |
| 5        | `/new`     | Medium | Session bridge architecture needed |
| 6        | `/doctor`  | Medium | Multiple diagnostic checks to implement |
| 7        | `/think`   | Medium | Session-level state infrastructure needed |
| 8        | `/verbose` | High   | Needs new verbose mode concept + pipeline integration |
