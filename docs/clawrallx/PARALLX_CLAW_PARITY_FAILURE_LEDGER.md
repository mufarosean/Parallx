# Parallx Claw Parity Failure Ledger

**Status:** Active  
**Date:** 2026-03-24  
**Purpose:** Record explicit parity failures, resolved gaps, and external blockers for the NemoClaw-inspired claw runtime target.

---

## 1. Ledger Rules

Every parity divergence must be recorded as one of:

- `OPEN` = real runtime mismatch still requiring code or contract work,
- `RESOLVED` = mismatch closed in code and verified locally,
- `INTENTIONAL` = approved compatibility boundary rather than a hidden mismatch,
- `EXTERNAL` = cannot be completed in this repository without outside runtime/data support.

---

## 2. Current Ledger

| ID | Area | Status | Divergence | Evidence | Resolution path |
|----|------|--------|------------|----------|-----------------|
| PF-01 | Memory finalization | `RESOLVED` | Memory write-back could begin before the run reached the completed boundary. | `chatTurnSynthesis.ts` previously queued write-back before `post-finalization`. | `chatRuntimeLifecycle.ts` now defers queued memory write-back until `recordCompleted()` and drops it on abort/failure. |
| PF-02 | Bridge runtime ownership | `INTENTIONAL` | `ChatBridge` participants are not fully claw-native participants with runtime-owned internal orchestration. | Bridge participants remain external extensibility surfaces. | Formalize `ChatBridge` as an explicit `bridge-compatibility` boundary and keep shared interpretation/trace hooks visible. |
| PF-03 | Prompt authority across bridge surfaces | `INTENTIONAL` | Bridge participants may use runtime prompt helpers but are not the canonical prompt authority path. | Bridged handlers remain compatibility code owned by the contributing tool. | Keep one canonical prompt authority for claw-native surfaces and explicitly describe bridge prompt use as compatibility opt-in. |
| PF-04 | Tool and approval behavior across bridge surfaces | `INTENTIONAL` | Bridge handlers may still own internal behavior beyond the canonical claw-native tool loop. | This follows the explicit compatibility-boundary decision. | Treat bridge tools/participants as bounded compatibility, not as hidden runtime-owned surfaces. |
| PF-05 | Live NemoClaw A/B run availability | `EXTERNAL` | The current workspace does not include a runnable NemoClaw environment or captured comparison artifacts. | No NemoClaw runtime target is available in this repo. | Run the scenario catalog from `tests/ai-eval/clawParityBenchmark.ts` against a provisioned NemoClaw target, normalize the captured records with `tests/ai-eval/clawParityArtifacts.ts`, and import the results. |
| PF-06 | Live chat autonomy surface | `RESOLVED` | Live claw and OpenClaw agent-mode turns now create runtime-owned autonomy mirrors that drive the existing task/approval rail, so the user-visible autonomy surface is no longer split from the live runtime loop. | `src/built-in/chat/data/chatDataService.ts`, `src/built-in/chat/utilities/chatTurnExecutionConfig.ts`, `src/built-in/chat/utilities/chatTurnSynthesis.ts`, `src/built-in/chat/utilities/chatGroundedExecutor.ts`, and `src/openclaw/participants/openclawDefaultParticipant.ts` now create task mirrors, mirror tool/approval events, and enforce loop-safety; targeted unit validation passed (`16/16`) and the AI autonomy scenario summary recorded `100%` across boundary, approval, completion, and trace completeness. | Keep manual autonomy review tracked separately as a close-out blocker, and treat broader `ai-quality.spec.ts` retrieval/data-freshness regressions as independent non-parity failures. |

---

## 3. What Counts As A Fresh Failure

A new failure must be added here if:

1. a required scenario in the parity catalog fails,
2. a runtime seam is still described as `ACTIVE` because the code path is only partially migrated,
3. a compatibility path becomes hidden again instead of explicit.