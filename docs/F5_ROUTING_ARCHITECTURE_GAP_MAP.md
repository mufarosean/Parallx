# F5 Routing Architecture — Gap Map

**Domain:** F5 — Routing Architecture  
**Iteration:** 1  
**Date:** 2026-03-27  
**Input:** `docs/F5_ROUTING_ARCHITECTURE_AUDIT.md`  

---

## Summary

| ID | Capability | Current | Target | Severity |
|----|-----------|---------|--------|----------|
| F5-05 | Broad workspace summary | HEURISTIC | ALIGNED | MEDIUM |
| F5-06 | Workspace document listing | HEURISTIC (untracked) | ALIGNED | LOW |
| F5-TD1 | Dead route kind literals | TYPE DEBT | CLEAN | LOW |
| F5-TD2 | Dead `isConversationalTurn` property | TYPE DEBT | CLEAN | LOW |
| F5-TD3 | Dead `semanticFallback` property (openclaw types) | TYPE DEBT | CLEAN | LOW |

---

## Change Plan

### F5-05: Broad Workspace Summary — HEURISTIC → ALIGNED

**Severity:** MEDIUM  
**Anti-pattern:** Pre-classification — regex patterns decide turn behavior before the model runs.  
**Upstream:** OpenClaw has no regex pre-classification for workspace summaries. The `/summarize` slash command already exists in Parallx as the structural alternative. Model routing is via system prompt instructions, not regex.

#### What to remove

The entire `BROAD_WORKSPACE_PATTERNS` + `isBroadWorkspaceSummaryPrompt` + `detectSemanticFallback` pipeline across both the OpenClaw participant layer and the built-in chat service layer.

#### Changes (ordered by dependency)

**Change 1 — Remove consumer in default participant**

- **File:** `src/openclaw/participants/openclawDefaultParticipant.ts`
- **Line 34:** Remove `detectSemanticFallback` from the import of `../openclawTurnPreprocessing.js`. The import becomes:
  ```ts
  import { resolveMentions, resolveVariables } from '../openclawTurnPreprocessing.js';
  ```
- **Lines 117:** Delete the line:
  ```ts
  const semanticFallback = detectSemanticFallback(variableResult.strippedText);
  ```
- **Line 123:** Remove `semanticFallback?.promptOverlay` from the overlay merge. The line becomes:
  ```ts
  const effectiveOverlay = patternRulesOverlay || undefined;
  ```

**Change 2 — Remove `detectSemanticFallback` + `ISemanticFallbackResult` + re-export from preprocessing**

- **File:** `src/openclaw/openclawTurnPreprocessing.ts`
- **Line 13:** Remove import of `isBroadWorkspaceSummaryPrompt` from `'./openclawResponseValidation.js'`.
- **Line 169:** Remove the re-export: `export { isBroadWorkspaceSummaryPrompt } from './openclawResponseValidation.js';`
- **Lines 171–176:** Delete `ISemanticFallbackResult` interface.
- **Lines 181–190:** Delete the `detectSemanticFallback()` function entirely.
- **Delete the `// M4: Semantic fallback` section header comment (lines 167-168).**

**Change 3 — Remove `BROAD_WORKSPACE_PATTERNS` + `isBroadWorkspaceSummaryPrompt` from validation**

- **File:** `src/openclaw/openclawResponseValidation.ts`
- **Lines 269–283:** Delete the `// Semantic fallback detection (M4)` section header, `BROAD_WORKSPACE_PATTERNS` array, and the `isBroadWorkspaceSummaryPrompt()` function.

**Change 4 — Remove built-in chat service layer duplicate**

- **File:** `src/built-in/chat/utilities/chatSemanticFallback.ts`
- **Action:** Delete the entire file. It contains only `BROAD_WORKSPACE_SUMMARY_PATTERNS`, `isBroadWorkspaceSummaryPrompt`, `resolveChatSemanticFallback`, and `applyChatSemanticFallback` — all pre-classification anti-patterns.

**Change 5 — Remove chatService consumer of chatSemanticFallback**

- **File:** `src/services/chatService.ts`
- **Line 28:** Remove the import:
  ```ts
  import { applyChatSemanticFallback, resolveChatSemanticFallback } from '../built-in/chat/utilities/chatSemanticFallback.js';
  ```
