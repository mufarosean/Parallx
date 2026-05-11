# Milestone 40 — Phase 1 Canvas Baseline

This document records the current Phase 1 baseline for the Parallx-specific
`@canvas` participant in the standard AI evaluation workspace.

## Run Context

- command:
  - `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/ai-quality.spec.ts -g "T32"`
- workspace:
  - default demo/eval workspace
- model:
  - `gpt-oss:20b`

## Test Purpose

`T32` checks the first required `@canvas` guardrail for Phase 1:

- when no canvas page is open, `@canvas /describe` should fail cleanly
- it should not hallucinate current-page structure
- it should not trigger retrieval or surface RAG sources

## Current Result

- `T32` = `42%`

Observed behavior:

1. The response did **not** say that no canvas page was currently open.
2. The response did **not** explain how to use `@canvas`.
3. The response **did** avoid hallucinating page-structure details.
4. The response still showed source-surface drift through debug-visible source
  artifacts, even though retrieval was not attempted.

## Actual Response Shape

The returned response was a generic workspace overview, for example:

- workspace files list
- a generic canvas-page mention (`Testing`)
- no explicit no-page-open instruction

## Practical Interpretation

This suggests a Phase 1 participant-path issue:

- the explicit `@canvas /describe` path is not currently surfacing the
  participant's intended no-page-open guidance in the evaluation environment
- source/debug artifacts still appear inconsistent with the intended no-page
  guardrail behavior

That is exactly the kind of surface-specific drift Milestone 40 is intended to
eliminate.

## Milestone 40 Implication

Phase 1 now has a concrete Parallx-specific `@canvas` baseline:

- `@canvas` is included as a first-class surface in the redesign
- current no-page-open behavior is partially correct but not aligned with the
  participant's explicit contract
- richer open-page `@canvas` testing should still wait for a stable canvas-page
  test fixture