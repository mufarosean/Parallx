# tests

- `unit/`: vitest, one file per subject, including the ratchet and
  compliance tests that enforce ARCHITECTURE.md (import direction, file
  size, history in comments, core tool mentions, extension names and
  styles). Baselines sit beside them as `*-baseline.json`.
- `e2e/`: Playwright against the built app.
- `probes/`, `ui-polish/`: scripted drives of the real app (screenshots,
  timings).
- `eval/`, `ai-eval/`, `agent-reliability/`, `autonomy-eval/`: runs with a
  model in the loop.

Run: `npm run typecheck`, `npx vitest run`, `npm run build`.
