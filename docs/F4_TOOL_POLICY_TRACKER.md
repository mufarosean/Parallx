# F4: Tool Policy — TRACKER

**Domain:** F4 Tool Policy  
**Status:** CLOSED ✅  
**Date opened:** 2026-03-27  
**Date closed:** 2026-03-27

---

## Scorecard

| Capability | Status |
|---|---|
| Profile-based tool filtering | **ALIGNED** ✅ |
| Permission-based tool filtering | **ALIGNED** ✅ |
| Model capability gate | **ALIGNED** ✅ |
| Tool state management | **ALIGNED** ✅ |
| Tool loop safety | **ALIGNED** ✅ |
| Multi-stage pipeline | **ALIGNED** ✅ (N/A adaptation) |

**Result:** 6/6 ALIGNED

---

## Key Files

| File | Role |
|---|---|
| `src/openclaw/openclawToolPolicy.ts` | Profile definitions, policy pipeline, mode resolution |
| `src/openclaw/openclawToolState.ts` | Tool state management, skill integration, dedup, reporting |
| `src/services/chatToolLoopSafety.ts` | Shared tool loop safety (canonical) |
| `src/openclaw/openclawAttempt.ts` | Tool policy consumer, tool loop, mid-loop budget check |
| `src/openclaw/openclawReadOnlyTurnRunner.ts` | Readonly tool policy consumer |

---

## Upstream References

| Pattern | Upstream | Parallx |
|---|---|---|
| Profile filtering | `resolveToolProfilePolicy` — 4 profiles | `TOOL_PROFILES` — 3 profiles (readonly/standard/full) |
| Deny-first matching | `isToolAllowedByPolicyName` | `applyOpenclawToolPolicy` deny-first, allow-second |
| Multi-stage pipeline | `applyToolPolicyPipeline` — 6 steps | 2-step pipeline (profile + permission) |
| Tool loop safety | `ToolLoopDetectionConfig` — configurable | `ChatToolLoopSafety` — fixed thresholds |
| Permission system | Owner-only gates | 3-tier: always/requires-approval/never |

---

## Iteration Log

### Iteration 1 — Structural Audit (2026-03-27)

**Auditor:** AI Parity Auditor  
**Scope:** Full F4 domain (6 capabilities)

**Findings:** 5 ALIGNED, 1 MISALIGNED (multi-stage pipeline configurability — N/A for desktop).  
**Actions:** Reclassified as ALIGNED with N/A adaptation.

### Iteration 2 — Refinement (2026-03-27)

**Auditor:** Parity Orchestrator  
**Findings:** No issues.

### Iteration 3 — Confirmation (2026-03-27)

**Auditor:** Parity Orchestrator  
**Findings:** 6/6 ALIGNED ✅. Gap matrix updated.

---

## Documentation Checklist

- [x] `docs/F4_TOOL_POLICY_AUDIT.md`
- [x] `docs/F4_TOOL_POLICY_GAP_MAP.md`
- [x] `docs/F4_TOOL_POLICY_TRACKER.md`
