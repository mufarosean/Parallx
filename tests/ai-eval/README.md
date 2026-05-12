# AI canvas-interaction eval harness

A Playwright-driven harness that runs real Ollama models against canvas
scenarios and records WHERE THE MODEL GETS CONFUSED — not just whether it
passes. Output is diagnostic: every tool call, every argument, every
thinking-text excerpt, plus a per-dimension rubric so you can read off the
specific failure mode.

## What it does NOT do

- It does not mock Ollama. Every `/api/chat` request goes through to your
  local daemon at `localhost:11434`. The Playwright route is a passthrough
  recorder, not a stub.
- It does not delete the test workspace folder afterwards. Each scenario
  creates its own dated subfolder under
  `D:\Documents\Parallx Workspaces\Testing\` so you can post-mortem the
  resulting canvas state.

## Running

```powershell
# default model (gemma4:26b)
npm run test:ai-eval

# explicit model
$env:PARALLX_AI_EVAL_MODEL='gpt-oss:20b'; npm run test:ai-eval

# one scenario
npx playwright test --config playwright.ai-eval.config.ts tests/ai-eval/scenarios/02-edit-block.spec.ts
```

After multiple runs (or multiple models), build a comparison summary:

```powershell
node tests/ai-eval/aggregate.mjs
# → test-results/ai-eval/SUMMARY.md
```

## Output layout

```
test-results/ai-eval/
  <scenarioId>__<model>__<UTC-ISO>.json   # full transcript + rubric
  <scenarioId>__<model>__<UTC-ISO>.md     # human-readable report
  SUMMARY.md                              # aggregated matrix (after aggregate.mjs)
  playwright-results.json                 # raw playwright run metadata
```

Each scenario `.md` report contains:

- Final rubric score per dimension (with the dimension's reasoning)
- The full tool-call sequence with arguments
- "Confusion notes" — programmatic observations about what the model did
  wrong (e.g. *"Model used list_pages instead of search_workspace"*).
- Per-turn breakdown including the model's `thinking` text when present
- Final canvas state for scenarios that mutate pages

## Adding a scenario

1. Create `tests/ai-eval/scenarios/NN-name.spec.ts`.
2. Use the existing scenarios as a template. Each one:
   - Opens a fresh workspace and seeds a known canvas state.
   - Sets the active model from `AI_MODEL` (env-driven).
   - Sends a single user prompt.
   - Waits for the assistant reply (including any tool-call rounds).
   - Grades a fixed set of rubric dimensions.
   - Calls `writeReport()`.
3. Avoid hard `expect()` failures based on model behavior — score those in
   the rubric. The only hard assertion should be "the assistant said
   *something*" (so we catch infra failures, not model failures).

## Why the workspace folder isn't cleaned

The whole point is to keep the canvas DB and `.parallx` folder around so
you can open Parallx, point it at the failed scenario's workspace, and
*see* what state the agent left things in. Delete manually when you're
done.

## Confusion patterns we already encode

| Pattern | Where it's checked |
|---------|--------------------|
| Uses `list_pages` when `search_workspace` would be better | S3 |
| Edits without first reading (guesses ids) | S2 |
| Falls back to `write_page` instead of `edit_block` | S2 |
| Reads page-by-title when `pageId:"current"` was correct | S1 |
| Multiple redundant calls of the same tool | S1, S2, S3 |
| Answers without any tool call (hallucinates) | S1, S3 |

When you spot a NEW pattern in a model's report, add a programmatic check
for it to that scenario's grading block so future runs surface it
automatically.

## Tuning tip

Iterate on `src/built-in/chat/defaults/TOOLS.md` and the per-tool
`description` fields in `src/built-in/chat/tools/`. A scenario that fails
on "tool.selected = 0/2" is telling you the tool's description doesn't
make its purpose obvious to a fast model. Re-run, see the score move.
This is the loop.
