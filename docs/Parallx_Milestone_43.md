# Milestone 43 — Reliability & Completeness Hardening

**Status:** Plan Approved  
**Branch:** `m43-reliability-hardening`  
**Depends on:** Milestone 42 (commit `26d45b7` on `m42-surface-adapt-discover`)  
**Source:** `docs/DEEP_AUDIT_GAP_ANALYSIS.md`

---

## Vision

Per M41 Principle P1: *"We are building a framework, not solving individual problems."*

This milestone closes every non-Parallx-specific gap identified in the deep audit. The goal is a robust, stable, broad-purpose AI framework within Parallx — one where:

- Errors are never silent (the user always knows what happened)
- Context is always managed (conversations never silently overflow)
- Tools are always validated (malformed calls are caught, not swallowed)
- The system self-heals (auto-compact, re-budget, retry on transient failure)
- Features are complete (no stubs pretending to be wired)

Per M41 Principle P5: *"No deterministic solutions."* Every fix targets the system/framework, not a specific query. Per P6: *"Do NOT invent custom patterns when the upstream has a proven approach."*

---

## Scope — 15 Gaps Across 5 Phases

All 5 🔴 CRITICAL + all 10 🟡 PARITY gaps from the deep audit. Zero 🟢 PARALLX or ⚪ SKIP items.

---

## Phase 1 — Stream & Tool Reliability

**Goal:** No silent failures. Every error is visible to the user.

| # | Gap | What to Build | Files | Effort |
|---|-----|--------------|-------|--------|
| 1.1 | Malformed tool JSON silent drop | Validate tool call JSON after parse. If malformed, emit a user-visible error chunk (`[Tool call error: ...]`) instead of silently dropping. Log full error for debugging. | `src/api/ollamaProvider.ts` | S |
| 1.5 | Stream drop = silent incomplete | Detect stream termination without `done: true` final chunk. Append `[Response interrupted — connection lost]` indicator to response. Offer retry button in chat UI. | `src/api/ollamaProvider.ts`, `src/built-in/chat/main.ts` | S |
| 2.10 | Thinking tag state leaks on model switch | Reset `_inThinkTag`, clear `_noThinkModels` cache when `setActiveModel()` is called. | `src/api/ollamaProvider.ts`, `src/services/languageModelsService.ts` | S |

**Verification:** Unit tests for malformed JSON handling, stream drop detection, and model switch state reset.

---

## Phase 2 — Context Budget Enforcement

**Goal:** Context never silently overflows. Budget is enforced pre-flight and mid-loop.

| # | Gap | What to Build | Files | Effort |
|---|-----|--------------|-------|--------|
| 1.3 | No auto-compact trigger | Before each turn, check if assembled token count > 80% of budget. If so, auto-invoke `compact()` before sending to model. Log compaction event. | `src/openclaw/openclawTurnRunner.ts`, `src/openclaw/openclawContextEngine.ts` | M |
| 1.4 | No mid-stream overflow detection | After each tool result append in the tool loop, re-estimate total token count. If exceeding budget, compact before next model call in the loop. | `src/openclaw/openclawAttempt.ts`, `src/openclaw/openclawTokenBudget.ts` | M |
| 2.7 | Token budget pre-flight only | Extend `TokenBudgetService.allocate()` to accept a `usedTokens` parameter for mid-loop re-allocation. Tool loop calls re-allocate after each tool result. | `src/services/tokenBudgetService.ts`, `src/openclaw/openclawAttempt.ts` | M |

**Verification:** Test that conversation exceeding context window triggers auto-compact. Test that 3+ sequential tool calls re-budget correctly.

---

## Phase 3 — Evidence & Retrieval Completeness

**Goal:** Evidence assessment and re-retrieval actually work — no more stubs.

| # | Gap | What to Build | Files | Effort |
|---|-----|--------------|-------|--------|
| 1.2 | Evidence assessment stubs | Implement `assessEvidence()`: score retrieved context against the query using keyword overlap + source coverage heuristic. Return `sufficient` / `insufficient` with reasons. Implement `buildEvidenceConstraint()`: generate a system prompt addendum telling the model what evidence is missing. | `src/openclaw/openclawResponseValidation.ts`, `src/openclaw/openclawContextEngine.ts` | M |
| 2.6 | Variable resolution not integrated | Call `chatVariableService.resolveVariables()` during turn preprocessing. Merge resolved variable content into the context engine's assembled messages. Support `#file:path` as first-class variable alongside mention resolution. | `src/openclaw/openclawTurnPreprocessing.ts`, `src/services/chatVariableService.ts` | M |
| 2.1 | No #activeFile implicit context | Add `#activeFile` variable: resolves to the currently-focused canvas document's content. Register in `chatVariableService`. Auto-inject when user's message references "this document" / "this page" without explicit `#file`. | `src/services/chatVariableService.ts`, `src/openclaw/openclawTurnPreprocessing.ts` | S |

