# Parallx Claw Decisions Ledger

**Status:** Planning complete  
**Date:** 2026-03-24  
**Purpose:** Record architecture decisions so the redesign does not drift into
chat-history folklore.

---

## 1. Purpose And Usage Rules

This ledger exists because the redesign spans multiple phases and multiple
judgment calls. Significant choices must survive beyond transient conversation
context.

Any architecture change that alters first-cut scope, dependency envelope, or
migration posture must be recorded here before implementation proceeds.

---

## 2. Decision Record Template

Each decision record should contain:

- `ID`
- `Date`
- `Status`
- `Decision`
- `Context`
- `Rationale`
- `Consequences`
- `Affected docs`
- `Implementation impact`

---

## 3. Accepted Decisions

### CLAWRALLX-001

- **Decision:** Migrate through a parallel runtime lane rather than repository
  rollback.
- **Status:** Accepted.
- **Rationale:** Git history cannot be safely rewound without losing unrelated
  repo progress.

### CLAWRALLX-002

- **Decision:** Preserve the Parallx substrate instead of replacing retrieval,
  indexing, vector storage, model transport, and session persistence.
- **Status:** Accepted.
- **Rationale:** These foundations already do the right class of work and are
  not the root redesign targets.

### CLAWRALLX-003

- **Decision:** Use NemoClaw as the primary architectural reference and
  OpenClaw as the secondary reference.
- **Status:** Accepted.
- **Rationale:** NemoClaw contributes stronger runtime-contract discipline;
  OpenClaw contributes useful capability and extensibility patterns.

### CLAWRALLX-004

- **Decision:** Exclude external daemon and sandbox assumptions from the first
  cut.
- **Status:** Accepted.
- **Rationale:** They conflict with the allowed dependency envelope for a
  Parallx-native desktop-first local-first runtime.

### CLAWRALLX-005

- **Decision:** Use file-first prompt and skill contracts.
- **Status:** Accepted.
- **Rationale:** This keeps behavior inspectable and prevents split hidden
  authority paths.

### CLAWRALLX-006

- **Decision:** Require an explicit runtime selector during migration.
- **Status:** Accepted.
- **Rationale:** This makes dual-lane behavior observable, testable, and
  reversible.

---

## 4. Rejected Alternatives

### CLAWRALLX-R001

- **Decision:** Revert to an earlier pre-AI commit.
- **Status:** Rejected.
- **Rationale:** Unsafe to unrelated repo progress and insufficient as an
  architecture strategy.

### CLAWRALLX-R002

- **Decision:** Vendor OpenClaw or NemoClaw wholesale into Parallx.
- **Status:** Rejected.
- **Rationale:** Imports the wrong operational model and too much dependency
  surface.

### CLAWRALLX-R003

- **Decision:** Keep the current orchestration path and perform only local fixes.
- **Status:** Rejected.
- **Rationale:** Conflicts with the redesign goal and would continue the current
  drift pattern.

---

## 5. Open Decisions

These do not block the first-cut planning boundary but should be tracked:

- whether a future personal-skill layer is desirable,
- whether deferred cloud providers should be described in first runtime APIs or
  left entirely for later,
- how far first-cut replay tooling should go beyond checkpoints and trace data.

---

## 6. Superseded Decisions

This section remains empty until implementation introduces a reason to replace a
previous accepted decision.

---

## 7. Completion Gate

This ledger is complete for the planning phase when the major redesign choices,
rejected alternatives, and outstanding open decisions are all recorded in one
durable place.