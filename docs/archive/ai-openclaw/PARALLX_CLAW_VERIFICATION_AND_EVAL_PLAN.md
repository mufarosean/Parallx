# Parallx Claw Verification And Eval Plan

**Status:** Planning complete  
**Date:** 2026-03-24  
**Purpose:** Define the parity, regression, and evaluation gates for the Parallx
claw redesign.

---

## 1. Purpose And Scope

The claw redesign is only real if it can be verified. This document defines the
behavioral gates that determine whether the new runtime is acceptable.

---

## 2. Verification Philosophy

Verification for this redesign follows these rules:

- tests define truth,
- parity is measured rather than assumed,
- runtime explainability is part of acceptance,
- clean architecture claims are not sufficient without behavioral evidence.

The new runtime is not ready because it feels cleaner. It is ready only when
verification artifacts show that it preserves required behavior and improves the
targeted failure modes.

---

## 3. Verification Surfaces

The redesign must verify at least these surfaces:

- local startup under the allowed dependency envelope,
- chat request handling,
- prompt and skill loading,
- tool execution,
- approvals,
- retrieval continuity,
- session restore,
- workspace switch continuity,
- trace/provenance emission,
- memory write-back behavior.

---

## 4. Phase-Gated Verification

Each migration phase must have explicit verification.

Examples:

- adapter-seam phase verifies coexistence without hidden duplicated behavior,
- runtime-skeleton phase verifies the UI can submit turns through the new lane,
- prompt/skill phase verifies canonical prompt authority and file-first skill
  behavior,
- approval/trace phase verifies runtime-originated approvals and provenance,
- parity phase verifies side-by-side outcome comparisons.

---

## 5. Runtime Comparison Strategy

While both runtime lanes exist, tests and evaluation tooling must be able to:

- force the legacy lane,
- force the new lane,
- compare equivalent behavior across both,
- record known intentional differences.

The comparison period is mandatory before default cutover.

---

## 6. AI-Eval Integration

The redesign should reuse and extend the existing Parallx AI-eval infrastructure
rather than inventing a separate eval framework.

Eval work should focus on:

- conversational cleanliness,
- grounded retrieval behavior,
- approval clarity,
- source/provenance honesty,
- stable response behavior across migration.

---

## 7. Manual Verification Expectations

Automated coverage is primary, but a small set of manual checks still matters:

- startup under allowed dependencies only,
- approval UX clarity,
- visible runtime identity during dual-lane period,
- prompt/skill inspection behavior,
- session continuity across runtime selection.

---

## 8. Failure Handling

When parity fails, the plan must define:

- whether the issue blocks the current phase,
- whether rollback is required,
- whether the difference is an intentional approved deviation,
- which document records the outcome.

---

## 9. Acceptance Gates For Default Cutover

The new runtime may become default only when:

1. allowed dependency envelope is preserved,
2. required substrate continuity is preserved,
3. prompt authority is singular in the new lane,
4. skill behavior is file-first and inspectable,
5. approval, trace, and persistence behavior are acceptable,
6. regression and AI-eval evidence are recorded.

---

## 10. Post-Cutover Stabilization Gates

After cutover, the project must still verify:

- rollback remains available during stabilization,
- no hidden legacy path becomes primary again,
- no new split-brain prompt or skill paths reappear,
- no major parity regression emerges from live use.

---

## 11. Completion Gate

This document is complete when the redesign has an explicit verification story
for both migration and cutover, and when runtime acceptance is defined in
behavioral rather than stylistic terms.

This document meets that planning-phase gate.