# F7 Participant Runtime — Parity Audit Report

**Domain:** F7 — Participant Runtime  
**Date:** 2026-04-16  
**Upstream Reference:** `github.com/openclaw/openclaw` @ e635cedb  
**Parallx Files Audited:** 13 files in `src/openclaw/`

---

## Executive Summary

After M41 phases 4–9, the **default participant** is fully wired through the new 2-layer pipeline (turn runner → attempt) with context engine, structured system prompt, and tool policy. However, the **workspace and canvas participants** still use the pre-M41 execution path (`executeOpenclawModelTurn`), bypassing every pipeline improvement. This is the critical structural gap in F7.

| Classification | Count |
|---|---|
| ALIGNED | 9 |
| MISALIGNED | 3 |
| HEURISTIC | 1 |
| MISSING | 0 |

---

## Capability Classification

### ALIGNED (9)

| # | Capability | File | Evidence |
|---|---|---|---|
| F7-01 | Participant registration | `registerOpenclawParticipants.ts` | 3 participants registered via agentService with proper IDs, surfaces, builder pattern |
| F7-02 | Default participant pipeline | `openclawDefaultParticipant.ts` | `runOpenclawDefaultTurn` → `buildOpenclawTurnContext` → `runOpenclawTurn` (full pipeline) |
| F7-03 | Turn runner retry loop | `openclawTurnRunner.ts` | Overflow (max 3), timeout (max 2), transient (exp backoff 2500ms base), auto-compact at 80% |
| F7-04 | Attempt execution | `openclawAttempt.ts` | System prompt via `buildOpenclawPromptArtifacts`, tool policy, tool loop with safety, mid-loop budget, truncation (20K), afterTurn |
| F7-05 | Context engine lifecycle | `openclawContextEngine.ts` | `IOpenclawContextEngine` with bootstrap/assemble/compact/afterTurn; C1-C5 stages; evidence assessment (M5) |
| F7-06 | Structured system prompt | `openclawSystemPrompt.ts` | 10-section builder: identity, skills XML, tool summaries, workspace, preferences, overlay, runtime, behavioral rules, model tier |
| F7-07 | Tool policy pipeline | `openclawToolPolicy.ts` | 3 profiles (readonly/standard/full), deny-first, M11 3-tier permissions, M42 model capabilities |
| F7-08 | Runtime support | `openclawDefaultRuntimeSupport.ts` | Command registry with /context, /init, /compact; clean lifecycle |
| F7-09 | Service interfaces | `openclawTypes.ts`, `openclawParticipantServices.ts` | Proper interfaces for all 3 participant types; adapter pattern with builders |

### MISALIGNED (3)

| # | Capability | File | Gap | Upstream Pattern |
|---|---|---|---|---|
| F7-10 | Workspace participant execution | `openclawWorkspaceParticipant.ts` | Uses OLD `executeOpenclawModelTurn` from `openclawParticipantRuntime.ts`. Bypasses: turn runner, context engine, system prompt builder, tool policy. String-concatenated prompt, no retry/compaction. | Upstream: all participants go through the same pipeline entry point, not a separate execution function. |
| F7-11 | Canvas participant execution | `openclawCanvasParticipant.ts` | Identical gap to workspace: OLD execution path, no pipeline. | Same upstream pattern as F7-10. |
| F7-12 | Old execution path still exported | `openclawParticipantRuntime.ts:274` | `executeOpenclawModelTurn` is still exported and consumed by workspace + canvas. Should be deprecated once they migrate. | Upstream: single attempt function, not a parallel legacy path. |

### HEURISTIC (1)

| # | Capability | File | Gap | Upstream Pattern |
|---|---|---|---|---|
| F7-13 | Followup suggestions | `openclawDefaultParticipant.ts:349-358` | Returns 3 hardcoded generic strings ("Explain more", "Alternatives", "Apply it"). Not derived from response content. | Upstream: followups inferred from the model's response or not offered at all. Desktop participants can omit this safely. |

---

## Critical Finding: Pipeline Bypass

```
Default participant (✅ ALIGNED):
  request → runOpenclawDefaultTurn → buildOpenclawTurnContext → runOpenclawTurn
            → [turn runner: retry/compact/backoff]
              → executeOpenclawAttempt
                → [system prompt builder] → [tool policy] → [model call]
                → [tool loop with safety] → [context engine afterTurn]

Workspace participant (❌ MISALIGNED):
  request → handleWorkspaceTurn → handleSearch/handleList/handleGeneral
            → runWorkspacePromptTurn
              → string-concatenated system prompt
              → executeOpenclawModelTurn (OLD — direct model call)
              → manual tool iteration loop (no retry, no compaction, no policy)

Canvas participant (❌ MISALIGNED):
  request → handleCanvasTurn → handleDescribe/handleBlocks/handleGeneral
            → runCanvasPromptTurn
              → string-concatenated system prompt
              → executeOpenclawModelTurn (OLD — same as workspace)
              → manual tool iteration loop (same gaps)
```

**Impact:** 2 of 3 participants skip the entire M41 pipeline. Any future improvements to retry logic, context engine, system prompt, or tool policy will only affect the default participant unless this is fixed.

---

## Recommended Fix Strategy

### Approach: Shared ReadOnly Turn Runner

Both workspace and canvas are **read-only participants** — they use `readonly` tool profiles and a capped iteration budget (`OPENCLAW_MAX_READONLY_ITERATIONS`). The fix is NOT to make them use the full default participant's `runOpenclawTurn` (which carries context engine, memory writeback, etc. they don't need).

Instead:
1. Create a **`runOpenclawReadOnlyTurn`** function in `openclawTurnRunner.ts` that provides the turn runner's retry/compaction loop with a `readonly` tool profile, but without the full context engine lifecycle.
2. It should use `buildOpenclawSystemPrompt` for structured prompts (with appropriate sections).
3. Migrate workspace and canvas to call `runOpenclawReadOnlyTurn` instead of `executeOpenclawModelTurn`.
4. Deprecate `executeOpenclawModelTurn` in `openclawParticipantRuntime.ts`.

### For followup suggestions (F7-13):
Remove `generateFollowupSuggestions` and return an empty array. The heuristic provides no value — generic followups ("Explain more") don't improve the UX and represent eval-driven patchwork (M41 anti-pattern A3).
