# Parallx Claw Parity Spec

**Status:** Active parity contract  
**Date:** 2026-03-24  
**Purpose:** Define the exact NemoClaw-inspired behaviors we care about, the matched scenario strategy, and the acceptance method for Parallx claw parity work.

---

## 1. Scope

Parallx is not trying to run NemoClaw wholesale inside the workbench.

Parallx is trying to match the runtime behaviors that matter:

- explicit autonomy boundaries,
- explicit memory boundaries,
- file-first skills and prompts,
- runtime-owned tool and approval control,
- explainable checkpoints and traces,
- visible customization,
- explicit extensibility boundaries.

The parity target is therefore behavioral parity on the runtime contract, not deployment-model parity on Docker, OpenShell, or upstream daemon assumptions.

---

## 2. Exact Behaviors That Matter

### 2.1 Autonomy

We care that the runtime owns multi-step execution and tool-loop coordination.

Acceptance signal:

- the run can be explained from runtime checkpoints and tool traces rather than participant-local orchestration.

### 2.2 Memory

We care that memory writes happen only after an approved finalization boundary.

Acceptance signal:

- no memory write-back begins before `post-finalization`,
- aborted or failed runs do not leak queued memory side effects.

### 2.3 Skills

We care that capability behavior is file-first, inspectable, and source-aware.

Acceptance signal:

- the runtime can explain which skill or prompt files affected a turn,
- invalid file-backed skill inputs fail visibly rather than silently.

### 2.4 Tools

We care that tool execution is runtime-controlled rather than participant-local.

Acceptance signal:

- runtime-owned validation, approval, execution, and provenance records exist for claw-native tool use.

### 2.5 Approvals

We care that approval state is a first-class runtime concern.

Acceptance signal:

- approval request, resolution, and execution ordering are explicit in traces.

### 2.6 Prompt Authority

We care that claw-native surfaces use one canonical runtime prompt contract.

Acceptance signal:

- default, `@workspace`, and `@canvas` emit shared prompt-stage checkpoints,
- any non-native bridge surface is explicit as compatibility rather than invisible prompt authority.

### 2.7 Checkpoints And Traceability

We care that a run can be reconstructed from stable named checkpoints.

Acceptance signal:

- prompt, tool, approval, and finalization boundaries are visible,
- completion, abort, and failure outcomes are explicit.

### 2.8 Customizability

We care that user and workspace customization remain local-first and inspectable.

Acceptance signal:

- prompt-layer inputs are visible,
- runtime behavior is not secretly controlled by hidden strings.

### 2.9 Extensibility

We care that extensibility boundaries are explicit about what the runtime owns versus what compatibility surfaces own.

Acceptance signal:

- `ChatBridge` is an explicit compatibility boundary,
- bridge participants still receive shared interpretation and trace hooks,
- bridge participation is never misdescribed as a hidden second claw runtime.

---

## 3. Matched Scenario Strategy

The canonical machine-readable scenario catalog lives in [tests/ai-eval/clawParityBenchmark.ts](../../tests/ai-eval/clawParityBenchmark.ts).

The canonical artifact normalization and comparison helpers live in [tests/ai-eval/clawParityArtifacts.ts](../../tests/ai-eval/clawParityArtifacts.ts).

Matched A/B execution should use the same scenario ids, prompts, and required signals for both systems.

### 3.1 Runner shape

For each scenario:

1. run the prompt against Parallx claw,
2. run the equivalent prompt against NemoClaw,
3. capture:
   - final user-visible answer,
   - tool decisions,
   - approval events,
   - checkpoint/order artifacts,
   - runtime metadata or logs,
4. normalize those artifacts into one comparison record,
5. mark the scenario `pass`, `fail`, or `blocked`.

### 3.2 Comparison method

Two comparison modes are allowed:

1. `live-ab`
   Use this when both runtimes can be exercised directly with the same prompt.
2. `artifact-compare`
   Use this when one or both runtimes must be compared through captured traces, transcripts, or runtime metadata rather than direct automation.

### 3.3 Why this is the correct proposal

This keeps parity measurable without forcing Parallx to adopt NemoClaw's excluded operating model.

It also makes parity durable in-repo instead of ephemeral in chat.

---

## 4. Current Execution Constraint

This repository can fully execute the Parallx side of the benchmark now.

Direct NemoClaw live execution remains an external environment concern unless a runnable NemoClaw target and capture path are provided in the same workspace or attached environment.

That does not block defining the scenario catalog, the acceptance signals, or the divergence ledger.

---

## 5. Current Acceptance Rule

Parity is acceptable when:

1. every required scenario has either a passing comparison record or an explicit external blocker,
2. no remaining runtime seam is still hidden under an `ACTIVE` migration description,
3. any intentional divergence is documented as an approved compatibility boundary,
4. the Milestone 40 tracker and divergence ledger match the implementation truth.