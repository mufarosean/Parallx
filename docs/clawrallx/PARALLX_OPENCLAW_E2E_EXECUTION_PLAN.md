# Parallx OpenClaw E2E Execution Plan

**Status:** Executed and verified on 2026-03-25  
**Purpose:** Preserve the source-backed execution plan, runner contract, and full AI-eval verification record for the OpenClaw rebuild lane in a durable repo artifact.

---

## 1. Governing Evidence

This execution plan follows upstream OpenClaw runtime evidence already adopted elsewhere in the redesign packet.

- `openclaw/src/agents/workspace.ts`
  - OpenClaw treats one explicit workspace root as the runtime working directory and loads a fixed bootstrap file set from that root.
- `openclaw/docs/concepts/context.md`
  - context is a runtime-owned composition of system prompt, history, injected workspace files, and tool results.
- `openclaw/docs/concepts/system-prompt.md`
  - the system prompt and injected project context are explicit runtime artifacts rather than hidden UI-only state.
- `openclaw/src/agents/system-prompt.ts`
  - the runtime instructs the model to use first-class tools directly when they exist.
- `openclaw/src/agents/pi-tools.before-tool-call.ts`
  - before-tool-call policy and loop control are runtime behavior.
- `openclaw/src/agents/tool-loop-detection.ts`
  - repeated no-progress tool loops are blocked by the runtime rather than left to user guesswork.
- `openclaw/src/agents/tools/session-status-tool.ts`
  - visible status is a first-class runtime surface.

The practical implication for Parallx is straightforward: if the OpenClaw lane is the live default AI surface, then its end-to-end verification must also be runtime-owned and explicit. A stale shell override is not an acceptable source of truth for which corpus a suite is evaluating.

---

## 2. Execution Goal

Reach a repo state where Parallx's OpenClaw-backed chat surfaces are user-testable end to end and the AI evaluation suites can be rerun deterministically from the repository without relying on transient terminal state.

Success conditions for this execution slice:

1. the live OpenClaw chat surfaces remain green on the bundled insurance demo workspace,
2. the stress workspace suite remains green,
3. the Books suite remains green when its local corpus exists,
4. suite workspace selection is deterministic and isolated per run,
5. the resulting evidence is written to durable repo docs.

---

## 3. Plan

### Step 1. Re-ground on the existing OpenClaw rebuild and parity artifacts

Use the existing Milestone 40 packet and tracker to avoid inventing a new target.

Local artifacts used:

- `docs/clawrallx/PARALLX_OPENCLAW_REBUILD_DIRECTIVE.md`
- `docs/clawrallx/PARALLX_CLAW_IMPLEMENTATION_TRACKER.md`
- `docs/clawrallx/PARALLX_RUNTIME_GAP_DIAGNOSIS.md`

### Step 2. Run the core AI suites against the intended bundled insurance workspace

Reason:

- the core `ai-quality`, `memory-layers`, `route-authority`, and `workspace-bootstrap-diagnostic` suites are the main end-to-end acceptance surface for the default OpenClaw lane.
- these suites must not inherit a leftover `PARALLX_AI_EVAL_WORKSPACE` override from a previous stress run.

### Step 3. Run the stress suite against its dedicated stress corpus

Reason:

- the stress workspace is the parity surface for exhaustive coverage, duplicate-file comparison, ambiguous folder phrasing, and file-by-file summary behavior.

### Step 4. Run the Books suite against the Books corpus when available

Reason:

- this verifies the same OpenClaw-backed runtime against a materially different corpus and checks end-to-end generalization.

### Step 5. Treat Exam 7 as an explicit external blocker until the corpus satisfies the benchmark contract

Reason:

- an incomplete benchmark workspace is not an AI runtime failure.
- it must be recorded as an external verification blocker rather than silently omitted.

### Step 6. Harden the suite runner so these bindings are reproducible

Implementation target:

- add a sanitized, Windows-safe AI eval runner that clears or applies workspace overrides per suite instead of trusting ambient shell state.

---

## 4. Local Implementation For This Slice

### 4.1 Runner hardening

Implemented files:

- `scripts/ai-eval-runner.mjs`
  - sanitizes environment variables before spawning child processes,
  - applies per-suite workspace overrides explicitly,
  - clears inherited workspace overrides when a suite must use the bundled demo workspace.
- `scripts/run-books-ai-eval.mjs`
  - now delegates to the shared sanitized runner instead of constructing a raw spawn payload directly.
