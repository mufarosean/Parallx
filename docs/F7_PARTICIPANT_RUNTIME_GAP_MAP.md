# F7 Participant Runtime — Gap Map (Change Plans)

**Domain:** F7 — Participant Runtime  
**Input:** `F7_PARTICIPANT_RUNTIME_AUDIT.md`  
**Approach:** Shared readonly turn runner, tool policy gating, heuristic removal

---

## Change Plan

### Change 1: Create `openclawReadOnlyTurnRunner.ts`
**Gap:** F7-10, F7-11 — workspace/canvas bypass pipeline  
**Upstream citation:** `agent-runner-execution.ts:113-380` (retry logic applies to ALL agents)  
**File:** `src/openclaw/openclawReadOnlyTurnRunner.ts` (new)  
**What:**  
- Shared function `runOpenclawReadOnlyTurn` that wraps the model-call + tool-iteration loop with:
  - Transient error retry (exp backoff 2500ms, max 3)
  - Timeout retry (max 2)
  - Tool policy filtering (readonly profile via `applyOpenclawToolPolicy`)
  - Token usage reporting
- Replaces the inline `while (iterations >= 0) { executeOpenclawModelTurn }` pattern in both workspace and canvas

### Change 2: Migrate workspace participant
**Gap:** F7-10  
**File:** `src/openclaw/participants/openclawWorkspaceParticipant.ts`  
**What:**  
- Import `runOpenclawReadOnlyTurn` instead of `executeOpenclawModelTurn`
- Remove inline tool iteration loop in `runWorkspacePromptTurn`
- Apply readonly tool policy before model call
- Keep all existing slash commands, prompt construction, and participant-specific logic

### Change 3: Migrate canvas participant
**Gap:** F7-11  
**File:** `src/openclaw/participants/openclawCanvasParticipant.ts`  
**What:**  
- Import `runOpenclawReadOnlyTurn` instead of `executeOpenclawModelTurn`
- Remove inline tool iteration loop in `runCanvasPromptTurn`
- Apply readonly tool policy before model call
- Keep all existing slash commands, prompt construction, and participant-specific logic

### Change 4: Remove heuristic followups
**Gap:** F7-13  
**File:** `src/openclaw/participants/openclawDefaultParticipant.ts`  
**What:**  
- Delete `generateFollowupSuggestions` function (L339-358)
- Change `provideFollowups` to return `[]`
- M41 anti-pattern A3: hardcoded generic strings add no value

### Change 5: Deprecate old execution path
**Gap:** F7-12  
**File:** `src/openclaw/participants/openclawParticipantRuntime.ts`  
**What:**  
- Add `@deprecated` JSDoc to `executeOpenclawModelTurn`
- Note: full removal deferred until workspace/canvas migration is verified
