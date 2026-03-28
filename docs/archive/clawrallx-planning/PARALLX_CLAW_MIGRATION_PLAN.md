# Parallx Claw Migration Plan

**Status:** Planning complete  
**Date:** 2026-03-24  
**Purpose:** Define the reversible migration path from legacy Parallx AI
orchestration to the new Parallx claw runtime.

---

## 1. Executive Summary

Parallx will replace its legacy AI orchestration through a **parallel runtime
migration**, not through repository rollback and not through a large in-place
rewrite.

The migration is governed by four rules:

1. preserve the proven substrate,
2. expose the new runtime explicitly,
3. keep rollback available during migration,
4. remove legacy orchestration only after parity is demonstrated.

---

## 2. Why Migration, Not Revert

The repository history contains AI work interleaved with unrelated product
changes. Reverting to a pre-AI commit would destroy unrelated progress and still
would not define the architecture Parallx now needs.

Therefore the only safe strategy is controlled replacement inside the current
codebase.

---

## 3. Migration Principles

1. **Preserve foundations**
   Retrieval, indexing, vector storage, model transport, memory storage, and
   session persistence remain in place.
2. **No hidden parallel path**
   Dual runtime lanes may exist temporarily, but both must be named and tracked.
3. **Small reversible units**
   Each phase must have explicit verification and rollback logic.
4. **Parity before removal**
   Legacy code is removed only after the new runtime becomes the default and
   proves stable.
5. **No monolith swap**
   Migration cannot simply move the old monolith into a differently named
   runtime module.

---

## 4. Legacy Lane Definition

The legacy lane is the current chat orchestration path rooted in:

- `src/built-in/chat/participants/defaultParticipant.ts`
- `src/built-in/chat/data/chatDataService.ts`
- `src/built-in/chat/utilities/chatTurnRouter.ts`
- `src/built-in/chat/utilities/chatTurnPrelude.ts`
- `src/built-in/chat/utilities/chatSystemPromptComposer.ts`

This lane remains available only as long as it is needed for fallback and
verification.

---

## 5. New Lane Definition

The new lane is a Parallx-native claw runtime with:

- explicit request interpretation,
- one prompt contract,
- one skill contract,
- one execution contract,
- explicit approvals,
- explicit trace/provenance,
- explicit session/run/checkpoint boundaries,
- adapters to the preserved Parallx substrate.

---

## 6. Runtime Selector Strategy

Runtime selection must be:

- explicit,
- observable,
- testable,
- reversible.

Requirements:

1. the app must be able to identify which runtime handled a turn,
2. tests must be able to force either runtime while both exist,
3. the selector must remain available through the stabilization period.

This selector is a migration device, not the intended final user-facing model.

---

## 7. Phase Plan

### Phase 1: Documentation and decisions

Outputs:

- redesign packet under `docs/clawrallx/`,
- explicit decisions ledger,
- dependency policy,
- intake matrix,
- target architecture,
- migration plan.

Gate:

- architecture and migration boundaries are explicit enough to implement.

### Phase 2: Adapter seam extraction

Outputs:

- the current orchestration hotspots are reduced to clearer adapter and bridge
  roles,
- the preserved substrate is consumable by the future runtime without hidden
  participant-local assumptions.

Gate:

- dual-lane coexistence becomes technically possible without duplicating large
  business logic blocks.

### Phase 3: Claw runtime skeleton and preserved-service integration

Outputs:

- runtime session manager,
- execution engine skeleton,
- prompt assembly service,
- skill registry skeleton,
- bridge into preserved substrate.

Gate:

- the existing chat UI can submit a turn to the new runtime even before full
  parity.

### Phase 4: Prompt, skill, and runtime-contract bring-up

Outputs:

- canonical prompt authority active in the new runtime,
- file-first skill contract active in the new runtime,
- execution contract enforced by the new runtime.

Gate:

- the new runtime owns prompt and skill behavior for its lane.

### Phase 5: Approval, trace, and persistence parity