- `scripts/run-full-ai-eval.mjs`
  - builds the renderer,
  - runs the core demo suites,
  - runs the stress suite with an explicit stress-workspace binding,
  - runs the Books suite when the local Books corpus exists,
  - records Exam 7 as skipped when the configured corpus is absent or missing required benchmark files.
- `scripts/run-exam7-ai-eval.mjs`
  - binds the dedicated Exam 7 suite to the real local corpus path,
  - fails fast with the exact missing benchmark files when the corpus is incomplete.
- `package.json`
  - adds `npm run test:ai-eval:full`.

### 4.2 Why this belongs in the OpenClaw execution plan

This is not a cosmetic scripting change.

OpenClaw's model is explicit runtime ownership of workspace and context boundaries. A verification harness that drifts between corpora because of stale shell state violates that same discipline. The runner hardening makes the end-to-end contract explicit and reproducible.

---

## 5. Executed Verification

Executed on 2026-03-25:

- `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/ai-quality.spec.ts tests/ai-eval/memory-layers.spec.ts tests/ai-eval/route-authority.spec.ts tests/ai-eval/workspace-bootstrap-diagnostic.spec.ts`
  - rerun with inherited workspace overrides cleared.
  - result: `42/42` passed.
  - `tests/ai-eval/ai-quality.spec.ts` = `32/32`, `100.0%` (`Excellent`).
  - `tests/ai-eval/memory-layers.spec.ts` = `7/7`.
  - `tests/ai-eval/route-authority.spec.ts` = `2/2`.
  - `tests/ai-eval/workspace-bootstrap-diagnostic.spec.ts` = `1/1`.

- `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/stress-quality.spec.ts`
  - run with `PARALLX_AI_EVAL_WORKSPACE=tests/ai-eval/stress-workspace` and `PARALLX_AI_EVAL_WORKSPACE_NAME=stress-workspace`.
  - result: `10/10`, `100.0%` (`Excellent`).

- `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/books-quality.spec.ts`
  - run with `PARALLX_AI_EVAL_WORKSPACE=C:\Users\mchit\OneDrive\Documents\Books` and `PARALLX_AI_EVAL_WORKSPACE_NAME=Books`.
  - result: `8/8`, `100.0%` (`Excellent`).

- `npm run test:ai-eval:books`
  - result: passed after the runner hardening.
  - closes the previous Windows launcher failure (`spawn EINVAL`).

- `npm run test:ai-eval:full`
  - result: passed for build + core + stress + Books.
  - `Exam 7` is now wired to `C:\Users\mchit\OneDrive\Documents\Actuarial Science\Exams\Exam 7 - April 2026`.
  - current local status: skipped when that workspace is missing `Exam 7 Reading List.pdf` and `Study Guide - CAS Exam 7 RF.pdf`.

---

## 6. Current Scoreboard

| Suite | Corpus | Result |
|------|--------|--------|
| `ai-quality.spec.ts` | bundled insurance demo workspace | `32/32`, `100.0%` |
| `memory-layers.spec.ts` | bundled insurance demo workspace | `7/7`, `100.0%` |
| `route-authority.spec.ts` | bundled insurance demo workspace | `2/2`, `100.0%` |
| `workspace-bootstrap-diagnostic.spec.ts` | bundled insurance demo workspace | `1/1`, `100.0%` |
| `stress-quality.spec.ts` | `tests/ai-eval/stress-workspace` | `10/10`, `100.0%` |
| `books-quality.spec.ts` | `C:\Users\mchit\OneDrive\Documents\Books` | `8/8`, `100.0%` |
| `exam7-quality.spec.ts` | `C:\Users\mchit\OneDrive\Documents\Actuarial Science\Exams\Exam 7 - April 2026` | external blocker: missing `Exam 7 Reading List.pdf` and `Study Guide - CAS Exam 7 RF.pdf` |

---

## 7. Remaining External Blockers

The only unresolved AI-eval blocker from this execution slice is external:

- `tests/ai-eval/exam7-quality.spec.ts`
  - blocked because the local Exam 7 corpus is missing `Exam 7 Reading List.pdf` and `Study Guide - CAS Exam 7 RF.pdf`.

This is not a live OpenClaw runtime failure. It is an incomplete benchmark workspace.

---

## 8. Completion Note

For the corpora that exist locally, the OpenClaw-backed Parallx chat surfaces are now green end to end and reproducible through a deterministic full-suite runner.