- **Lines 713–716:** Delete the `resolveChatSemanticFallback(...)` call and its result binding.
- **Line 720:** Remove `applyChatSemanticFallback(initialTurnRoute, semanticFallback)` — replace with direct use of `initialTurnRoute`:
  ```ts
  const turnRoute = initialTurnRoute;
  ```
- **Line 731:** Remove `semanticFallback,` from the return object.
- **Line 733:** The `isConversationalTurn` line stays for now (separate TD2 change).

**Change 6 — Remove `IChatSemanticFallbackDecision` type (built-in chatTypes)**

- **File:** `src/built-in/chat/chatTypes.ts`
- **Lines 710–714:** Delete `IChatSemanticFallbackDecision` interface.
- **Line 360:** Remove `readonly semanticFallback?: IChatSemanticFallbackDecision;` from turn state interface.
- **Line 386:** Remove `readonly semanticFallback?: IChatSemanticFallbackDecision;` from resolved turn interface.

**Change 7 — Remove `IChatParticipantSemanticFallbackDecision` type (service chatTypes)**

- **File:** `src/services/chatTypes.ts`
- **Lines 628–632:** Delete `IChatParticipantSemanticFallbackDecision` interface.
- **Line 643:** Remove `readonly semanticFallback?: IChatParticipantSemanticFallbackDecision;` from `IChatParticipantTurnState`.

**Change 8 — Remove `semanticFallback` from `IChatRuntimeTrace` (openclaw types)**

- **File:** `src/openclaw/openclawTypes.ts`
- **Line 115:** Remove `readonly semanticFallback?: unknown;` from `IChatRuntimeTrace`.
- **Line 155:** Remove `readonly semanticFallback?: unknown;` from `IOpenclawResolvedTurn`.

**Change 9 — Remove `semanticFallback` merge in trace accumulation**

- **File:** `src/built-in/chat/data/chatDataService.ts`
- **Line 1678:** Remove `semanticFallback: trace.semanticFallback ?? previousTrace?.semanticFallback,` from trace merge.

**Change 10 — Clean `semanticFallbackKind` from debug types (LOW priority, optional)**

These are debug-telemetry properties. They are harmless but orphaned after F5-05 removal. Defer to a sweep pass or remove now:

- `src/openclaw/openclawTypes.ts` lines 325, 361 — `semanticFallbackKind?: string`
- `src/built-in/chat/chatTypes.ts` lines 206, 246 — `semanticFallbackKind?: string`
- `src/built-in/chat/data/chatDataService.ts` lines 209, 1658 — `semanticFallbackKind?: string`

**Recommendation:** Remove now for clean closure.

#### Test impact

- `tests/unit/chatBridge.test.ts` lines 141, 303 — Remove `semanticFallback: undefined` from test fixture objects.
- `tests/unit/chatAgentService.test.ts` line 233 — Remove `isConversationalTurn: false` (handled in TD2).
- `tests/unit/chatGateCompliance.test.ts` line 110 — Remove `'utilities/chatSemanticFallback.ts': []` from gate list after file deletion.
- `tests/ai-eval/ai-eval-fixtures.ts` line 95 — Remove `semanticFallback?` from fixture type.

#### Verify