Outputs:

- approval objects emitted by runtime,
- trace spans and provenance emitted by runtime,
- persistence and checkpoint boundaries enforced.

Gate:

- major safety and explainability behavior reaches parity or improvement.

### Phase 6: Eval and regression parity

Outputs:

- side-by-side runtime comparison results,
- regression and AI-eval evidence,
- documented parity gaps if any remain.

Gate:

- new runtime is acceptable as default candidate.

### Phase 7: Default cutover

Outputs:

- new runtime becomes default,
- legacy lane remains available for rollback during stabilization.

Gate:

- cutover verified and reversible.

### Phase 8: Legacy removal

Outputs:

- old orchestration paths deleted,
- compatibility bridges removed or reduced to documented permanent APIs if
  justified.

Gate:

- stabilization period complete and rollback no longer required.

---

## 8. Adapter Seam Worklist

Minimum seam work needed for coexistence:

1. make the existing participant path a thin bridge rather than the runtime
   owner,
2. split `chatDataService.ts` into narrower adapter-facing roles,
3. isolate request parsing and bounded route detection from legacy downstream
   orchestration,
4. centralize prompt assembly under a new runtime contract,
5. map tool execution, approval, and trace output through explicit runtime
   services.

---

## 9. Data Continuity Plan

Migration must not casually discard or invalidate:

- existing chat sessions,
- persisted messages,
- retrieval indexes,
- vector store contents,
- memory state,
- approval safety behavior.

First-cut rule:

- existing persistence remains authoritative,
- the new runtime adapts to it,
- optional new checkpoint data may be added without breaking legacy session
  continuity.

---

## 10. Verification Gates By Phase

Each phase must define exact verification, not generic "tests pass" language.

At minimum, migration verification must cover:

- local startup with only allowed dependencies,
- chat turn handling through each runtime lane,
- prompt assembly behavior,
- skill loading behavior,
- tool execution behavior,
- approval behavior,
- trace and provenance output,
- session restore and workspace continuity,
- AI-eval parity for targeted behaviors.

---

## 11. Rollback Strategy

Rollback means switching active handling back to the legacy runtime lane without
losing:

- session continuity,
- retrieval capability,
- approval safety,
- ability to continue work in the current workspace.

If a migration phase cannot satisfy that condition, the phase is not ready for
default cutover.

---

## 12. Legacy Removal Conditions

Legacy orchestration may be removed only when:

1. the new runtime is the default path,
2. rollback remained available through stabilization,
3. parity evidence is recorded,
4. compatibility bridges are named and either retired or justified,
5. the removal task itself is explicitly documented.

---

## 13. Risks And Mitigations

| Risk | Mitigation |
|------|------------|
| Half-migrated prompt authority | enforce one canonical prompt contract before default cutover |
| Duplicated tool behavior | centralize tool execution under runtime service |
| Hidden approval regressions | make approval objects and audit records runtime outputs |
| Stale compatibility seams | track every temporary bridge as a removal task |
| New monolith formation | review responsibilities against target architecture before each migration phase |

---

## 14. Milestone And Documentation Sync

The migration is not self-documenting. Each major phase must keep these docs in
sync:

- `PARALLX_CLAW_UPSTREAM_INTAKE_MATRIX.md`
- `PARALLX_CLAW_TARGET_ARCHITECTURE.md`
- `PARALLX_CLAW_MIGRATION_PLAN.md`
- `PARALLX_CLAW_RUNTIME_CONTRACT.md`
- `PARALLX_CLAW_VERIFICATION_AND_EVAL_PLAN.md`
- `PARALLX_CLAW_DECISIONS.md`

Milestone 40 companion-artifact references should also point to this packet.

---

## 15. Completion Gate

This migration plan is complete only when:

1. the legacy and new lanes are explicitly named,
2. the selector path is explicit,
3. rollback is defined,
4. each migration phase has a gate,
5. the conditions for final legacy removal are unambiguous.

This document meets that planning-phase gate.