# `tests/autonomy-eval/` — Autonomy Eval Scenarios

Per [Parallx Milestone 60](../../docs/Parallx_Milestone_60.md) §11.2, the autonomy
substrate uses scenario-driven evals (not deterministic asserts) for end-to-end
behavior. Each scenario is a JSON file that captures:

- A `trigger` (heartbeat / cron / subagent / followup / surface) with fixture data.
- `preconditions` (feature flag state, persisted state).
- A `rubric` of weighted dimensions a judge model scores 0..max.
- A `passThreshold` total.

## Current scenarios (Phase γ — T1.A4 / T1.A5 / T1.A6)

| File | Domain | Linked tracker |
|------|--------|----------------|
| `heartbeat-tick.scenario.json` | D2 — proactive check-in | M60 T1.A4 |
| `cron-fire.scenario.json`      | D4 — time-triggered    | M60 T1.A5 |
| `subagent-spawn.scenario.json` | D5 — sub-agent spawn   | M60 T1.A6 |

## Status

> ⚠️ **Runner is not yet implemented.** The JSON schema captured above is the
> contract — the runner harness (`tools/autonomy-eval/`) is M60 **T6** work and
> ships in a later phase. Each scenario carries `_runner_status: "TODO"` until
> then.
>
> Until the runner exists, these JSONs serve as:
> 1. The frozen behavior contract for each domain (so future refactors can be
>    judged against intent, not implementation).
> 2. Hand-runnable QA recipes (each `rubric.dimensions[*].description` is a
>    yes/no QA check a human can execute against a dev build).

When the runner lands, it MUST emit one ndjson line per dimension to the same
sink as `AutonomyEventLog` (`<APP_ROOT>/data/autonomy-events.<date>.ndjson`)
with `kind: "eval-score"` and the dimension id.
