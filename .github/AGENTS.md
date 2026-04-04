# Extension Development Agent Framework

This file documents the agent framework used for building **external** Parallx
extensions by studying upstream open-source reference projects.

**External extensions** live in `ext/<extension-id>/` and communicate with Parallx
exclusively through the public extension API (`parallx.*`). They are NOT built-in
tools (`src/built-in/`) — they are standalone packages that can be installed,
activated, and deactivated per-workspace via the Tool Gallery.

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

### Extension Development Workflow
- `.github/agents/Extension Orchestrator.agent.md`
- `.github/agents/Source Analyst.agent.md`
- `.github/agents/Architecture Mapper.agent.md`
- `.github/agents/Code Executor.agent.md`
- `.github/agents/Verification Agent.agent.md`
- `.github/agents/UX Guardian.agent.md`

### Storage Migration Workflow (M53)
- `.github/agents/Migration Orchestrator.agent.md`
- `.github/agents/Impact Analyst.agent.md`
- `.github/agents/Migration Executor.agent.md`
- `.github/agents/Migration Verifier.agent.md`
- `.github/agents/Regression Sentinel.agent.md`

---

# Storage Migration Agent Framework (Milestone 53)

This section documents the agent framework used for the **Portable Storage
Architecture** migration — moving Parallx from localStorage to file-backed
storage in `data/` (global) and `.parallx/` (per-workspace).

This is a **core system migration**, not an extension build. Every file touched
is a core Parallx file. The governing document is `docs/Parallx_Milestone_53.md`.

## Agent Overview (M53)

| Agent | Purpose |
|-------|---------|
| **Migration Orchestrator** | Master coordinator — drives domain-by-domain execution through task-verify-advance cycle |
| **Impact Analyst** | Pre-implementation analysis — reads call sites, maps data flow, produces impact reports with exact file:line references |
| **Migration Executor** | Implements changes from impact reports — creates new files, modifies existing code, minimum diff |
| **Migration Verifier** | Post-task verification — TypeScript check, tests, data integrity, no localStorage remnants |
| **Regression Sentinel** | Post-domain full-codebase regression check — build, tests, localStorage audit, cross-domain interaction |

## Workflow (M53)

```
For each domain (D0 → D1 → D2 → D3 → D4 → D5 → D6):
  For each task:
    Impact Analyst → [Approval Gate] → Migration Executor → Migration Verifier
    If FAIL → fix cycle (max 2) → re-verify
    If PASS → advance to next task

  After all tasks in domain:
    Regression Sentinel (6 dimensions)
    If PASS → COMMIT domain → advance
    If FAIL → fix cycle → re-run sentinel
```

## Core Rules (M53)

1. **Verify before advancing** — no task or domain proceeds without passing verification.
2. **Data integrity above all** — every change preserves existing data. No silent data loss.
3. **Impact analysis first** — no code is written without a structured impact report.
4. **One domain, one commit** — atomic, clean commits per completed domain.
5. **IStorage is the abstraction boundary** — change the backend, not the consumers.
6. **Backward-compatible migration** — old localStorage data must be readable and migratable.

## Error Recovery Protocol (M53)

### Task-level failures
1. Migration Verifier reports FAIL with file:line and fix recommendation.
2. Migration Orchestrator directs Migration Executor to fix.
3. Migration Verifier re-checks only the failed checks.
4. Max 2 fix cycles per task. After 2, escalate to user.

### Domain-level regressions
1. Regression Sentinel reports FAIL with dimension(s) and file:line.
2. If caused by current domain → Migration Executor fixes → re-run sentinel.
3. If caused by interaction with previous domain → STOP. Escalate to user.
4. Max 2 fix rounds. After 2, escalate to user.

### Design issues
If any agent discovers the M53 plan is insufficient (e.g., a missed consumer,
incorrect migration map, dependency loop between domains):
1. STOP all work.
2. Report the issue to the user with full details.
3. Wait for the user to update the milestone doc.
4. Resume only after the doc is updated.

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

For Extension Development:
- `docs/Parallx_Milestone_<current>.md`

For Storage Migration (M53):
- `docs/Parallx_Milestone_53.md`

Then continue.