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
| Model capability gate | **ALIGNED** ✅ (dead code removed, handled at attempt level) |
| Tool state management | **ALIGNED** ✅ |
| Tool loop safety | **ALIGNED** ✅ |
| Multi-stage pipeline | **ALIGNED** ✅ (N/A adaptation) |
| Filter reason accuracy | **ALIGNED** ✅ (F4-R2-01) |
| Comment accuracy | **ALIGNED** ✅ (F4-R2-02) |
| Dead code cleanup | **ALIGNED** ✅ (F4-R2-03) |
| Unit test coverage | **ALIGNED** ✅ (F4-R2-04) |

**Result:** 10/10 ALIGNED

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

### Iteration 2 — Refinement (2026-03-27) [SUPERSEDED]

**Auditor:** Parity Orchestrator  
**Findings:** No issues.

### Iteration 3 — Confirmation (2026-03-27) [SUPERSEDED]

**Auditor:** Parity Orchestrator  
**Findings:** 6/6 ALIGNED ✅. Gap matrix updated.

### Iteration 2b — Substantive Deep Audit (2026-03-29)

**Auditor:** AI Parity Auditor  
**Scope:** All F4 files — tool policy, tool state, filter reasons

**Findings:**
| ID | Severity | Finding | Status |
|---|---|---|---|
| F4-R2-01 | MEDIUM | `getToolFilteredReason` hardcoded only `standard`+`run_command` for `tool-profile-deny` — all `readonly` denies misreported | FIXED ✅ |
| F4-R2-02 | LOW | `resolveToolProfile` comments contradicted code behavior | FIXED ✅ |
| F4-R2-03 | LOW | `modelCapabilities` parameter + `model-unsupported` reason were dead code | FIXED ✅ |
| F4-R2-04 | MEDIUM | Zero direct unit tests for `applyOpenclawToolPolicy`, `resolveToolProfile`, tool state | FIXED ✅ |

**Fixes Applied:**
- F4-R2-01: Added `isToolDeniedByProfile()` exported from `openclawToolPolicy.ts`; `getToolFilteredReason` in `openclawToolState.ts` uses it instead of hardcoded mode check
- F4-R2-02: Updated comments to accurately describe behavior ("Most modes get full tool access", "standard tools (no command execution)")
- F4-R2-03: Removed `modelCapabilities` param, `ModelCapability` import, `model-unsupported` from `IOpenclawToolFilterReason`
- F4-R2-04: Created `openclawToolPolicy.test.ts` with 30 tests across 5 describe blocks

**Verification:** TypeScript 0 errors, 134 files / 2548 tests / 0 failures

### Iteration 3b — Substantive Confirmation (2026-03-29)

**Auditor:** AI Parity Auditor  
**Scope:** Verify all 4 iter-2b fixes

**Findings:**
- F4-R2-01: **PASS** — `isToolDeniedByProfile` correctly delegates to profile deny list, no hardcoded check remains
- F4-R2-02: **PASS** — Comments accurately describe behavior
- F4-R2-03: **PASS** — All dead code removed (param, import, type union member)
- F4-R2-04: **PASS** — 30 tests across 5 describe blocks covering all policy functions

**Verdict:** PASS — 10/10 ALIGNED

---

## Documentation Checklist

- [x] `docs/F4_TOOL_POLICY_AUDIT.md`
- [x] `docs/F4_TOOL_POLICY_GAP_MAP.md`
- [x] `docs/F4_TOOL_POLICY_TRACKER.md`
