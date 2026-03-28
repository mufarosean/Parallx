# F8 — Context Engine / Memory — Iteration 2 Gap Map

**Gap Mapper:** AI Senior Architect  
**Date:** 2026-03-27  
**Domain:** F8 — Context Engine / Memory  
**Input:** F8 Iteration 1 audit (`docs/F8_CONTEXT_ENGINE_MEMORY_AUDIT.md`)  
**Upstream baseline:** OpenClaw commit e635cedb  

---

## Change Plan Overview

| Gap ID | Severity | Status | Summary | Dependency |
|--------|----------|--------|---------|------------|
| F8-3 | HIGH | MISALIGNED → ALIGNED | RAG content delivered via messages, not systemPromptAddition | None (do first) |
| F8-5 | MEDIUM | MISALIGNED → ALIGNED | Sub-lane budgets normalized to 100% with aggregate cap | Depends on F8-3 |
| F8-15 | HIGH | MISSING → ALIGNED | Unit test suite for context engine | Depends on F8-3 + F8-5 |

**Dependency order:** F8-3 → F8-5 → F8-15

---

## Change Plan: F8-3 — RAG Content Delivery Channel

### F8-3: assemble() builds messages under token budget
- **Status**: MISALIGNED → ALIGNED
- **Upstream**: `context-engine/types.ts` lines 104-230 — `AssembleResult = { messages: AgentMessage[]; estimatedTokens: number; systemPromptAddition?: string }`; `attempt.context-engine-helpers.ts` — `assembleAttemptContextEngine` passes assembled messages directly to the agent session
- **Parallx file**: `src/openclaw/openclawContextEngine.ts` (assemble method, lines 162-295), `src/openclaw/openclawAttempt.ts` (lines 167-190), `src/openclaw/openclawSystemPrompt.ts` (line 105-107)
- **Action**: Restructure `assemble()` to deliver RAG content via `messages` array instead of `systemPromptAddition`. Remove system prompt truncation from attempt layer.

### What's wrong now

1. **Context engine** (`openclawContextEngine.ts` lines 200-280): All retrieval results (RAG text, memory, concepts, transcripts, page content) are accumulated into a single `systemPromptAddition` string
2. **System prompt builder** (`openclawSystemPrompt.ts` lines 105-107): `systemPromptAddition` is concatenated into the system prompt alongside identity, skills, tools, workspace digest, preferences, overlay
3. **Attempt layer** (`openclawAttempt.ts` line 167): `const systemBudget = Math.floor(context.tokenBudget * 0.10)` — truncates the ENTIRE system prompt (now containing RAG) to 10% of context window
4. **Net effect**: For 8192-token context: system prompt gets ~819 tokens. After identity, skills, tools, workspace digest, preferences, behavioral rules — RAG gets maybe ~200 tokens. The 30% (~2457 tokens) RAG budget is wasted.

### Upstream pattern

In upstream OpenClaw, `AssembleResult.messages` is the primary delivery channel for context. The `systemPromptAddition` field is documented as an optional lightweight addition — metadata, constraints, page headers — NOT bulk retrieval content. The context engine assembles messages to fit within the token budget it was given. The attempt layer does NOT re-truncate assembled content.

From `context-engine/types.ts`:
```typescript
type AssembleResult = {
  messages: AgentMessage[];       // ← Primary context delivery
  estimatedTokens: number;
  systemPromptAddition?: string;  // ← Lightweight metadata only
};
```

From `attempt.ts` control flow (step 12-13): assembled messages are fed directly to the agent session. The system prompt is built separately via `buildEmbeddedSystemPrompt` and is NOT re-truncated after assembly — size is managed by bootstrap budget limits (`agents.defaults.bootstrapMaxChars`).

### Changes required

#### File 1: `src/openclaw/openclawContextEngine.ts` — assemble() method

**Lines 196-280** — Restructure retrieval content delivery:

