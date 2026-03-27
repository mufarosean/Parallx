# F11: AI Configuration Surface — Domain Tracker

**Domain:** F11 — AI Configuration Surface  
**Status:** ✅ CLOSED  
**Started:** 2026-03-27  
**Closed:** 2026-03-27  
**Owner:** Parity Orchestrator  

---

## Scorecard

| ID | Capability | Iter-1 | Iter-2 | Iter-3 | Final |
|----|-----------|--------|--------|--------|-------|
| C1 | System prompt origin | — | LEGACY (safe) | ACCEPTABLE | ✅ |
| C2 | Bootstrap file loading | ✅ G02 | — | — | ✅ ALIGNED |
| C3 | Bootstrap file scaffolding | ✅ G03+G04 | — | — | ✅ ALIGNED |
| C4 | Personality configuration | — | DEAD (@deprecated) | ACCEPTABLE | ✅ |
| C5 | Model parameters | ✅ G01 | — | — | ✅ ALIGNED |
| C6 | Retrieval parameters | — | ✅ G07 (autoRag) | — | ✅ ALIGNED |
| C7 | Memory parameters | — | 2/4 consumed (@deprecated) | ACCEPTABLE | ✅ |
| C8 | Agent parameters | — | 1/5 consumed (@deprecated) | ACCEPTABLE | ✅ |
| C9 | Prompt overlay / rules | ALIGNED | — | — | ✅ ALIGNED |
| C10 | Legacy AISettingsService | — | LEGACY (never instantiated) | ACCEPTABLE | ✅ |
| C11 | Legacy unified config consumers | — | dead fields marked | ACCEPTABLE | ✅ |
| C12 | Legacy system prompt builders | ✅ G05 | — | — | ✅ ALIGNED |
| C13 | Settings UI panel | — | ~16 dead controls marked | ACCEPTABLE | ✅ |
| C14 | Preset / profile system | — | presets vary dead fields | ACCEPTABLE | ✅ |
| C15 | Workspace override | — | overrides dead fields | ACCEPTABLE | ✅ |
| C16 | Runtime selector | ✅ G06 | — | — | ✅ ALIGNED |

---

## Key Files

| File | Role |
|------|------|
| `src/openclaw/openclawAttempt.ts` | Turn context + attempt execution |
| `src/openclaw/participants/openclawDefaultParticipant.ts` | Default participant turn builder |
| `src/openclaw/participants/openclawParticipantRuntime.ts` | Bootstrap file loading |
| `src/openclaw/openclawDefaultRuntimeSupport.ts` | /init command |
| `src/openclaw/openclawSystemPrompt.ts` | System prompt builder |
| `src/aiSettings/unifiedConfigTypes.ts` | Unified config types |
| `src/aiSettings/unifiedAIConfigService.ts` | Unified config service |
| `src/aiSettings/systemPromptGenerator.ts` | Legacy prompt generator |
| `src/aiSettings/aiSettingsService.ts` | Legacy settings service |
| `src/services/chatRuntimeSelector.ts` | Runtime selector |
| `src/services/promptFileService.ts` | Legacy prompt file loader |
| `src/built-in/chat/config/chatSystemPrompts.ts` | Legacy system prompts |
| `src/built-in/chat/widgets/chatTokenStatusBar.ts` | Token estimation UI |

---

## Upstream References

| Pattern | Upstream Location |
|---------|-------------------|
| Bootstrap file defaults | `agents/workspace.ts:155+` — `ensureAgentWorkspace` |
| Model params from config | `pi-embedded-runner/extra-params.ts:178-220` — `applyExtraParamsToAgent` |
| Single system prompt path | `agents/system-prompt.ts` — `buildEmbeddedSystemPrompt` |
| Valid bootstrap names | `agents/workspace.ts:174-184` — `VALID_BOOTSTRAP_NAMES` |

---

## Iteration History

### Iteration 1 (2026-03-27) — Highest-Impact Fixes

**Gaps addressed:** F11-G01 through F11-G06

| Gap | Description | Status |
|-----|------------|--------|
| F11-G01 | Wire temperature + maxTokens to default participant | ✅ |
| F11-G02 | Add bootstrap defaults for SOUL.md + TOOLS.md | ✅ |
| F11-G03 | Remove phantom bootstrap files | ✅ |
| F11-G04 | Expand /init to scaffold SOUL.md + TOOLS.md | ✅ |
| F11-G05 | Fix token status bar to use OpenClaw prompt report | ✅ |
| F11-G06 | Remove dead runtime selector config | ✅ |

**Tests added:** 0 new (existing tests updated for new bootstrap defaults behavior)  
**Verification:** ✅ 0 TypeScript errors, 134 test files, 2547 tests, 0 failures  
**UX Guardian:** ✅ PASS — all 6 checks clean

### Iteration 2 (2026-03-27) — Wire autoRag + Mark Dead Fields

**Gaps addressed:** F11-G07 through F11-G09

| Gap | Description | Status |
|-----|------------|--------|
| F11-G07 | Wire autoRag toggle into context engine bootstrap | ✅ |
| F11-G08 | Remove dead chat.responseLength | DEFERRED — feeds legacy fallback |
| F11-G09 | Mark dead fields @deprecated (persona, suggestions, agent, memory, contextBudget) | ✅ |

**Tests added:** 0 new  
**Verification:** ✅ 0 TypeScript errors, 134 test files, 2547 tests, 0 failures  
**UX Guardian:** Not required (deprecation annotations + additive wiring only)

### Iteration 3 (2026-03-27) — Confirmation Audit

**Result:** 7 ALIGNED, 9 ACCEPTABLE, 0 NEEDS WORK → **DOMAIN CLOSED**

All dead/legacy code is clearly marked with `@deprecated F11` annotations.
No hidden dead knobs remain. All consumed config fields flow end-to-end.

**Deferred items (documented, non-blocking):**
- Dead persona UI section → UI cleanup sprint
- Dead agent knobs (verbosity/approval/execution/proactivity) → wire when agent behavior designed
- Dead memory fields (autoSummarize, evictionDays) → wire when memory eviction implemented
- Dead AISettingsService class → delete at convenience
- Preset rebuild → vary consumed fields only

---

## Final Summary

**Domain F11: AI Configuration Surface — CLOSED ✅**

| Metric | Value |
|--------|-------|
| Total capabilities | 16 |
| ALIGNED | 7 (C2, C3, C5, C6, C9, C12, C16) |
| ACCEPTABLE | 9 (C1, C4, C7, C8, C10, C11, C13, C14, C15) |
| NEEDS WORK | 0 |
| Iterations | 3 |
| Gaps fixed | 8 (G01–G07, G09) |
| Gaps deferred | 1 (G08) |
| Tests | 134 files, 2547 tests, 0 failures |
| TypeScript errors | 0 |
