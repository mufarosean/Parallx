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
| **UX Guardian** | Validates extension UX and ensures core workbench surfaces are not impacted |

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