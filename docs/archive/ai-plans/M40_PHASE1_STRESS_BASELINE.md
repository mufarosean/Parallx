# Milestone 40 — Phase 1 Stress Baseline

This document records the corrected Phase 1 baseline for the stress workspace
evaluation suite after remaking the workspace through normal Parallx
initialization.

## Run Context

- command:
  - `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/stress-quality.spec.ts`
- workspace override:
  - `tests/ai-eval/stress-workspace`
- model:
  - `gpt-oss:20b`
- remade via:
  - `tests/ai-eval/workspace-bootstrap-diagnostic.spec.ts`
- source fixture persisted index:
  - present (`tests/ai-eval/stress-workspace/.parallx/data.db` now exists locally after normal Parallx initialization)

## Current Result

- full suite score: `95%` (`Excellent`)

Per-test results:

- `S-T01` = `100%`
- `S-T02` = `100%`
- `S-T03` = `83%`
- `S-T04` = `100%`
- `S-T05` = `70%`
- `S-T06` = `100%`
- `S-T07` = `100%`
- `S-T08` = `100%`
- `S-T09` = `100%`
- `S-T10` = `100%`

## Practical Interpretation

The earlier readiness blocker was caused by the stress fixture not having been
initialized through normal Parallx workspace bootstrap.

Once the stress workspace was opened through the normal Parallx flow and a real
`.parallx/data.db` was created, the suite became runnable and produced a strong
quality baseline.

That means the current Milestone 40 Phase 1 fact pattern is:

1. default-workspace parity regressions are valid and runnable
2. Exam 7 phrasing-variant coverage is valid and runnable
3. stress-workspace coverage is valid and runnable after proper workspace bootstrap
4. the earlier stress blocker should not be treated as a general user indexing failure

## Remaining Quality Gaps

- `S-T03` = `83%`
  - folder overview for `notes/` still has room for improvement
- `S-T05` = `70%`
  - duplicate-filename comparison remains the weakest stress case

## Milestone 40 Implication

Milestone 40 Phase 1 no longer needs to treat the stress suite as a readiness
blocker.

The stress suite is now a valid verification surface and should be used as a
real quality baseline going forward.