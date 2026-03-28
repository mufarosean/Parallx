# F11: AI Configuration Surface — Domain Tracker

**Domain:** F11 — AI Configuration Surface  
**Status:** ✅ CLOSED (R3)  
**Started:** 2026-03-27  
**Re-opened:** 2026-03-27  
**Closed:** 2026-03-27  
**Owner:** Parity Orchestrator  

---

## Scorecard

| ID | Setting | Iter-1 | Iter-2 | R3 Re-Audit | Final |
|----|---------|--------|--------|-------------|-------|
| S1 | Temperature | ✅ G01 | — | **ALIGNED** | ✅ ALIGNED |
| S2 | Max Response Tokens | ✅ G01 | — | **ALIGNED** | ✅ ALIGNED |
| S3 | Auto RAG | — | ✅ G07 | **INVENTION** (LOW) | ✅ Documented `@parallx-specific` (G03) |
| S4 | Decomposition Mode | — | — | **INVENTION** (MEDIUM) | ✅ Documented `@parallx-specific` (G03) |
| S5 | Candidate Breadth | — | — | **INVENTION** (MEDIUM) | ✅ Documented `@parallx-specific` (G03) |
| S6 | Top K Results | — | — | **INVENTION** (MEDIUM) | ✅ Documented `@parallx-specific` (G03) |
| S7 | Max Per Source | — | — | **INVENTION** (MEDIUM) | ✅ Documented `@parallx-specific` (G03) |
| S8 | Token Budget | — | — | **INVENTION** (MEDIUM) | ✅ Documented `@parallx-specific` (G03) |
| S9 | Score Threshold | — | — | **INVENTION** (MEDIUM) | ✅ Documented `@parallx-specific` (G03) |
| S10 | Max Iterations | — | — | **INVENTION** (HIGH) | ✅ Floor guard [4,6] (G04) |
| S11 | Default Model | — | — | **DEAD** (HIGH) | ✅ UI removed (G01) |
| S12 | Context Window | — | — | **DEAD** (MEDIUM) | ✅ UI removed (G01) |
| S13 | Embedding Model | — | — | **DEAD** (LOW) | ✅ Field `@deprecated` (G06) |
| S14 | Indexing Section | — | — | **DEAD** (MEDIUM) | ✅ Section removed (G02) |
| S15 | Workspace Description | — | — | **INVENTION** (LOW) | ✅ Documented `@parallx-specific` (G03) |
| S16 | Tools Enablement | — | — | **ALIGNED** | ✅ ALIGNED |

### R3 Summary (Post-Execution)

| Classification | Count |
|---------------|-------|
| ALIGNED (native) | 3 (S1, S2, S16) |
| ALIGNED (invention documented) | 8 (S3-S9, S15) |
| ALIGNED (hardened) | 1 (S10) |
| ALIGNED (removed/deprecated) | 4 (S11-S14) |
| **Total ALIGNED** | **16/16** |

### R3 Actions Taken
- **G01:** Removed Default Model + Context Window from ModelSection (4→2 rows)
- **G02:** Removed IndexingSection from panel (8→7 sections)
- **G03:** 9 INVENTION fields annotated `@parallx-specific` in `unifiedConfigTypes.ts`
- **G04:** Added `OPENCLAW_MIN_AGENT_ITERATIONS = 4` floor guard in `openclawDefaultParticipant.ts`
- **G05:** Updated `aiSettingsPanel.test.ts` for new counts
- **G06:** 3 dead model fields marked `@deprecated F11-R3` in `unifiedConfigTypes.ts`

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

**Result:** 7 ALIGNED, 9 ACCEPTABLE, 0 NEEDS WORK → **DOMAIN CLOSED (pre-R3)**

---

### R3 Re-Audit (2026-03-27) — User-Initiated Deep Upstream Tracing

**Trigger:** User challenged whether live settings truly align with upstream OpenClaw patterns.

**Audit Result (R3 Iter-1):**
- 3 ALIGNED (S1, S2, S16)
- 8 INVENTION (S3-S10, S15) — Parallx-specific with no upstream equivalent
- 4 DEAD (S11-S14) — UI not connected to runtime
- 0 MISALIGNED

**Gap Map (R3):** 6 change plans (G01-G06)

| Gap | Description | Status |
|-----|------------|--------|
| R3-G01 | Remove Default Model + Context Window from ModelSection UI | ✅ |
| R3-G02 | Remove IndexingSection from panel | ✅ |
| R3-G03 | Document 9 INVENTION fields with `@parallx-specific` | ✅ |
| R3-G04 | Add MIN_AGENT_ITERATIONS = 4 floor guard | ✅ |
| R3-G05 | Update tests for new counts | ✅ |
| R3-G06 | Mark 3 dead model fields `@deprecated` | ✅ |

**Verification:** ✅ 0 TypeScript errors, 134 test files, 2538 tests, 0 failures  
**UX Guardian:** ✅ PASS — 8/8 surfaces OK  
**R3 Iter-2 Re-Audit:** 16/16 ALIGNED, 0 remaining gaps  
**R3 Iter-3 Confirmation:** Domain ready for closure

---

## Final Summary

**Domain F11: AI Configuration Surface — CLOSED ✅ (R3)**

| Metric | Value |
|--------|-------|
| Total capabilities | 16 |
| ALIGNED (native) | 3 (S1, S2, S16) |
| ALIGNED (invention documented) | 8 (S3-S9, S15) |
| ALIGNED (hardened) | 1 (S10) |
| ALIGNED (removed/deprecated) | 4 (S11-S14) |
| **Total ALIGNED** | **16/16** |
| Iterations | 3 + R3 (3 sub-iterations) |
| R3 Gaps fixed | 6 (R3-G01 through R3-G06) |
| Tests | 134 files, 2538 tests, 0 failures |
| TypeScript errors | 0 |
