# Extension Development Agent Framework

This file documents the agent framework used for building Parallx extensions
by studying upstream open-source reference projects.

## Agent Overview

| Agent | Purpose |
|-------|---------|
| **Extension Orchestrator** | Master orchestrator — drives the full lifecycle from feature inventory through 3-iteration implementation cycles |
| **Source Analyst** | Reads upstream source code, produces research with explicit snippets and architectural analysis |
| **Architecture Mapper** | Maps research to Parallx extension architecture — defines files, data flow, API usage, enforces extension boundary |
| **Code Executor** | Implements from architecture plans — minimum code, source-traced, stays inside extension directory |
| **Verification Agent** | Deep verification across 5 dimensions: logic, tests, contract compliance, upstream fidelity, code quality |
| **UX Guardian** | Validates extension UX and UI visual consistency with the Parallx design system, ensures core workbench surfaces are not impacted |

## Workflow

```
Phase 0: Feature Inventory (milestone doc)
  └─ User approves milestone doc

For each feature domain (D1 → D2 → ...):
  For each feature:
    Iteration 1 (Major Implementation):
      Source Analyst → Architecture Mapper → [Approval Gate] → Code Executor → Verification
    Iteration 2 (Gap Closure):
      Source Analyst → Architecture Mapper → Code Executor → Verification
    Iteration 3 (Final Refinement):
      Source Analyst → Architecture Mapper → Code Executor → Verification → UX Guardian
  Domain CLOSED → Commit
```

## Core Rules

1. **Study source, then build** — the Source Analyst reads upstream code before ANY implementation.
2. **Extension boundary is sacred** — all code stays in the extension directory.
3. **3-iteration discipline** — every feature: major implementation → gap closure → refinement.
4. **No core changes without user approval** — the Architecture Mapper flags, the Orchestrator asks.
5. **Trace every feature** — every piece of code cites its upstream source.

---

## Error Recovery Protocol

When the Verification Agent or UX Guardian finds blocking issues:

### Critical issues (any iteration)
1. STOP — present the issue to the Orchestrator with file/line/fix recommendation.
2. Orchestrator directs the Code Executor to fix the specific file(s).
3. Code Executor implements the fix, updating only affected files.
4. Re-invoke the Verification Agent on the changed files only.
5. Do NOT re-run Source Analyst or Architecture Mapper for a fix cycle.

### Logic errors (any iteration)
1. Return to Code Executor with specific fix instructions from the verification report.
2. Do NOT proceed to the next iteration until the logic error is resolved.

### Minor issues (iteration 1–2 only)
1. Log the issue in the domain tracker.
2. Proceed to the next iteration — the issue will be addressed there.
3. In iteration 3, all previously logged minor issues must be resolved or explicitly deferred.

### UX/UI issues (iteration 3)
1. If blocking: return to Code Executor with the UX Guardian's specific fix list.
2. Re-invoke UX Guardian after the fix — do NOT skip the re-check.
3. If non-blocking: log the issue and proceed if the Orchestrator judges it acceptable.

---

## Testing Strategy

### Who writes tests
- **Code Executor** writes unit tests for public functions and services in the extension.
- **Verification Agent** runs the full test suite and reports results.
- **Code Executor** adds tests for edge cases in iteration 2.

### When tests are written
| Iteration | Testing focus |
|-----------|--------------|
| 1 | Happy-path unit tests for core services and models |
| 2 | Edge-case tests, error-path tests |
| 3 | Integration tests (views + services), cleanup of test gaps |

### Test locations
- Unit tests: `ext/<ext-id>/tests/<feature>.test.ts`
- E2E tests: `tests/e2e/<NN>-<ext-id>-<feature>.spec.ts` (if needed)
- Run existing E2E suite to verify no core regressions.

### Pass criteria
- Iteration 1: Happy paths pass; edge-case gaps are documented.
- Iteration 2: All identified gaps have tests that pass.
- Iteration 3: Zero known test gaps; all tests pass.

## Agent Files

- `.github/agents/Extension Orchestrator.agent.md`
- `.github/agents/Source Analyst.agent.md`
- `.github/agents/Architecture Mapper.agent.md`
- `.github/agents/Code Executor.agent.md`
- `.github/agents/Verification Agent.agent.md`
- `.github/agents/UX Guardian.agent.md`

## Completion Procedure

A Milestone 40 task is complete only when all of the following are true:

1. The affected surfaces are named.
2. The shared layer being centralized is named.
3. The verification commands were run, or an explicit blocker was recorded.
4. The milestone doc and any companion artifact reflect the real outcome.
5. Any remaining compatibility path is explicitly tracked.

When a milestone task is actually complete, mark it `✅` in the relevant
milestone tracking document. If the outcome deviates from the intended design,
record the deviation next to the completion mark.

## Drift Prevention

If context feels incomplete, do not improvise from memory.

Re-read:

- `.github/AGENTS.md`
- `.github/instructions/parallx-instructions.instructions.md`
- `docs/Parallx_Milestone_40.md`

Then continue.