# F13: Legacy Prompt Elimination — AUDIT

**Date:** 2026-03-27  
**Iteration:** 1  
**Auditor:** AI Parity Auditor (strict functional mode)

---

## Summary

| Capability | Classification | Severity |
|-----------|---------------|----------|
| F13-1 System prompt viewer shows real prompt | **MISALIGNED** | HIGH |
| F13-2 Token status bar uses real prompt data | **MISALIGNED** | MEDIUM |
| F13-3 No legacy prompt builder file | **MISALIGNED** | HIGH |
| F13-4 No legacy prompt composer file | **MISALIGNED** | MEDIUM |
| F13-5 Tests cover the real builder | **MISALIGNED** | MEDIUM |

**Total:** 0/5 ALIGNED

---

## Per-Capability Findings

### F13-1: System prompt viewer shows real prompt

**Classification:** MISALIGNED  
**Severity:** HIGH

The "View System Prompt" wrench modal shows the **legacy** prompt, not the real OpenClaw prompt.

**Wiring chain:**
1. `chatWidget.ts:933-935` — `const promptText = await this._services.getSystemPrompt()`
2. `chatDataService.ts:2134` — `getSystemPrompt: () => composeChatSystemPrompt({...})`
3. `chatSystemPromptComposer.ts:3,34` — `import { buildSystemPrompt } from '../config/chatSystemPrompts.js'` → `return buildSystemPrompt(ChatMode.Agent, {...})`

The user clicks the wrench icon → gets `composeChatSystemPrompt()` → which calls legacy `buildSystemPrompt()`. The real prompt (`buildOpenclawSystemPrompt()`) is never consulted.

**Upstream:** OpenClaw has one builder `buildAgentSystemPrompt` in `agents/system-prompt.ts`. There is no secondary "viewer" builder.

---

### F13-2: Token status bar uses real prompt data

**Classification:** MISALIGNED  
**Severity:** MEDIUM

Hybrid approach: prefers OpenClaw data post-turn, falls back to legacy builder pre-first-turn.

**Evidence:** `chatTokenStatusBar.ts:23` — `import { buildSystemPrompt } from '../config/chatSystemPrompts.js'`

Lines 275-307: If `getLastSystemPromptReport()` returns data, uses the real report. Otherwise falls back to `buildSystemPrompt(mode, fullCtx)` which calls the legacy builder.

Pre-first-turn estimates are wrong because the legacy builder produces a ~1500-token identity/rules prompt while the real builder produces a 10-section structured prompt with bootstrap files, safety, runtime metadata, etc.

---

### F13-3: No legacy prompt builder file

**Classification:** MISALIGNED  
**Severity:** HIGH

`src/built-in/chat/config/chatSystemPrompts.ts` still exists with 280+ lines including:
- `buildSystemPrompt()` (line 59) — consumed by `chatTokenStatusBar.ts` and `chatSystemPromptComposer.ts`
- `buildSkillInstructionSection()` (line 265) — consumed by **zero production code** (only test file)
- Re-export of `ISystemPromptContext` (line 21) — consumers already use `chatTypes.ts` directly
- `PARALLX_IDENTITY` const — dead, real pipeline uses `buildIdentitySection()` in `openclawSystemPrompt.ts`

**Impact:** Concrete bug already occurred — F12 audit found `chatSystemPrompts.ts` had 3 skill instructions the pipeline file didn't. A developer edited the wrong file.

---

### F13-4: No legacy prompt composer file

**Classification:** MISALIGNED  
**Severity:** MEDIUM

`src/built-in/chat/utilities/chatSystemPromptComposer.ts` (45 lines) exists solely to bridge `chatDataService` → legacy builder. Its `composeChatSystemPrompt()` does async `loadLayers()` + `assemblePromptOverlay()` + DB queries to call the legacy builder — work already done by the OpenClaw bootstrap path.

Consumed by exactly one production file: `chatDataService.ts:63`.

---

### F13-5: Tests cover the real builder, not legacy

**Classification:** MISALIGNED  
**Severity:** MEDIUM

Three test files exist:
1. `chatSystemPrompts.test.ts` — ~400 lines testing the **legacy** `buildSystemPrompt()`
2. `chatSystemPromptComposer.test.ts` — ~45 lines testing the **legacy** `composeChatSystemPrompt()`
3. `openclawSystemPrompt.test.ts` — tests the **real** `buildOpenclawSystemPrompt()`

Also: `chatGateCompliance.test.ts:57` registers `chatSystemPrompts.ts` as a valid leaf module.

---

## Secondary Issues

| Issue | Location | Detail |
|-------|----------|--------|
| `ISystemPromptContext` re-export | `chatSystemPrompts.ts:21` | Re-exports from `chatTypes.ts`. All consumers already import from `chatTypes.ts` directly. |
| `buildSkillInstructionSection` dead export | `chatSystemPrompts.ts:265` | Zero production consumers. Only test file. |
| `PARALLX_IDENTITY` const | `chatSystemPrompts.ts:25` | Dead. Real pipeline uses `buildIdentitySection()`. |
| `ARCHITECTURE.md` stale reference | `ARCHITECTURE.md:314` | Documents `chatSystemPrompts.ts` as the active prompt builder. |

## Dependency Graph

```
chatSystemPrompts.ts (LEGACY — to be eliminated)
  ├── chatSystemPromptComposer.ts (imports buildSystemPrompt)
  │     └── chatDataService.ts:63 (imports composeChatSystemPrompt)
  │           └── chatDataService.ts:2134 (wires getSystemPrompt → chatWidget viewer)
  ├── chatTokenStatusBar.ts:23 (imports buildSystemPrompt for pre-first-turn fallback)
  ├── chatSystemPrompts.test.ts (400+ lines testing legacy)
  ├── chatSystemPromptComposer.test.ts (45 lines testing legacy)
  └── chatGateCompliance.test.ts:57 (registers as valid module)
```
