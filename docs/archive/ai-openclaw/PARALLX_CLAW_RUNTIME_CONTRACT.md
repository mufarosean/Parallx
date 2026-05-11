# Parallx Claw Runtime Contract

**Status:** Planning complete  
**Date:** 2026-03-24  
**Purpose:** Define the normative runtime behavior contract for the Parallx
claw runtime.

---

## 1. Purpose And Scope

The new claw runtime must be defined by explicit execution contracts rather than
by emergent behavior spread across participants, utilities, and UI side
effects.

This document defines those contracts.

---

## 2. Runtime Entities

The runtime contract defines these core entities:

- **Session**: durable conversation continuity boundary,
- **Run**: one execution attempt for one user turn,
- **Checkpoint**: explicit persisted boundary during a run,
- **Approval**: structured approval object used to gate restricted behavior,
- **Tool invocation**: validated tool call under runtime control,
- **Trace span**: structured execution/provenance record,
- **Finalization event**: explicit end-of-run outcome.

---

## 3. Session Contract

A session must have:

- stable identity,
- continuity with persisted transcript data,
- compatibility with the preserved chat/session substrate,
- enough runtime metadata to explain current state.

The runtime may extend session metadata but must not casually break existing
session continuity.

---

## 4. Run Contract

Every user turn belongs to a run.

A run must have:

- explicit identity,
- explicit state transitions,
- a known owning session,
- a known final outcome.

Allowed run states should at minimum support:

- prepared,
- executing,
- awaiting-approval,
- completed,
- aborted,
- failed.

---

## 5. Checkpoint Contract

Checkpoints are named persisted boundaries created at meaningful runtime steps.

They exist to support:

- explainability,
- debugging,
- partial recovery,
- stable persistence sequencing.

Checkpoint examples:

- post-parse,
- post-context-assembly,
- pre-approval wait,
- post-tool execution,
- post-finalization.

---

## 6. Prompt Assembly Boundary

Prompt assembly starts only after request parsing and bounded route detection
have completed.

Prompt assembly is considered final for a run when:

- all prompt layers are resolved,
- required runtime context is attached,
- the runtime records the effective prompt provenance for the run.

No alternate prompt path may mutate the effective prompt after this boundary
without being modeled as part of the runtime contract.

---

## 7. Tool Invocation Contract

For every tool invocation, the runtime must perform this sequence:

1. validate the requested tool and arguments,
2. evaluate approval requirements,
3. pause for approval if required,
4. execute the tool only when permitted,
5. capture the result and any structured error,
6. feed the result back into runtime execution,
7. record provenance and transcript effects.

Tool execution must not bypass runtime control through participant-local logic.

---

## 8. Approval Contract

Approvals are first-class runtime objects.

An approval object should record at minimum:

- tool or action being approved,
- arguments or summary,
- why approval is required,
- approval outcome,
- actor if known,
- timestamp,
- run/session association.

Denial handling must also be explicit and feed back into runtime behavior.

---

## 9. Trace And Provenance Contract

The runtime must emit structured trace/provenance records for:

- request normalization,
- route detection,
- prompt assembly,
- context loading,
- tool invocation,
- approvals,
- response finalization,
- persistence boundaries.

The trace contract exists to keep the runtime explainable.

---

## 10. Persistence Contract

Persistence must happen at named runtime boundaries, not because UI timing or
participant-local closures happen to align.

At minimum the runtime must define persistence ordering for:

- transcript updates,
- run records,
- checkpoints,
- final outcome state.

---

## 11. Memory Write-Back Contract

Memory writes are allowed only after the runtime reaches an approved boundary.

The contract must prevent:

- premature writes before a run is coherently finalized,
- duplicate writes from repeated partial paths,
- hidden side effects triggered by UI-only state.

---

## 12. Abort, Timeout, And Fallback Contract

The runtime must define:

- how a run is aborted,
- what state is preserved when that happens,
- how timeout is represented,
- what fallback behavior is allowed,
- how incomplete work is surfaced to the user and transcript.

---

## 13. Error Contract

The runtime must distinguish between at least:

- request preparation errors,
- tool validation errors,
- approval-denied outcomes,
- tool execution errors,
- model execution errors,
- persistence errors,
- runtime contract violations.

The handling path for each category must be explicit.

---

## 14. Contract Violations And Debugging

Signs of drift from this contract include:

- side effects depending on UI timing,
- state transitions implicit in local closure state,
- hidden prompt mutations,
- tool execution outside runtime control,
- trace gaps around important execution boundaries.

If a turn cannot be reasoned about from this contract, the runtime is still too
implicit.

---

## 15. Completion Gate

This document is complete only when a turn can be reasoned about entirely from
the runtime contract without needing to inspect legacy participant internals.

This document meets that planning-phase gate.