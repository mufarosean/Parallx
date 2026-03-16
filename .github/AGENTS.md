# Milestone 40 Grounding Instructions

This file is the grounding document for Milestone 40 work.

Read this file, [../instructions/parallx-instructions.instructions.md](./instructions/parallx-instructions.instructions.md), and [../../docs/Parallx_Milestone_40.md](../docs/Parallx_Milestone_40.md) before starting or resuming any Milestone 40 phase.

## Purpose

Milestone 40 is not a patch milestone. It is an end-to-end redesign of the AI
request stack so Parallx can be defended and explained front-to-end.

The objective is to build one unified AI system across:

- default chat
- explicit participants such as `@workspace` and `@canvas`
- tool-contributed participants
- planning/evidence layers
- configuration and policy behavior
- agent execution surfaces where behavior overlaps

## Non-Negotiables

1. No split-brain architecture.
   Do not introduce a new path without explicitly tracking the old path it
   replaces, the switch-over condition, and the removal task.

2. Preserve working foundations.
   Indexing, retrieval substrate, vector store, memory storage, unified AI
   config, session persistence, and approval/trace foundations are not to be
   casually replaced.

3. Redesign the right layers.
   Request interpretation, routing policy, prelude flow, participant
   orchestration boundaries, and shared prompt behavior are redesign targets.

4. Evidence before invention.
   Read the relevant VS Code references and Milestone 40 evidence ledger before
   making architecture claims.

5. Tests define truth.
   If a real failure matters, encode it as a regression test before relying on
   memory or prose.

## Developer Conduct for Milestone 40

Act like a serious systems developer working on a risky architectural redesign.

- Be conservative with architecture changes and explicit about tradeoffs.
- Prefer centralized shared layers over clever local fixes.
- Do not hide compatibility paths.
- Do not describe work as complete unless the milestone matrix, tests, and
  affected surfaces agree.
- Keep implementation steps small enough that regressions can be traced.
- When uncertain, stop widening scope and re-read the grounding files.

## Required Reading Order

Before any Milestone 40 work session:

1. Read this file.
2. Read `.github/instructions/parallx-instructions.instructions.md`.
3. Read `docs/Parallx_Milestone_40.md`.
4. Read any phase-specific companion artifact already created for the current
   phase.

If the work resumes after a long context gap or a new phase begins, repeat the
same reading order.

## Phase Procedure

For every Milestone 40 phase:

1. Re-read the grounding files before editing code.
2. State the phase objective and success test in working notes or the current
   task context.
3. Identify which AI surfaces are touched.
4. Identify which shared layer is being centralized.
5. Identify which old path remains and how it will be removed.
6. Run the required verification commands for that phase.
7. Update the milestone doc or companion artifact with factual outcomes.

## Commit Procedure

Milestone 40 should have disciplined commit boundaries, but commits must still
follow the current user/session policy.

- Prepare work in small, reviewable phase-task units.
- Keep each unit scoped to one milestone task or one tightly coupled pair of
  tasks.
- Record the intended commit boundary and suggested commit message in notes if
  needed.
- Do not create the git commit unless the user explicitly asks for it.
- Do not mix unrelated cleanup into a milestone task commit boundary.

Suggested commit message pattern when commits are requested:

- `M40 P1.2 add greeting parity regressions`
- `M40 P2.1 introduce shared request interpretation contract`
- `M40 P3.1 extract shared participant orchestration`

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