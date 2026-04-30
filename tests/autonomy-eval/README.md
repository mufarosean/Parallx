# `tests/autonomy-eval/` — Autonomy Eval Scenarios

Per [Parallx Milestone 60](../../docs/Parallx_Milestone_60.md) §11.2, the autonomy
substrate uses scenario-driven evals (not deterministic asserts) for end-to-end
behavior. Each scenario is a JSON file that captures:

- A `trigger` (heartbeat / cron / subagent / followup / surface / fixture-driven Gmail).
- `preconditions` (feature flag state, persisted state).
- A rubric — either **inline** (`rubric: { dimensions, passThreshold }`) or
  **sidecar** (`rubric: "<id>.rubric.json"`).
- A `passThreshold` total.

## Layout

| Path                                    | Purpose                                            |
|-----------------------------------------|----------------------------------------------------|
| `*.scenario.json`                       | Scenario definitions.                              |
| `*.rubric.json`                         | (Optional) sidecar rubric referenced by scenario.  |
| `fixtures/*.json`                       | Recorded data injected in offline mode.            |
| `runner/runner.ts`                      | Scenario loader + validator + fixture coherence.   |

The runner is exercised by `tests/unit/autonomyEvalRunner.test.ts` (vitest).

## Scenarios

| File                                       | Domain                       | Linked tracker  | Rubric  |
|--------------------------------------------|------------------------------|-----------------|---------|
| `heartbeat-tick.scenario.json`             | D2 — proactive check-in      | M60 T1.A4       | inline  |
| `cron-fire.scenario.json`                  | D4 — time-triggered          | M60 T1.A5       | inline  |
| `subagent-spawn.scenario.json`             | D5 — sub-agent spawn         | M60 T1.A6       | inline  |
| `canvas-edit-block.scenario.json`          | T3 — block edit              | M60 T3.C2       | inline  |
| `canvas-insert-block-after.scenario.json`  | T3 — block insert            | M60 T3.C3       | inline  |
| `canvas-link-block.scenario.json`          | T3 — block link              | M60 T3.C4       | inline  |
| `canvas-query-by-property.scenario.json`   | T3 — dataview query          | M60 T3.C1       | inline  |
| `canvas-read-block.scenario.json`          | T3 — block read              | M60 T3.C5       | inline  |
| `gmail-inbox-digest.scenario.json`         | T6 — Gmail E2E (cron+digest) | M60 T6.F5       | sidecar |

## Rubric kinds

- **Deterministic** (inline) — domain-specific dimensions a runner can check
  programmatically once each domain has a service-level driver. Used for the
  γ + δ scenarios.
- **LLM-graded** (sidecar `*.rubric.json`) — six dimensions per
  Parallx_Milestone_60.md §9.3: `tool.selection`, `tool.args`,
  `surface.routing`, `report.quality`, `loop.safety`, `trust.surface`. Each
  scored 0/1/2 by the configured chat provider. Pass = ≥10/12 across 5
  consecutive runs (`stability.consecutiveRunsRequired`).

## Mode flag

| Env                       | Behavior                                                                  |
|---------------------------|---------------------------------------------------------------------------|
| `PARALLX_GMAIL_E2E` unset | **Default**. Fixture mode. Runner injects `fixtures/gmail-inbox.json`.    |
| `PARALLX_GMAIL_E2E=0`     | Same as unset.                                                            |
| `PARALLX_GMAIL_E2E=1`     | Live mode. Real Gmail. **CI never sets this.** Requires F2+F3+F4 landed.  |

The runner refuses live mode (`outcome: 'gated'`) until F4 lands so that no
accidental live OAuth flow is driven from a test environment.

## Runner status

> **Phase η F5 — partial.** The runner currently:
>
> - Discovers + parses every scenario.
> - Resolves rubrics (inline or sidecar).
> - Validates Gmail fixture coherence (metadata-only; no body field).
> - Reports `fixture-ok` for the Gmail scenario in offline mode.
> - Reports `gated` for any scenario whose execution requires unlanded F-domains.
> - Does NOT yet drive cron / heartbeat / subagent / canvas scenarios end-to-end.
>   Those need each domain's service graph mounted (deferred until per-domain
>   service-level drivers exist).
> - Does NOT yet LLM-grade rubrics. Hooks ready; grading lands when the
>   runner is upgraded to drive scenarios live.
>
> Until full execution lands, scenario JSONs are:
> 1. The frozen behavior contract (so future refactors are judged against intent).
> 2. Hand-runnable QA recipes (each `description` is a yes/no QA check).

When the runner gains live execution, it MUST emit one ndjson line per
dimension to the same sink as `AutonomyEventLog`
(`<APP_ROOT>/data/autonomy-events.<date>.ndjson`) with `kind: "eval-score"`
and the dimension id.

## Fixture format

`fixtures/gmail-inbox.json`:

```json
{
  "id": "gmail-inbox",
  "tool": "gmail.list_unread",
  "messages": [
    {
      "id": "fix-001",
      "from": "Display Name <addr@host>",
      "subject": "...",
      "snippet": "Short preview from Gmail.",
      "receivedAt": "ISO 8601",
      "labels": ["INBOX", "UNREAD"]
    }
  ]
}
```

Fixture invariant: **no `body` field anywhere**. The MCP server contract is
metadata-only; the runner refuses to load a fixture that contains a body.

## Adding a scenario

1. Create `<id>.scenario.json` with `id`, `trigger`, `preconditions`, optional `expected`.
2. Add a rubric — inline if dimensions are deterministic; sidecar if LLM-graded.
3. (Optional) Drop a fixture under `fixtures/<id>.json` and reference it from
   `trigger.fixturePath`.
4. Re-run `npx vitest run tests/unit/autonomyEvalRunner.test.ts` — discovery
   is automatic.