- `npx vitest run` passes with no regressions.
- `grep -rn "isBroadWorkspaceSummaryPrompt\|BROAD_WORKSPACE_PATTERNS\|detectSemanticFallback\|resolveChatSemanticFallback\|applyChatSemanticFallback" src/` returns zero hits.
- `/summarize` slash command continues to work unchanged (it's structural, not affected).

#### Risk

- LOW. This is pure deletion. No behavior replacement needed — the `/summarize` command already handles the structural use case. The regex pre-classification was adding a prompt overlay, which the model can provide itself from system prompt instructions.

---

### F5-06: Workspace Document Listing — HEURISTIC → ALIGNED

**Severity:** LOW  
**Anti-pattern:** Model-bypass — regex intercepts queries that should go to the model, returning canned filesystem output instead.  
**Upstream:** OpenClaw has no regex-based document listing bypass. Parallx already has `@workspace /list` as the structural alternative.

#### What to remove

The entire `isWorkspaceDocumentListingQuery` regex gate and `tryHandleWorkspaceDocumentListing` function, plus its call sites in both participants.

#### Changes (ordered by dependency)

**Change 1 — Remove call site in default participant**

- **File:** `src/openclaw/participants/openclawDefaultParticipant.ts`
- **Line 25:** Remove the import:
  ```ts
  import { tryHandleWorkspaceDocumentListing } from '../openclawWorkspaceDocumentListing.js';
  ```
- **Lines 85–91:** Delete the `tryHandleWorkspaceDocumentListing(...)` early-return block.

**Change 2 — Remove call site in workspace participant**

- **File:** `src/openclaw/participants/openclawWorkspaceParticipant.ts`
- **Line 25:** Remove the import:
  ```ts
  import { tryHandleWorkspaceDocumentListing } from '../openclawWorkspaceDocumentListing.js';
  ```
- **Lines 207–214:** Delete the `tryHandleWorkspaceDocumentListing(...)` early-return block in `handleGeneral()`.

**Change 3 — Delete the source file**

- **File:** `src/openclaw/openclawWorkspaceDocumentListing.ts`
- **Action:** Delete the entire file. All exports (`tryHandleWorkspaceDocumentListing`, `isWorkspaceDocumentListingQuery`) are model-bypass heuristics.

#### Test impact

- `tests/unit/chatWorkspaceDocumentListing.test.ts` — **Delete the entire test file.** It tests the deleted heuristic.

#### Verify

- `npx vitest run` passes.
- `grep -rn "isWorkspaceDocumentListingQuery\|tryHandleWorkspaceDocumentListing" src/` returns zero hits.
- `@workspace /list` continues to work (it's a slash command, unrelated to the deleted regex).

#### Risk

- LOW. Users who type "what documents do I have in my workspace?" will now get a model-generated answer using workspace context instead of a canned file listing. The model answer is likely higher quality since it can summarize contents, not just list filenames. The `/list` command remains for users who want the structural listing.

---

### F5-TD1: Dead Route Kind Literals — TYPE DEBT → CLEAN

**Severity:** LOW  
**Anti-pattern:** Preservation bias — stale type literals from removed heuristics.

#### Changes

**Change 1 — Clean `IChatTurnRoute.kind` union**

- **File:** `src/openclaw/openclawTypes.ts`
- **Line 91:** Change:
  ```ts
  readonly kind: 'conversational' | 'memory-recall' | 'transcript-recall' | 'product-semantics' | 'off-topic' | 'grounded' | string;
  ```
  To:
  ```ts
  readonly kind: 'memory-recall' | 'transcript-recall' | 'grounded' | string;
  ```
  Remove `'conversational'`, `'product-semantics'`, `'off-topic'` — all three route kinds were removed in F5-01 through F5-04.

**Change 2 — Clean `IRetrievalPlan.intent` union**

- **File:** `src/openclaw/openclawTypes.ts`
- **Line 74:** Change:
  ```ts
  readonly intent: 'question' | 'situation' | 'task' | 'conversational' | 'exploration' | string;
  ```
  To:
  ```ts
  readonly intent: 'question' | 'situation' | 'task' | 'exploration' | string;
  ```
  Remove `'conversational'` — the conversational route was removed in F5-03.

**Change 3 — Clean `buildOpenclawTraceSeed` dead branch**

- **File:** `src/openclaw/participants/openclawParticipantRuntime.ts`
- **Line 351:** Change:
  ```ts
  intent: route.kind === 'conversational' ? 'conversational' : 'question',
  ```
  To:
  ```ts
  intent: 'question',
  ```
  The `'conversational'` kind is dead — this branch can never be true.

- **Line 353:** Change:
  ```ts
  needsRetrieval: route.kind === 'grounded',
  ```
  This line is LIVE and correct — keep as-is.

#### Verify

- TypeScript compilation (`npx tsc --noEmit`) passes.
- No runtime code assigns `'conversational'`, `'product-semantics'`, or `'off-topic'` to `route.kind`.

#### Risk

- MINIMAL. The `| string` escape hatch in the union means any dynamic value still compiles. The removed literals were never assigned at runtime.

---

### F5-TD2: Dead `isConversationalTurn` Property — TYPE DEBT → CLEAN

**Severity:** LOW  
**Anti-pattern:** Preservation bias — property derived from a dead route kind.

#### Changes

**Change 1 — Remove from openclaw types**

- **File:** `src/openclaw/openclawTypes.ts`
- **Line 153:** Delete `readonly isConversationalTurn: boolean;` from `IOpenclawResolvedTurn`.

**Change 2 — Remove from built-in chat types (built-in layer)**

- **File:** `src/built-in/chat/chatTypes.ts`
- **Line 384:** Delete `readonly isConversationalTurn: boolean;` from the interface.

**Change 3 — Remove from service chat types**

- **File:** `src/services/chatTypes.ts`
- **Line 645:** Delete `readonly isConversationalTurn: boolean;` from `IChatParticipantTurnState`.

**Change 4 — Remove assignment in chatService**

- **File:** `src/services/chatService.ts`
- **Line 733:** Delete `isConversationalTurn: turnRoute.kind === 'conversational',` from the return object.

#### Test impact

- `tests/unit/chatBridge.test.ts` lines 143, 305 — Remove `isConversationalTurn: false` from fixture objects.
- `tests/unit/chatAgentService.test.ts` line 233 — Remove `isConversationalTurn: false` from fixture.

#### Verify

- TypeScript compilation passes.
- `grep -rn "isConversationalTurn" src/ tests/` returns zero hits.

#### Risk

- MINIMAL. The property was always `false` (since `turnRoute.kind` is never `'conversational'`). No runtime logic reads it.

---

### F5-TD3: Dead `semanticFallback` in OpenClaw Types — TYPE DEBT → CLEAN

This is covered by F5-05 Change 8. Listed here for completeness — no additional changes needed beyond those already in F5-05.

---

## Dependency Order

Execute changes in this order to avoid intermediate compile errors:

1. **F5-05 Changes 1–3** — Remove openclaw-layer semantic fallback consumer + producer
2. **F5-05 Changes 4–5** — Remove built-in layer chatSemanticFallback file + chatService consumer
3. **F5-05 Changes 6–9** — Remove type definitions and trace plumbing
4. **F5-05 Change 10** — Remove orphaned debug `semanticFallbackKind` properties
5. **F5-06 Changes 1–2** — Remove document listing call sites
6. **F5-06 Change 3** — Delete source file
7. **F5-TD1 Changes 1–3** — Clean dead type literals
8. **F5-TD2 Changes 1–4** — Remove `isConversationalTurn`
9. **Test cleanup** — Update/delete test files

## Files Modified (complete list)

| File | Action |
|------|--------|
| `src/openclaw/participants/openclawDefaultParticipant.ts` | Edit (remove 2 imports, semantic fallback call, overlay merge, document listing block) |
| `src/openclaw/participants/openclawWorkspaceParticipant.ts` | Edit (remove 1 import, document listing block) |
| `src/openclaw/openclawTurnPreprocessing.ts` | Edit (remove import, re-export, interface, function) |
| `src/openclaw/openclawResponseValidation.ts` | Edit (remove BROAD_WORKSPACE_PATTERNS, isBroadWorkspaceSummaryPrompt) |
| `src/openclaw/openclawWorkspaceDocumentListing.ts` | **DELETE** |
| `src/openclaw/openclawTypes.ts` | Edit (clean kind union, intent union, remove dead properties) |
| `src/openclaw/participants/openclawParticipantRuntime.ts` | Edit (remove dead branch) |
| `src/built-in/chat/utilities/chatSemanticFallback.ts` | **DELETE** |
| `src/built-in/chat/chatTypes.ts` | Edit (remove types, properties) |
| `src/built-in/chat/data/chatDataService.ts` | Edit (remove trace merge line, debug properties) |
| `src/services/chatService.ts` | Edit (remove import, calls, return properties) |
| `src/services/chatTypes.ts` | Edit (remove type, properties) |
| `tests/unit/chatWorkspaceDocumentListing.test.ts` | **DELETE** |
| `tests/unit/chatBridge.test.ts` | Edit (remove fixture properties) |
| `tests/unit/chatAgentService.test.ts` | Edit (remove fixture property) |
| `tests/unit/chatGateCompliance.test.ts` | Edit (remove gate entry) |
| `tests/ai-eval/ai-eval-fixtures.ts` | Edit (remove fixture property) |

**Total:** 17 files (2 deleted, 15 edited)
