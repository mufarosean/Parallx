# F5 Routing Architecture — Iteration 2 DEEP Refinement Audit

**Domain:** F5 — Routing Architecture  
**Iteration:** 2 (deep re-audit, supersedes rubber-stamped R2)  
**Date:** 2026-03-27  
**Auditor:** AI Parity Auditor  

---

## Summary

| Metric | Count |
|--------|-------|
| Total findings | 12 |
| ALIGNED | 6 |
| MISALIGNED | 4 |
| ACCEPTED | 2 |

**Verdict:** Previous R2 was a rubber-stamp ("12 files audited, 11 CLEAN, 1 LOW"). This deep audit found **4 real MISALIGNED findings**, including one security concern that the prior pass missed entirely.

---

## Per-Finding Details

### Finding F5-R2-01: Old regex routing leaks into OpenClaw traces via buildOpenclawTraceSeed

- **Classification:** MISALIGNED
- **File:** [openclawParticipantRuntime.ts](src/openclaw/participants/openclawParticipantRuntime.ts#L339-L371)
- **Issue:** `buildOpenclawTraceSeed()` reads `request.turnState.turnRoute` — which comes from the OLD regex-based `determineChatTurnRoute()` in `chatTurnRouter.ts`. Both workspace participant (L381) and canvas participant (L344) call this function. The old routing can produce `kind: 'conversational'` from regex patterns, which then propagates into `contextPlan.useRetrieval=false`, `useMemoryRecall`, and `useTranscriptRecall` fields in the trace data.
- **Impact:** Trace data reports incorrect routing classification. The actual behavior is correct (always grounded), but trace consumers see wrong `contextPlan` values. No behavioral divergence, but semantic corruption of observability data.
- **Severity:** MEDIUM
- **Fix:** `buildOpenclawTraceSeed` should NOT consume `request.turnState.turnRoute`. It should derive route from the participant's actual logic (always `kind: 'grounded'` for workspace/canvas) and ignore the chatService-injected turnState. Either:
  - (a) Remove the `request.turnState` read entirely, always use the `defaultReason` fallback.
  - (b) Construct its own route based on `request.command` (slash command = 'grounded', no command = 'grounded').

### Finding F5-R2-02: chatService._buildTurnState executes dead regex routing for OpenClaw turns

- **Classification:** MISALIGNED
- **File:** [chatService.ts](src/services/chatService.ts#L691-L730)
- **Issue:** `_buildTurnState()` is called for EVERY request (L951) before dispatching to any participant. It calls `analyzeChatTurnSemantics()` (full regex cascade: `CONVERSATIONAL_TURN_PATTERNS`, `WORKSPACE_ROUTING_TERMS`, greeting detection, memory recall detection, file enumeration detection) and `determineChatTurnRoute()`. OpenClaw participants ignore these results for actual routing, but:
  1. Computation is wasted on every turn.
  2. The old `IChatTurnSemantics` and `IChatTurnRoute` from the built-in path get attached to `request.turnState` and `request.interpretation.semantics`.
  3. This creates a split-brain: two different routing systems analyze the same input, producing potentially conflicting classifications.
- **Severity:** MEDIUM
- **Fix:** Two options:
  - (a) **Short-term:** Skip `_buildTurnState` when the resolved participant is an OpenClaw participant. Check `resolveChatRuntimeParticipantId` result before computing turnState.
  - (b) **Long-term:** Remove the old routing infrastructure entirely once all participants are on OpenClaw.

### Finding F5-R2-03: No path traversal validation in @file mention resolution

- **Classification:** MISALIGNED (SECURITY)
- **File:** [openclawTurnPreprocessing.ts](src/openclaw/openclawTurnPreprocessing.ts#L86-L95) → [chatDataService.ts](src/built-in/chat/data/chatDataService.ts#L1563-L1569)
- **Issue:** When `@file:../../etc/passwd` or `@file:../../../secret.txt` is used in a mention, `extractMentions()` extracts the path as-is and `resolveMentions()` passes it directly to `services.readFileRelative()`. The `readFileRelative()` implementation in `chatDataService.ts` (L1563) does NOT call `normalizeWorkspaceRelativePath()` — it passes the raw relative path to `fsAccessor.readFile()`.
  
  In contrast, `writeFileRelative()` (L1576) correctly calls `normalizeWorkspaceRelativePath()` which rejects `..` segments. The `readFileRelative` path is inconsistent.
  
  Note: The `fsAccessor` implementation may or may not constrain to workspace root — this depends on the underlying file service. But the defense-in-depth principle requires validation at the preprocessing layer.
- **Severity:** HIGH
- **Fix:** Either:
  - (a) Add `normalizeWorkspaceRelativePath()` call in `readFileRelative()` before delegating to fsAccessor.
  - (b) Add path validation in `resolveMentions()` to reject `..` segments before calling any service (defense at the input boundary).
  - (c) Both (belt and suspenders).

### Finding F5-R2-04: No unit tests for openclawTurnPreprocessing.ts

- **Classification:** MISALIGNED
- **File:** No test file exists for `src/openclaw/openclawTurnPreprocessing.ts`
- **Issue:** `extractMentions()`, `stripMentions()`, `resolveMentions()`, `resolveVariables()` have zero test coverage. These are input processing functions that handle user-controlled regex patterns and file I/O. Critical functions without tests:
  - Edge cases for `@file:"path with spaces"` vs `@file:path`
  - `@folder:` with budget limit (FOLDER_CHAR_BUDGET)
  - `@workspace` and `@terminal` mention types
  - `#file:` and `#activeFile` variable resolution
  - Error handling paths (`.catch(() => null)`)
  - Path traversal attempts
- **Severity:** HIGH
- **Fix:** Create `tests/unit/openclawTurnPreprocessing.test.ts` with coverage for:
  1. Mention extraction (all 4 kinds)
  2. Mention stripping (preserve text, handle overlaps)
  3. Variable resolution (#file, #activeFile)
  4. Error resilience (service failures)
  5. Path traversal rejection (once F5-R2-03 is fixed)

### Finding F5-R2-05: openclawTypes.ts — route types clean

- **Classification:** ALIGNED
- **File:** [openclawTypes.ts](src/openclaw/openclawTypes.ts#L94)
- **Evidence:** `IChatTurnRoute.kind: 'memory-recall' | 'transcript-recall' | 'grounded' | string` — stale values `conversational`, `product-semantics`, `off-topic` all removed by iteration 1.

### Finding F5-R2-06: Default participant routing — clean model-first path

- **Classification:** ALIGNED
- **File:** [openclawDefaultParticipant.ts](src/openclaw/participants/openclawDefaultParticipant.ts#L68-L175)
- **Evidence:** Turn flow is:
  1. Slash command check (`/init`, `/context`, `/compact`) — structural early exit.
  2. Mention resolution → variable resolution → prompt overlay — input processing only.
  3. `buildOpenclawTurnContext()` → fresh context engine → token budget → tool policy.
  4. `runOpenclawTurn()` → model call.
  
  No regex pre-classification, no intent detection, no hidden branches. Clean.

### Finding F5-R2-07: Workspace participant routing — clean structural dispatch

- **Classification:** ALIGNED
- **File:** [openclawWorkspaceParticipant.ts](src/openclaw/participants/openclawWorkspaceParticipant.ts#L62-L72)
- **Evidence:** Routing is purely by slash command (`/list`, `/search`, `/summarize`, default). Each handler gathers context and delegates to `runWorkspacePromptTurn()` which builds system prompt and calls model. No regex intent classification.

### Finding F5-R2-08: Canvas participant routing — clean structural dispatch

- **Classification:** ALIGNED
- **File:** [openclawCanvasParticipant.ts](src/openclaw/participants/openclawCanvasParticipant.ts#L60-L68)
- **Evidence:** Same pattern as workspace: slash command dispatch (`/describe`, `/blocks`, default) → gather context → model call. No hidden routing logic.

### Finding F5-R2-09: Mention/variable processing — legitimate structural input resolution

- **Classification:** ALIGNED
- **File:** [openclawTurnPreprocessing.ts](src/openclaw/openclawTurnPreprocessing.ts)
- **Evidence:** The regex patterns (`MENTION_RE`, `VARIABLE_FILE_RE`, `VARIABLE_ACTIVEFILE_RE`) are structural extraction patterns for `@file:`, `@folder:`, `@workspace`, `@terminal`, `#file:`, `#activeFile` tokens. They resolve content (file reads, terminal output) and inject into context blocks. This is input materialization, not intent routing. Upstream OpenClaw has equivalent mention resolution in its agent input pipeline.

### Finding F5-R2-10: Error handling in preprocessing — silent swallow pattern

- **Classification:** ACCEPTED
- **File:** [openclawTurnPreprocessing.ts](src/openclaw/openclawTurnPreprocessing.ts#L86-L150)
- **Issue:** All file read and service calls use `.catch(() => null)` or `.catch(() => [])`. Failures are silently swallowed — no logging, no UI feedback, no warning. If `@file:claims.md` silently fails to resolve, the user sees no indication that their mention was ineffective.
- **Severity:** LOW
- **Rationale for ACCEPTED:** Resilience-first design is reasonable for preprocessing — crashing the turn because one mention failed to resolve would be worse. However, adding a `console.warn` or reporting a diagnostic pill (e.g., "⚠️ Could not read claims.md") would improve UX. Not a routing issue, not a parity gap.

### Finding F5-R2-11: assessEvidence heuristic regex in responseValidation

- **Classification:** ACCEPTED
- **File:** [openclawResponseValidation.ts](src/openclaw/openclawResponseValidation.ts#L110-L145)
- **Issue:** `assessEvidence()` uses regex patterns to detect "hard" queries (`/\b(and|then|after|compare|versus|vs\.?|workflow|steps)\b/i`) and keyword overlap matching. This is heuristic.
- **Severity:** LOW
- **Rationale for ACCEPTED:** The function header explicitly documents it as a Parallx adaptation for INPUT shaping — it produces a quality signal that gets injected into the system prompt via `buildEvidenceConstraint()`. It does NOT route turns, does NOT modify model output, and does NOT bypass the model. The comment: *"This is used as an INPUT shaping signal in the context engine's assemble() method."* The upstream rationale is documented. Acceptable Parallx-specific adaptation.

### Finding F5-R2-12: No heuristic-absence tests

- **Classification:** MISALIGNED
- **File:** No dedicated test exists
- **Issue:** There are no tests that verify the ABSENCE of routing heuristics — i.e., tests that confirm the OpenClaw default participant does NOT pre-classify input before the model call. This makes regressions easy to introduce. A future developer could add a regex check before the model call and no test would catch it.
- **Severity:** LOW
- **Fix:** Add a test to `openclawDefaultParticipant.test.ts` that verifies:
  1. The participant calls `runOpenclawTurn()` for any input text without pre-filtering.
  2. Arbitrary input strings (greetings, off-topic, domain-specific) all reach the model call.
  3. No `turnState.turnRoute` or `IChatTurnSemantics` is consumed for behavioral decisions.

---

## Cross-Domain Observations (informational, not scored)

### chatTurnSemantics.ts + chatTurnRouter.ts — old infrastructure alive

These files in `src/built-in/chat/utilities/` contain the full regex routing cascade:
- `CONVERSATIONAL_TURN_PATTERNS` (6+ patterns)
- `WORKSPACE_ROUTING_TERMS`, `TASK_ROUTING_TERMS`
- Greeting detection, social follow-up detection
- Memory recall regex, transcript recall regex, file enumeration regex

They run on every turn through `chatService._buildTurnState()`. OpenClaw ignores the results for behavior, but they remain as technical debt. Removal is tracked in F5-R2-02.

### Context engine maintain() patterns — not routing

`openclawContextEngine.ts` maintain() uses several regex patterns:
- `ackPattern` for removing redundant acknowledgments
- `[Context summary]` startsWith check for deduplication
- Tool result detection via `.includes('```tool-result')`

These are context history management, not routing. Correctly scoped to F2/F8.

### Error classification patterns — not routing

`openclawErrorClassification.ts` regex patterns detect Ollama errors (context overflow, transient, timeout). This is L2 execution pipeline error handling, not routing. Correctly scoped to F1.

---

## Recommended Changes (priority order)

| Priority | Finding | Severity | Effort |
|----------|---------|----------|--------|
| 1 | F5-R2-03: Path traversal in readFileRelative | HIGH (security) | Small — add normalizeWorkspaceRelativePath call |
| 2 | F5-R2-04: Create preprocessing tests | HIGH | Medium — ~20 test cases |
| 3 | F5-R2-01: Fix buildOpenclawTraceSeed | MEDIUM | Small — remove turnState read |
| 4 | F5-R2-02: Skip old routing for OpenClaw turns | MEDIUM | Medium — conditional in chatService |
| 5 | F5-R2-12: Add heuristic-absence tests | LOW | Small — 3-4 test cases |