**REMOVE**: All code that appends retrieval content to `systemPromptAddition`:
- Line 197: `systemPromptAddition = \`${pageHeader}\n${pageResult.textContent}\``
- Line 209: `systemPromptAddition = (systemPromptAddition ?? '') + \`\n\n## Retrieved Context\n${contextText}\``
- Line 221-222: Memory appended to `systemPromptAddition`
- Line 230-231: Concepts appended to `systemPromptAddition`
- Line 239-240: Transcripts appended to `systemPromptAddition`
- Line 260-263: Re-retrieval merged via `systemPromptAddition` regex replace

**ADD**: Build context messages in the `messages` array instead:

1. After all parallel retrieval completes, build a single context injection message:
   ```typescript
   // Build context message from retrieval results
   const contextSections: string[] = [];
   let contextTokensUsed = 0;
   ```

2. For each retrieval lane, append to `contextSections` under budget:
   - Page content (capped at its sub-lane budget)
   - RAG text (already capped at `budget.rag`)
   - Memory (capped at its sub-lane budget)
   - Concepts (capped at its sub-lane budget)
   - Transcripts (capped at its sub-lane budget)

3. Apply aggregate cap: total `contextSections` tokens must not exceed `budget.rag`

4. Inject as a user-role message at the HEAD of the messages array (before history):
   ```typescript
   if (contextSections.length > 0) {
     const contextContent = contextSections.join('\n\n');
     messages.unshift({
       role: 'user' as const,
       content: `[Retrieved context for this conversation]\n\n${contextContent}`,
     });
   }
   ```

5. `systemPromptAddition` should ONLY carry:
   - Evidence constraint text (from `buildEvidenceConstraint`) — this is a behavioral instruction, belongs in system prompt
   - Page header metadata (one line: `Currently viewing: "Page Title"`) — lightweight metadata

6. Update `estimatedTokens` to include context message tokens

**KEEP**: 
- Evidence assessment + re-retrieval logic (F8-12, ALIGNED) — but output goes to context message, not systemPromptAddition
- `trimHistoryToBudget()` call and history appending
- `ragSources` and `retrievedContextText` tracking

#### File 2: `src/openclaw/openclawAttempt.ts` — Remove system prompt truncation

**Lines 167-180** — Remove the system budget truncation block:

**REMOVE**:
```typescript
const systemBudget = Math.floor(context.tokenBudget * 0.10);
let effectiveSystemPrompt = systemPrompt;
if (systemBudget > 0) {
  const systemTokens = estimateTokens(systemPrompt);
  if (systemTokens > systemBudget) {
    const { text, trimmed } = trimTextToBudget(systemPrompt, systemBudget);
    if (trimmed) {
      effectiveSystemPrompt = text;
      console.warn(
        `[OpenClaw] System prompt (${systemTokens} tokens) exceeds budget (${systemBudget} tokens), truncated.`,
      );
    }
  }
}
```

**REPLACE WITH**: A warning-only check (no truncation). The system prompt's size is managed by bootstrap budget limits upstream, not by re-truncation at the attempt layer. If it's too large, the overflow → compact → retry cycle handles it.
```typescript
// System prompt size is governed by bootstrap budget limits (per-file + total caps).
// No truncation here — if the combined context exceeds the model window,
// the overflow → compact → retry cycle in the turn runner handles it.
const effectiveSystemPrompt = systemPrompt;
const systemTokens = estimateTokens(systemPrompt);
if (systemTokens > Math.floor(context.tokenBudget * 0.15)) {
  console.warn(
    `[OpenClaw] System prompt is large (${systemTokens} tokens, ` +
    `${Math.round(systemTokens / context.tokenBudget * 100)}% of budget). ` +
    `Consider reducing bootstrap file sizes.`,
  );
}
```

#### File 3: `src/openclaw/openclawSystemPrompt.ts` — Verify systemPromptAddition handling

**Lines 105-108** — `systemPromptAddition` section in `buildOpenclawSystemPrompt`:

**KEEP as-is**: This section correctly handles lightweight additions. After F8-3, `systemPromptAddition` will only contain evidence constraints and page header metadata — small strings that belong in the system prompt's behavioral instructions.

