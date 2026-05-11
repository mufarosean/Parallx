# Books AI Eval System

## Purpose

This evaluation suite is the acceptance harness for Milestone 37's workspace
expert remodel.

It uses the external Books workspace at:

1. `C:/Users/mchit/OneDrive/Documents/Books`

and the real chat model:

1. `gpt-oss:20b`

to measure not only retrieval quality, but whether Parallx behaves like a
trustworthy workspace expert.

## What It Scores

The Books suite evaluates four layers at once:

1. answer correctness
2. source fidelity
3. honesty / hallucination resistance
4. pipeline alignment

Pipeline alignment means the test also inspects Parallx debug state for:

1. route kind
2. retrieval intent
3. coverage mode
4. retrieval attempt state
5. source-hit rate in the pipeline itself

## Why This Exists

Generic RAG smoke tests are not enough for Milestone 37.

The app is being positioned as a trusted expert on workspace contents.
That requires acceptance tests that can catch these failures:

1. wrong file summarized
2. requested files omitted
3. unsupported summaries presented as complete
4. nearby-source contamination
5. retrieval/runtime choosing the wrong execution path

## Benchmark Shape

The current benchmark covers:

1. exact file identification
2. explicit content retrieval from selected PDFs
3. cross-folder duplicate detection
4. exhaustive per-folder summary behavior
5. follow-up continuity
6. honesty when the workspace does not support a claim
7. exact format/file-presence checks

## Running It

Prerequisites:

1. Ollama running locally
2. `gpt-oss:20b` pulled in Ollama
3. built renderer assets

Commands:

```powershell
npm run build:renderer
npm run test:ai-eval:books
```

Optional overrides:

1. `PARALLX_AI_EVAL_WORKSPACE`
2. `PARALLX_AI_EVAL_WORKSPACE_NAME`
3. `PARALLX_TEST_CHAT_MODEL`

## Output

Reports are written to `test-results/` as:

1. JSON report
2. text summary

The report includes:

1. overall score
2. dimension breakdown
3. retrieval baseline
4. autonomy baseline
5. books pipeline baseline
6. rollout-gate blocking reasons

## Milestone 37 Relevance

This suite is the acceptance gate for the redesign principle:

1. if the user asks for coverage, Parallx must execute for coverage

The Activism-folder coverage benchmark is intentionally strict because it is the
same failure class that broke trust in manual testing.