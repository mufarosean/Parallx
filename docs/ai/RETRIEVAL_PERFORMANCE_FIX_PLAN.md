# Retrieval Performance Fix Plan

**Date:** 2026-03-04  
**Branch:** milestone-15  
**Objective:** Make Parallx AI respond as fast and smart as native Ollama chat.

---

## Problem Statement

The AI in Parallx feels noticeably slower and dumber than the same model in native Ollama:

1. **Slow:** Time-to-first-token is 10-30+ seconds vs ~1s in Ollama
2. **Dumb:** Response quality is lower because irrelevant context drowns the signal
3. **Noisy sources:** 6/7 retrieved sources are completely irrelevant (derivatives, Nietzsche, insurance math when asking about Shona/Zimbabwe content)

## Root Cause Analysis

### Why it's slow — THREE serial LLM calls before the user sees a token:

```
User types message
  → Planner LLM call (classify intent, generate queries)    ~2-5s
    → Retrieval (vector + FTS5)                              ~200ms
      → Re-ranker: N separate LLM calls (one per chunk)     ~5-15s  ← THE KILLER
        → Main response LLM call (finally streams to user)   ~1s TTFT
```

The **re-ranker** is the single biggest latency problem. It calls the LLM once per candidate chunk (20-30 chunks due to 3× overfetch) with a per-call timeout of 8 seconds. Even at 200ms per call, that's 4-6 seconds of dead time. If any call is slow, the whole pipeline stalls.

### Why irrelevant sources survive:

- `DEFAULT_MIN_SCORE = 0.01` — an RRF score of 0.01 means ranked ~40th in a *single* retrieval path. This passes everything.
- The re-ranker is supposed to filter irrelevant chunks (drops below score 4/10), but when it fails or times out on a chunk, it gives `RERANK_MIN_RELEVANCE - 1 = 3` instead of dropping it — so failed scores still survive in the final list.
- FTS5 with OR semantics (from commit dcf2cdd) inflates candidate count by matching any single word.

## Fix Plan — 4 Changes

### Fix 1: Remove the per-chunk LLM re-ranking calls

**File:** `src/services/retrievalService.ts`  
**What:** Delete the N per-chunk LLM re-ranking calls entirely.  
**Why:** This is 20-30 hidden LLM calls serialized before the user sees anything. The planner already classifies intent and generates targeted queries — that IS the intelligence layer. Having a second LLM scoring pass on every chunk is redundant and slow. Native Ollama doesn't do this. Copilot doesn't do this. Nothing does per-chunk LLM re-ranking in real-time chat.  
**How:** Set `shouldRerank = false` unconditionally (disable `_rerankChunks` in the `retrieve()` pipeline). Keep the code for potential async/background use later.

### Fix 2: Raise minimum relevance score to filter garbage

**File:** `src/services/retrievalService.ts`  
**What:** Raise `DEFAULT_MIN_SCORE` from `0.01` to `0.15`.  
**Why:** RRF scoring with k=60: a score of 0.15 means the chunk ranked in the top ~7 in at least one retrieval path (vector or keyword). 0.01 lets through rank-40+ results that are noise. 0.15 is still permissive enough to not miss relevant results — it just filters obvious garbage.  
**Calculation:** RRF score = 1/(k + rank + 1). For k=60, rank=0 → 1/61 ≈ 0.0164. Two-path fusion doubles this to ~0.033 for a top-1 result in one path. 0.15 corresponds to a rank-0 result in both paths or top-3 in one path with modest contribution from the other. This is a good balance.  
**Revised calculation:** Actually, RRF merges two lists. A chunk at rank 0 in both vector and keyword gets: 1/61 + 1/61 ≈ 0.033. So 0.15 is too high — that would filter even the best results. The correct threshold is **0.02** — filters chunks that ranked worse than ~50th in both paths.

### Fix 3: Revert the blocking `getModelInfo()` in `sendChatRequest`

**File:** `src/built-in/chat/providers/ollamaProvider.ts`  
**What:** Remove the inline `await getModelInfo()` I added in commit 6568cb3. The pre-warming in `_pollLoadedModels()` (also from that commit) already handles cache warming asynchronously. The inline call blocks every single LLM call (planner, re-ranker, main response) with a ~100ms network round-trip to `/api/show`.  
**How:** Restore the original non-blocking cache-only lookup. Keep the pre-warming.

### Fix 4: Reduce overfetch factor (since no re-ranker)

**File:** `src/services/retrievalService.ts`  
**What:** With re-ranking disabled, reduce the overfetch factor from 3 to 1.5.  
**Why:** Without re-ranking, we don't need 3× candidates. 1.5× gives enough slack for score-threshold and dedup filtering without pulling in 30 candidates.

## Expected Result After Fixes

```
User types message
  → Planner LLM call (intent + queries)     ~2-3s (same as before)
    → Retrieval (vector + FTS5)              ~200ms
      → Score threshold 0.02 (instant)       ~0ms
        → Main response (streams to user)     ~1s TTFT
```

Total time-to-first-token: ~3-4s (down from 10-30+s)

Irrelevant sources like "derivatives_markets" will be filtered out because their RRF score against "Shona vocabulary" queries will be well below 0.02.

## Verification

- [ ] `tsc --noEmit` clean
- [ ] All 1747 tests pass
- [ ] Manual test: "Hi, how are you?" → fast conversational response, no RAG
- [ ] Manual test: "Talk to me about my books on Shona" → only Zimbabwe/Shona sources, fast response

---

## Changes NOT Made (and why)

- **Context window caps:** User explicitly vetoed this.
- **Disabling thinking/reasoning:** The model should think — that's what it's for.
- **Removing the planner:** The planner is the AI's thinking layer; it adds ~2-3s but the intelligence gain is worth it.
- **Caps on page/memory context:** Already applied in commit 6568cb3, verified safe (input-side only, can't cause mid-response stops).