No changes needed to this file — the fix is in the *producer* (context engine) not the *consumer* (prompt builder).

### What to remove

1. **System prompt truncation** in `openclawAttempt.ts` lines 167-180 — the 10% hard cap that destroys RAG content. Replace with warning-only.
2. **systemPromptAddition accumulation** of bulk content in `openclawContextEngine.ts` — RAG, memory, concepts, transcripts should NOT go here.

### Verify

1. After change, `systemPromptAddition` from `assemble()` should be:
   - `undefined` when no evidence constraints and no page header
   - A short string (~50-200 tokens) with evidence constraint and/or page header
   - Never contain `## Retrieved Context`, `## Recalled Memories`, `## Concepts`, or `## Recalled Transcripts`

2. `assembled.messages` should contain:
   - One context injection message (role: user) with all retrieval content, under `budget.rag` tokens
   - History messages, under `budget.history` tokens

3. The attempt layer should pass the system prompt without truncation

4. End-to-end: for an 8192-token context window, RAG content should get its full ~2457-token allocation, not be squeezed into ~200 tokens

### Risk

- **Message ordering**: The context message must come BEFORE history but AFTER the system message. The attempt layer builds messages as `[system, ...assembled.messages, ...mentions, user]`. Since the context message is prepended to `assembled.messages`, it will appear after system and before history. ✓
- **Model behavior with user-role context**: Some models may treat user-role context differently than system prompt context. For models that follow system prompt instructions strictly, the evidence constraint should remain in `systemPromptAddition` (behavioral instruction). The bulk RAG content as a user-role message is the standard pattern for RAG injection.
- **Token estimate accuracy**: The `estimatedTokens` in `AssembleResult` must now include the context message tokens. Currently it includes `systemPromptAddition` tokens — that addition should be replaced with context message token count.

---

## Change Plan: F8-5 — Sub-Lane Budget Normalization

### F8-5: assemble() applies per-lane token budget limits
- **Status**: MISALIGNED → ALIGNED
- **Upstream**: `context-engine/types.ts` — context engine owns the token budget; assembled content must fit within the provided `tokenBudget`; no sub-lane can cause the total to exceed budget
- **Parallx file**: `src/openclaw/openclawContextEngine.ts` (assemble method, lines 196-240)
- **Action**: Normalize sub-lane allocations to sum to 100% of RAG budget. Add aggregate cap after all lanes contribute.

### What's wrong now

Sub-lane budget caps within `assemble()`:
| Sub-lane | Current cap | % of RAG budget |
|----------|------------|-----------------|
| Page content | `budget.rag * 0.3` | 30% |
| RAG text | `budget.rag` (uncapped within RAG) | 100% |
| Memory | `budget.rag * 0.2` | 20% |
| Concepts | `budget.rag * 0.1` | 10% |
| Transcripts | `budget.rag * 0.15` | 15% |
| **Total** | — | **175%** |

If all lanes return content at their maximum, the combined retrieval output exceeds the RAG budget by 75%.

### Upstream pattern

The upstream context engine is responsible for assembling content that fits within the provided token budget. There is no evidence of upstream having per-sub-lane percentage caps — it uses the overall budget constraint and prioritizes content by relevance. However, Parallx's multi-source retrieval (RAG, memory, concepts, transcripts, page) needs explicit partitioning since these are independent service calls.

### Changes required

#### File: `src/openclaw/openclawContextEngine.ts` — assemble() method

**Define normalized sub-lane budgets** that sum to 100% of the RAG allocation:

```typescript
// Sub-lane budgets within the RAG allocation (must sum to ≤ 100%)
const subLaneBudgets = {
  rag: Math.floor(budget.rag * 0.55),        // 55% — primary retrieval
  memory: Math.floor(budget.rag * 0.15),      // 15% — session/long-term memory
  page: Math.floor(budget.rag * 0.15),        // 15% — currently open page
  transcripts: Math.floor(budget.rag * 0.10), // 10% — past conversation recall
  concepts: Math.floor(budget.rag * 0.05),    // 5%  — concept recall
};
```