**Verification:** Test evidence assessment triggers re-retrieval on thin context. Test `#activeFile` resolves correctly. Test `#file:path` works through variable resolution.

---

## Phase 4 — Approval & Permission Wiring

**Goal:** Approval system fully functional — config drives behavior, decisions are logged.

| # | Gap | What to Build | Files | Effort |
|---|-----|--------------|-------|--------|
| 2.8 | Approval strictness not wired | Read `approval.strictness` from AI config. Wire to `permissionService.checkPermission()`: `always-ask` → always prompt, `trust-reads` → auto-allow read tools, `trust-all` → auto-allow everything. | `src/services/permissionService.ts`, `src/aiSettings/` | S |
| 2.9 | No approval audit log | Add `_approvalLog: Array<{tool, decision, timestamp}>` to `permissionService`. Append on every approval decision. Expose via `getApprovalLog(sessionId)` for debugging/transparency. | `src/services/permissionService.ts` | S |
| 2.3 | No slash command registry | Create `ISlashCommandRegistry` interface with `register(command, handler)` and `resolve(input)`. Migrate `/init`, `/context`, `/compact` to registered commands. Built-in commands register at startup; workspace can add custom commands via `.parallx/commands/`. | `src/services/chatAgentService.ts` (or new `slashCommandRegistry.ts`) | M |

**Verification:** Test approval strictness modes. Test audit log records decisions. Test slash command registration and dispatch.

---

## Phase 5 — Discoverability & UX Polish

**Goal:** The AI is approachable — followup suggestions, edit mode wired, semantic search.

| # | Gap | What to Build | Files | Effort |
|---|-----|--------------|-------|--------|
| 2.2 | No followup suggestions | After each assistant response, generate 2-3 followup suggestions via a lightweight model call (or extract from response). Render as clickable chips below the response. | `src/openclaw/openclawTurnRunner.ts`, `src/built-in/chat/main.ts` | M |
| 2.5 | Edit mode not wired | When Edit mode is active, AI responses that contain document modifications are sent to canvas as tracked-change suggestions (insertions highlighted, deletions struck). User accepts/rejects inline. | `src/services/chatModeService.ts`, `src/built-in/chat/main.ts`, canvas integration | L |
| 2.4 | Semantic session search | Replace substring stub in `chatService.searchSessions()` with embedding-based search: embed query via nomic-embed-text, compare against session embeddings (compute on session close/compact), return ranked results. | `src/services/chatService.ts`, `src/services/embeddingService.ts` | L |

**Verification:** Test followup suggestions render and are clickable. Test Edit mode produces tracked changes in canvas. Test semantic search returns relevant sessions.

---

## Phase Execution Order & Dependencies

```
Phase 1 (Stream & Tool Reliability)
  └─ no dependencies, pure bug fixes
Phase 2 (Context Budget Enforcement)  
  └─ depends on Phase 1 (stream reliability needed for stable tool loop)
Phase 3 (Evidence & Retrieval)
  └─ depends on Phase 2 (budget enforcement needed for re-retrieval budget)
Phase 4 (Approval & Permissions)
  └─ independent of Phase 2/3, can overlap
Phase 5 (Discoverability & UX)
  └─ depends on Phase 3 (followups use response context), Phase 4 (edit mode uses approval)
```

---

## Success Criteria

- [ ] 0 compile errors
- [ ] All existing 2,446 tests still pass
- [ ] New tests for each phase (target: 15+ new test cases)
- [ ] No silent failures — every error path has a user-visible indicator
- [ ] Auto-compact triggers on overflow without user intervention
- [ ] Tool loop re-budgets and never exceeds context window
- [ ] Evidence assessment returns real scores (not stub defaults)
- [ ] Approval strictness config actually controls approval behavior  
- [ ] Followup suggestions appear after AI responses
- [ ] Edit mode produces tracked changes in canvas

---

## Estimated Scope

| Phase | Files Modified | Lines Changed (est.) | New Tests |
|-------|---------------|---------------------|-----------|
| 1 | 3 | ~80 | 3 |
| 2 | 4 | ~200 | 3 |
| 3 | 3 | ~180 | 4 |
| 4 | 3 | ~150 | 3 |
| 5 | 4 | ~350 | 3+ |
| **Total** | **~12 unique files** | **~960 lines** | **16+** |
