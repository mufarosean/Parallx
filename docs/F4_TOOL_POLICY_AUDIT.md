# F4: Tool Policy — AUDIT

**Domain:** F4 Tool Policy  
**Date:** 2026-03-27  
**Auditor:** AI Parity Auditor (iter 1), Parity Orchestrator (iter 2 refinement, iter 3 confirmation)  
**Status:** 6/6 ALIGNED ✅

---

## Summary Table

| Capability | Status | Evidence |
|---|---|---|
| Profile-based tool filtering | **ALIGNED** ✅ | Deny-first, allow pattern with 3 profiles (readonly/standard/full) |
| Permission-based tool filtering | **ALIGNED** ✅ | 3-tier enforcement: never-allowed excluded at policy, requires-approval gated at invocation |
| Model capability gate | **ALIGNED** ✅ | Returns empty array when model lacks `'tools'` capability |
| Tool state management | **ALIGNED** ✅ | Skill integration, dedup, name-collision detection, detailed reporting |
| Tool loop safety | **ALIGNED** ✅ | History tracking, repeat blocking, iteration budget, mid-loop budget check |
| Multi-stage pipeline | **ALIGNED** ✅ | 2-step pipeline covers desktop needs; full 6-step upstream N/A for single-user |

---

## Per-Capability Findings

### 1. Profile-Based Tool Filtering — ALIGNED ✅

**Upstream pattern:** `resolveToolProfilePolicy` + `isToolAllowedByPolicyName` — deny-first, allow-second. 4 profiles: minimal/coding/messaging/full.

**Parallx state:** `applyOpenclawToolPolicy()` implements deny-first, allow-second with 3 profiles:
- `readonly` → deny write/delete/run tools (maps to upstream `minimal`)
- `standard` → deny `run_command` only (maps to upstream `coding`)
- `full` → allow everything (maps to upstream `full`)

`messaging` profile N/A for desktop workbench.

### 2. Permission-Based Tool Filtering — ALIGNED ✅

**Upstream pattern:** Owner-only tool policies.

**Parallx state:** 3-tier system:
- `never-allowed` → removed at policy level AND invocation level (double-gated)
- `requires-approval` → NOT removed from model view, but gated at `invokeToolWithRuntimeControl` via `confirmToolInvocation`
- `always-allowed` → passed through

### 3. Model Capability Gate — ALIGNED ✅

**Upstream pattern:** `applyModelProviderToolPolicy` — models without tool calling get no tools.

**Parallx state:** `applyOpenclawToolPolicy` returns `[]` when `modelCapabilities` doesn't include `'tools'`. Attempt also passes `tools: undefined` for empty arrays.

### 4. Tool State Management — ALIGNED ✅

**Upstream pattern:** Tool creation + policy application + catalog.

**Parallx state:** `buildOpenclawRuntimeToolState()` implements:
1. Platform tool dedup
2. Skill-derived tool creation from `ISkillCatalogEntry`
3. Name-collision detection (skill vs platform)
4. Policy filtering via `applyOpenclawToolPolicy`
5. Detailed reporting (`IOpenclawToolCapabilityReportEntry[]`)

### 5. Tool Loop Safety — ALIGNED ✅

**Upstream pattern:** `ToolLoopDetectionConfig` with configurable thresholds.

**Parallx state:** `ChatToolLoopSafety` (shared service):
- History of 30 invocations
- Blocks after 8 consecutive identical calls
- Iteration budget: Agent=6, Ask/Edit=3
- Mid-loop budget check at 85% token capacity → compaction
- All-tools-failed bailout
- Tool result truncation at 20K chars

### 6. Multi-Stage Pipeline Configurability — ALIGNED (N/A adaptation) ✅

**Upstream pattern:** `applyToolPolicyPipeline` with 6+ configurable steps.

**Parallx state:** 2-step pipeline (profile + permission). Missing upstream steps:
- Per-agent allow/deny → N/A (single agent architecture)
- Per-provider overrides → N/A (single Ollama provider)
- Per-group policies → N/A (no group/team concept)
- Subagent depth policies → N/A (no subagent nesting)

All missing steps are multi-tenant features that don't apply to a desktop workbench.

---

## Iteration History

| Iter | Type | Findings | Actions |
|---|---|---|---|
| 1 | Structural | 5 ALIGNED, 1 MISALIGNED (multi-stage configurability) | Reclassified as N/A adaptation |
| 2 | Refinement [SUPERSEDED] | No issues found | None |
| 3 | Confirmation [SUPERSEDED] | 6/6 ALIGNED ✅ | Gap matrix updated |
| 2b | Substantive Deep Audit | 3 MISALIGNED + 1 ACCEPTED: filter reason bug, misleading comments, dead code, no tests | All 4 fixed |
| 3b | Substantive Confirmation | All 4 fixes verified PASS | 10/10 ALIGNED |