**Apply sub-lane budgets** when building context sections:
- Page: cap at `subLaneBudgets.page` (was `budget.rag * 0.3`)
- RAG: cap at `subLaneBudgets.rag` (was uncapped `budget.rag`)
- Memory: cap at `subLaneBudgets.memory` (was `budget.rag * 0.2`)
- Concepts: cap at `subLaneBudgets.concepts` (was `budget.rag * 0.1`)
- Transcripts: cap at `subLaneBudgets.transcripts` (was `budget.rag * 0.15`)

**Add aggregate cap** after all sections are assembled:
```typescript
// Aggregate cap: total context must not exceed RAG budget
let totalContextTokens = contextSections.reduce(
  (sum, section) => sum + estimateTokens(section), 0
);
while (totalContextTokens > budget.rag && contextSections.length > 0) {
  // Drop lowest-priority section (last added = lowest priority)
  contextSections.pop();
  totalContextTokens = contextSections.reduce(
    (sum, section) => sum + estimateTokens(section), 0
  );
}
```

Priority order for sections (first = highest priority, last = dropped first):
1. RAG text (primary retrieval — most relevant to user's query)
2. Page content (user's current focus)
3. Memory (relevant session/long-term context)
4. Transcripts (past conversations)
5. Concepts (lowest priority — general knowledge)

### What to remove

- The old percentage-based sub-lane caps that sum to 175%:
  - `if (pageTokens <= budget.rag * 0.3)` → use `subLaneBudgets.page`
  - `if (memoryTokens < budget.rag * 0.2)` → use `subLaneBudgets.memory`
  - `if (conceptTokens < budget.rag * 0.1)` → use `subLaneBudgets.concepts`
  - `if (transcriptTokens < budget.rag * 0.15)` → use `subLaneBudgets.transcripts`

### Verify

1. Sum of all sub-lane budgets ≤ `budget.rag`
2. Combined context sections token count ≤ `budget.rag`
3. When all 5 lanes return maximum content, the aggregate cap prevents overflow
4. Priority order is respected: concepts dropped before transcripts before memory before page before RAG

### Risk

- **Reduced per-lane allocation**: RAG text drops from 100% to 55% of RAG budget. For an 8K context, that's ~1350 tokens for RAG (vs ~2457 theoretical max before). However, this is still 6.75x more than the ~200 tokens RAG was actually getting before F8-3 fix. And the remaining 45% goes to other valuable context (memory, page, transcripts, concepts).
- **Unused budget**: If only RAG fires (memory/concepts/transcripts unavailable), the other 45% is wasted. Consider: after sub-lane assembly, re-distribute unused budget to the primary RAG lane if there's slack.

---

## Change Plan: F8-15 — Context Engine Unit Tests

### F8-15: Unit tests exist for context engine
- **Status**: MISSING → ALIGNED
- **Upstream**: (Testing is a baseline expectation — no specific upstream test file to cite, but the contract is well-defined and testable)
- **Parallx file**: Create `tests/unit/openclawContextEngine.test.ts`
- **Action**: Create comprehensive unit test suite covering token budget, context assembly, compaction, and history trimming.

### What's missing

Zero test coverage for:
- `computeTokenBudget()` — budget computation
- `estimateMessagesTokens()` — message token estimation
- `trimHistoryToBudget()` — history trimming (currently unexported, test via assemble)
- `OpenclawContextEngine.bootstrap()` — service readiness
- `OpenclawContextEngine.assemble()` — parallel retrieval, budget enforcement, context message construction
- `OpenclawContextEngine.compact()` — summarization path, trim fallback, memory flush
- Sub-lane budget normalization (after F8-5 fix)
- Aggregate cap enforcement (after F8-5 fix)

### Test file structure

Create `tests/unit/openclawContextEngine.test.ts`:

```
describe('computeTokenBudget')
  it('splits 10/30/30/30 for standard context window')
  it('handles zero context window')
  it('handles small context window (256 tokens)')
  it('floors all values (no fractional tokens)')

describe('estimateMessagesTokens')
  it('estimates tokens for message array with role overhead')
  it('returns 0 for empty array')

describe('OpenclawContextEngine')
  describe('bootstrap')
    it('sets ragReady when retrieveContext is provided')
    it('sets ragReady=false when retrieveContext is missing')
    it('sets all flags based on service availability')

  describe('assemble')
    it('returns context message in messages array (not systemPromptAddition)')
    it('respects RAG budget — context message tokens ≤ budget.rag')
    it('fires all retrieval services in parallel')
    it('gracefully handles individual service failures')
    it('includes history trimmed to budget.history')
    it('performs evidence re-retrieval on insufficient evidence')
    it('puts evidence constraint in systemPromptAddition (not context message)')
    it('sub-lane budgets sum to ≤ 100% of RAG budget')
    it('aggregate cap prevents combined retrieval from exceeding RAG budget')
    it('returns empty messages and no systemPromptAddition when all services fail')

  describe('compact')
    it('uses summarization service when available')
    it('falls back to simple trim when summarization fails')
    it('flushes summary to session memory')
    it('preserves last exchange after compaction')
    it('returns correct tokensBefore/tokensAfter counts')
    it('handles empty history gracefully')

  describe('trimHistoryToBudget (via assemble)')
    it('keeps most recent messages within budget')
    it('drops oldest messages first')
    it('returns empty array for zero budget')
    it('returns all messages when they fit within budget')
```

### Test infrastructure

- **Framework**: Vitest (existing project config)
- **Mocking**: Create mock `IOpenclawContextEngineServices` with controllable return values
- **Imports**: Import from `../../src/openclaw/openclawContextEngine.js` and `../../src/openclaw/openclawTokenBudget.js`
- **Pattern**: Follow existing test style from `tests/unit/openclawGateCompliance.test.ts`

### Mock services factory

```typescript
function createMockServices(overrides?: Partial<IOpenclawContextEngineServices>): IOpenclawContextEngineServices {
  return {
    retrieveContext: async (query: string) => ({
      text: `Retrieved content for: ${query}`,
      sources: [{ uri: 'file:///doc.md', label: 'doc.md', index: 0 }],
    }),
    recallMemories: async () => 'Memory: user prefers concise answers',
    recallConcepts: async () => 'Concept: insurance terminology',
    recallTranscripts: async () => 'Transcript: previous session discussed claims',
    getCurrentPageContent: async () => ({
      pageId: 'page-1',
      title: 'Test Page',
      textContent: 'Page content here',
    }),
    storeSessionMemory: async () => {},
    storeConceptsFromSession: async () => {},
    sendSummarizationRequest: async function* (messages) {
      yield { content: 'Summary of conversation' };
    },
    ...overrides,
  };
}
```

### Verify

1. All tests pass with `npx vitest run tests/unit/openclawContextEngine.test.ts`
2. Tests validate post-F8-3 behavior: RAG content in messages, not systemPromptAddition
3. Tests validate post-F8-5 behavior: sub-lane budgets sum to ≤ 100%, aggregate cap enforced
4. Tests are self-contained — no external service dependencies

### Risk

- **Import resolution**: The `vitest.config.ts` uses path aliases. Ensure imports resolve correctly. Existing tests use relative paths.
- **Mock service types**: The `IOpenclawContextEngineServices` type is a `Pick<>` from `IDefaultParticipantServices`. The mock must match the exact shapes returned by each service method. Read the actual service types before writing mocks.
- **Unexported helpers**: `trimHistoryToBudget` and `buildRetrieveAgainQuery` are module-private functions. They must be tested indirectly through `assemble()` and `compact()`. If direct testing is needed, they should be exported.

---

## Cross-Change Impacts

### Type changes: `IOpenclawAssembleResult`

The `IOpenclawAssembleResult` interface in `openclawContextEngine.ts` lines 74-82 should be updated with documentation clarifying the contract:

```typescript
export interface IOpenclawAssembleResult {
  /** Context messages: retrieval content + trimmed history. Primary delivery channel. */
  readonly messages: IChatMessage[];
  readonly estimatedTokens: number;
  /** Lightweight system prompt addition: evidence constraints, page header metadata only.
   *  MUST NOT contain bulk retrieval content (RAG, memory, concepts, transcripts). */
  readonly systemPromptAddition?: string;
  readonly ragSources: readonly { uri: string; label: string; index: number }[];
  readonly retrievedContextText: string;
}
```

### Import changes: `openclawAttempt.ts`

After removing `trimTextToBudget` usage from the truncation block, check if `trimTextToBudget` is still imported. It's used elsewhere in the file (tool result truncation uses `MAX_TOOL_RESULT_CHARS` directly, not `trimTextToBudget`). If no other use, remove from imports.

### Token budget: `openclawTokenBudget.ts`

No changes needed. The `IOpenclawTokenBudget` type and `computeTokenBudget()` function remain correct — the 10/30/30/30 split is right. The bug was in how the budgets were *applied* (context engine and attempt), not in how they were *computed*.

### Turn runner: `openclawTurnRunner.ts`

No changes needed. The turn runner already correctly:
- Calls `engine.bootstrap()` before retry loop
- Calls `engine.assemble()` per iteration
- Passes `assembled` to `executeOpenclawAttempt()`
- Handles overflow → compact → retry

### Prompt artifacts: `openclawPromptArtifacts.ts`

No changes needed. `buildOpenclawPromptArtifacts()` passes `assembled.systemPromptAddition` to the prompt builder. After F8-3, this field will contain only lightweight content — the flow is correct.

---

## Implementation Order (Step-by-Step)

### Step 1: Restructure assemble() — context engine (F8-3 core)
- File: `src/openclaw/openclawContextEngine.ts`
- Move retrieval content from `systemPromptAddition` to `messages` array
- Keep evidence constraints in `systemPromptAddition`
- Keep page header metadata in `systemPromptAddition`

### Step 2: Normalize sub-lane budgets (F8-5)
- File: `src/openclaw/openclawContextEngine.ts`
- Replace 175% sub-lane caps with normalized 100% allocation
- Add aggregate cap with priority-based overflow handling

### Step 3: Remove system prompt truncation (F8-3 downstream)
- File: `src/openclaw/openclawAttempt.ts`
- Remove 10% hard cap on system prompt
- Replace with warning-only size check

### Step 4: Update type documentation (F8-3 contract)
- File: `src/openclaw/openclawContextEngine.ts`
- Add JSDoc to `IOpenclawAssembleResult` clarifying messages vs systemPromptAddition contract

### Step 5: Create unit tests (F8-15)
- File: `tests/unit/openclawContextEngine.test.ts`
- Test all behaviors post-fix

---

## M41 Anti-Pattern Checklist

| Anti-Pattern | Check | Status |
|-------------|-------|--------|
| Preservation bias | Are we keeping broken code because it exists? | ✗ — We're replacing the broken delivery channel |
| Patch-thinking | Are we adding code on top of broken code? | ✗ — We're fixing the architecture, not patching symptoms |
| Wrapper framing | Are we wrapping existing behavior in a new API? | ✗ — We're restructuring how data flows through an existing API |
| Output repair | Are we post-processing model output? | ✗ — We're fixing model INPUT (context delivery) |
| Pre-classification | Are we adding regex/keyword routing? | ✗ — No routing changes |
| Eval-driven patchwork | Are we fixing specific test failures? | ✗ — We're fixing the budget architecture that affects ALL queries |

---

## Uncertainties

None flagged as NEEDS_UPSTREAM_VERIFICATION. The upstream `AssembleResult` contract is well-documented in the reference source map and M41 spec. The message-based delivery pattern is clearly the upstream intent.
