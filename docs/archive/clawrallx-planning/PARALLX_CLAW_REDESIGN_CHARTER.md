# Parallx Claw Redesign Charter

**Status:** Planning complete, implementation not started  
**Date:** 2026-03-24  
**Scope:** Clean-slate AI runtime redesign for Parallx using a Parallx-owned claw-style architecture.

---

## 1. Purpose

This document defines the product and architecture charter for replacing the
current Parallx AI orchestration with a Parallx-owned claw-style runtime.

The redesign exists because Parallx's current AI path has outgrown its original
shape. The local AI substrate is strong, but the orchestration layer remains too
concentrated in a small number of files and too dependent on mixed routing,
prompt, tool, and side-effect logic.

This charter exists so the redesign does not drift into one of three bad
outcomes:

1. a risky git-history rollback that destroys unrelated progress,
2. a literal upstream transplant that imports the wrong operational model,
3. a second Parallx-specific monolith hidden behind new names.

---

## 2. Problem Statement

Parallx's current AI layer has two contradictory traits:

1. the substrate is already valuable and worth preserving,
2. the orchestration path is too entangled to keep extending safely.

The current system already has proven building blocks:

- model transport,
- retrieval,
- indexing,
- vector storage,
- memory storage,
- chat session persistence,
- approval and trace foundations.

But the main runtime path still centralizes too much responsibility in the chat
orchestration layer, especially around:

- request interpretation,
- routing authority,
- prompt assembly,
- tool-loop behavior,
- memory write-back,
- response finalization.

The result is a system that can work but is too hard to defend, too hard to
evolve, and too vulnerable to architectural drift.

---

## 3. Why A Revert Is Not Acceptable

Parallx cannot treat this redesign as a repository rewind.

There is no single safe commit that cleanly marks "before AI" versus "after
AI," and later commits contain unrelated product work that should not be lost.

Because of that, the redesign must happen through an explicit migration inside
the current codebase.

That migration must:

- preserve unrelated repo progress,
- preserve the proven AI substrate,
- replace the orchestration layer deliberately,
- leave a reversible path until parity is demonstrated.

---

## 4. Redesign Goal

The goal is to build a **Parallx-owned claw-style runtime** that:

- runs inside Parallx,
- uses local models first,
- preserves Parallx's strong substrate,
- replaces the current orchestration path,
- exposes one explicit prompt contract,
- exposes one explicit skill contract,
- exposes one explicit execution contract,
- remains explainable from user turn to persisted result.

This is not a goal to "run NemoClaw as-is inside Parallx." It is a goal to
translate the right claw runtime ideas into a Parallx-native desktop runtime.

---

## 5. Upstream Position

Parallx will use the following upstream posture:

- **Primary architectural reference:** NemoClaw
- **Secondary architectural reference:** OpenClaw
- **Ownership posture:** Parallx-owned selective vendoring and adaptation
- **Not allowed:** whole-repo copy, external-runtime dependency, unexamined
  import of upstream operating assumptions

The redesign values from upstream are:

- explicit runtime contracts,
- file-first structure,
- explicit approvals and policy,
- inspectable capability loading,
- clean separation between runtime control and model execution.

The redesign explicitly does not inherit these upstream assumptions in the first
cut:

- always-on gateway as a required second app,
- Docker or OpenShell runtime requirements,
- Python blueprint execution,
- multi-channel messaging surfaces,
- hosted control-plane dependency,
- cloud-first model routing.

---

## 6. Non-Negotiables

### 6.1 Preserve working foundations

The following are not casual rewrite targets for the first cut:

- `src/services/languageModelsService.ts`
- `src/services/retrievalService.ts`
- `src/services/indexingPipeline.ts`
- `src/services/vectorStoreService.ts`
- `src/services/chatService.ts`
- `src/services/chatSessionPersistence.ts`

### 6.2 Replace the right layers

The first-cut redesign targets are:

- `src/built-in/chat/participants/defaultParticipant.ts`
- `src/built-in/chat/data/chatDataService.ts`
- `src/built-in/chat/utilities/chatTurnRouter.ts`
- `src/built-in/chat/utilities/chatTurnPrelude.ts`
- `src/built-in/chat/utilities/chatSystemPromptComposer.ts`

### 6.3 No split-brain end state

Temporary dual paths are allowed only during migration, and only if the plan
names:

- the old path,
- the new path,
- the switch-over condition,
- the removal task.

### 6.4 File-first and inspectable

Skills and prompt layers must become visible, inspectable, and testable.
Permanent hidden prompt fragments and permanent hardcoded bundled skill strings
are not acceptable as the final design.

### 6.5 Local-first

Ollama remains an allowed dependency for the first cut. External OpenClaw,
external NemoClaw, Docker, OpenShell, Python blueprint runtime, and hosted
NVIDIA inference are not first-cut assumptions.

---

## 7. Deliverable Packet

The redesign packet lives under `docs/clawrallx/` and consists of:

1. `PARALLX_CLAW_REDESIGN_CHARTER.md`
2. `PARALLX_CLAW_UPSTREAM_INTAKE_MATRIX.md`
3. `PARALLX_CLAW_TARGET_ARCHITECTURE.md`
4. `PARALLX_CLAW_MIGRATION_PLAN.md`
5. `PARALLX_CLAW_DEPENDENCY_POLICY.md`
6. `PARALLX_CLAW_SKILLS_AND_PROMPTS_SPEC.md`
7. `PARALLX_CLAW_RUNTIME_CONTRACT.md`
8. `PARALLX_CLAW_VERIFICATION_AND_EVAL_PLAN.md`
9. `PARALLX_CLAW_USER_MODEL.md`
10. `PARALLX_CLAW_DECISIONS.md`

This packet is the durable in-repo version of the completed planning phase.

---

## 8. End-State Definition

The redesign is successful only when the following are true:

1. Parallx uses a Parallx-native claw runtime as its primary AI execution path.
2. The preserved substrate still handles model transport, retrieval, indexing,
   vector storage, memory storage, and session persistence.
3. Prompt authority is centralized under one contract.
4. Skills are file-first and inspectable.
5. Runtime execution is governed by one explicit contract.
6. Approval, trace, and write-back behavior are runtime features rather than UI
   side effects.
7. The legacy orchestration path is either removed or explicitly tracked as a
   temporary compatibility path with a removal plan.

---

## 9. Charter Completion Gate

This charter is complete when it defines:

- why the redesign exists,
- why rollback is unsafe,
- what is preserved,
- what is replaced,
- how upstream is used,
- what the first-cut dependency boundary is,
- what the documentation packet is,
- what success means.

This document meets that gate and serves as the entry point to the rest of the
packet.