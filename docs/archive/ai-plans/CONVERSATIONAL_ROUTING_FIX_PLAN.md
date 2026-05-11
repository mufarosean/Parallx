# Conversational Routing Fix Plan

**Date:** 2026-03-08  
**Status:** Implemented initial routing fix  
**Scope:** Make new chat sessions feel like a clean slate for casual conversation while preserving grounded workspace behavior for real knowledge and task turns.

---

## Problem

Brand-new sessions currently have empty visible history, but the first turn is still assembled with multiple automatic context layers:

1. workspace retrieval from indexed files and PDFs,
2. cross-session memory recall,
3. concept recall,
4. current-page injection,
5. workspace digest and workspace description in the system prompt.

That behavior is acceptable for explicit workspace questions, but it produces bad results for low-signal conversational turns like:

- "hello"
- "how's it going"
- "who are you"
- "thanks"

Observed failure mode:

1. a short conversational turn still triggers retrieval,
2. retrieved PDF excerpts dominate the model context,
3. the model answers as if the user pasted or asked about those excerpts,
4. the fallback citation footer adds a visible `Sources:` list,
5. the user experiences a "new session" that does not feel new.

---

## Desired Behavior

### New session expectations

A new session should always start with:

- no prior session history,
- no automatic carry-over from previous conversations unless the new turn is clearly asking for prior-work context,
- no retrieval or citation noise for simple conversational turns.

### Conversational routing expectations

For obviously conversational or phatic turns:

- do not run workspace retrieval,
- do not recall cross-session memory,
- do not recall concepts,
- do not append source footers,
- do not send tools when they are not needed,
- keep the reply natural and conversational.

For explicit workspace questions and tasks:

- preserve the current grounded behavior,
- keep retrieval, memory, citations, and tools available as appropriate.

---

## Root Cause

The current participant path defaults to grounded retrieval behavior for almost every normal turn:

1. `retrievalPlan.needsRetrieval` is synthesized as `isRagReady && !hasActiveSlashCommand`.
2. memory and concept recall are gated off `needsRetrieval !== false`, so they also run for the same turns.
3. `isConversational` is hardcoded to `false`, so tools remain eligible.
4. the citation footer is appended whenever retrieved sources exist and the model did not visibly cite them.

This means a new session is only a clean slate for visible history, not for the assembled prompt.

---

## Fix Strategy

### Phase 1: Add explicit conversational-turn detection

Introduce a lightweight, deterministic classifier for low-risk conversational turns:

- greetings,
- brief social check-ins,
- identity questions,
- acknowledgements and thanks,
- short non-workspace chit-chat.

This classifier should be narrow and conservative. If uncertain, fall back to the existing grounded path.

### Phase 2: Gate automatic context for conversational turns

When the current turn is classified as conversational:

- set `retrievalPlan.intent = 'conversational'`,
- set `retrievalPlan.needsRetrieval = false`,
- skip `retrieveContext(...)`,
- skip `recallMemories(...)`,
- skip `recallConcepts(...)`,
- suppress retrieval-thought UI,
- set `isConversational = true` so tools are not sent.

Current-page injection may remain for now if needed elsewhere, but the initial goal is to stop workspace-wide RAG and cross-session memory from contaminating casual chat.

### Phase 3: Suppress citation footers for conversational replies

Even if a conversational turn somehow accumulates sources later in the pipeline, the fallback `Sources:` footer should not be appended for the conversational branch.

### Phase 4: Validate with new-session tests

Add focused unit coverage for:

1. `hello` in a brand-new session,
2. `how's it going` in a brand-new session,
3. `who are you` in a brand-new session,
4. a real workspace question still using retrieval,
5. citation footer behavior remaining unchanged for grounded answers.

---

## Implementation Notes

Files expected to change:

- `src/built-in/chat/participants/defaultParticipant.ts`
- `tests/unit/chatService.test.ts`

Potential follow-up work after this first slice:

1. add a user-facing setting for cross-session memory recall,
2. add planner-backed intent routing instead of heuristic routing,
3. decide whether current-page injection should also be skipped for conversational turns,
4. distinguish "workspace memory" from "conversation memory" more clearly in product language.

---

## Acceptance Criteria

- [x] A new session plus `hello` does not trigger retrieval or source footers.
- [x] A new session plus `how's it going` is covered by the same conversational-turn gate.
- [x] A new session plus `who are you` routes through the conversational branch without workspace retrieval.
- [x] Explicit workspace questions still use retrieval and citations as before.
- [x] Existing grounded-answer tests continue to pass.

## Verification

- Focused test run: `npx vitest run tests/unit/chatService.test.ts`
- Full build: `npm run build`

## Implemented Slice

The initial fix landed in:

- `src/built-in/chat/participants/defaultParticipant.ts`
- `tests/unit/chatService.test.ts`

Behavior now changed for narrow conversational turns:

- retrieval is skipped,
- cross-session memory recall is skipped,
- concept recall is skipped,
- current-page injection is skipped,
- tools are not sent,
- fallback source footers are suppressed.

This is intentionally conservative. Explicit workspace questions still use the grounded path unchanged.