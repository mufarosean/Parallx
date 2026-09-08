# Interrupted-task reliability results

Date: 2026-09-08. Status: evaluation complete; combined live reliability gate failed.

Two demonstrated compaction defects are repaired in
`src/built-in/chat/data/chatDataService.ts`. All implementation builds and app
runs used newly created code/data/workspace roots under
`test-results/agent-reliability/`. No existing user workspace was opened or
copied. Problem Bank and Worksheets have no changes or evaluation fixtures.

## Repairs and before/after evidence

1. **Compaction bypassed the selected provider.** Summarization read the active
   model ID but sent it directly to Ollama. A registered non-Ollama fixture
   model consequently failed with HTTP 404. Summaries now use
   `LanguageModelsService.sendChatRequest`, preserving the context budget and
   cancellation signal. The regression uses a real provider registry with a
   non-Ollama provider and fails if the raw Ollama path is called.
2. **Compacted histories could not be saved or serialized.** The synthetic
   summary response omitted required `modelId` and `timestamp` fields; a type
   assertion hid the omission. SQLite rejected `chat_messages.model_id`, and
   transcript serialization raised `RangeError: Invalid time value`. The
   response now carries the session model and a valid timestamp. Regressions
   save/reload through actual SQLite constraints and serialize through the
   production transcript service.

Retained before-fix evidence:

- `deterministic-instruction-4FDoIg`: provider-routing failure.
- `deterministic-combined-ngse3P`: SQLite/transcript failures after compaction.
- `live-combined-4YOpho`: the installed Qwen model reproduced the failed
  persistence barrier after compaction, before the metadata repair.

These are targeted reproduced failures, not a statistically sampled baseline.

## Remaining failed gate: cancelled instruction replay

The combined live scenario still fails after the repairs. In
`live-combined-8YFKSy`, the session and revised plan saved successfully and
restored in a new process. The resumed provider request contained the latest
continuation message and the correct pending plan. Qwen nevertheless called
`reliability_checkpoint(kind=wait)` again, reviving the cancelled instruction.
That fixture tool waits for cancellation, so the task hit its 300-second
timeout without producing the pending report. This was not slow inference:
the model had already emitted the repeated tool call.

The next investigation should inspect how cancelled turns are represented in
restored model history, then compare cancellation markers and turn ordering
against the provider trace. The trace establishes replay, but does not by
itself establish whether the correct repair belongs in history assembly,
continuation instructions, or model behavior. No speculative production
change was added for this failure.

The original second attempt (`live-combined-7vYbAo`) was interrupted and is
retained as incomplete. Repetitions 2–5 were restarted from fresh roots with
the same seeds and an immediate failing verdict if the cancelled wait was
replayed. This changes failure detection latency, not the task, model prompt,
or pass criterion. No failed attempt is counted as a pass or hidden.

## Build and regression gates

- TypeScript and production build passed in the isolated code snapshot.
- Full unit suite: **5,966 passed, 16 skipped** across 371 files
  (369 passed, 2 skipped). Log: `test-results/agent-reliability/full-unit.log`.
- Focused persistence, history, transcript, memory and new regressions:
  **57 passed** across six suites.
- Isolation and answer-key canaries: **3 passed**, including a junction escape
  into another synthetic run and misleading report content.
- Final deterministic runtime matrix: **20/20 passed**, two fresh roots for
  each of ten scenarios.
- Additional UI interactions passed for Stop, restored session, permission
  Reject, and combined interruption. Two initial Stop probes failed because
  they bypassed input submission; the corrected probes passed. Screenshots
  are retained, but some hidden-window captures show stale frames, including
  a loading screen after the restored DOM was ready. These are interaction
  checks, not a completed visual rendering review.

## Pinned live evaluation

The existing local Ollama model is `qwen3.8:27b`, Q4_K_M, 27.3B parameters.
Digest: `22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643`.
Effective agent requests use context 16,384, temperature 0, thinking enabled,
and maximum output 4,096 tokens. Compaction requests retain their production
configuration and are captured separately in the traces. No model downloads,
cloud calls, or copied credentials were used. Inference is serial.

Grounding revision: `7384af4fb5dc81bd37e75e9105869db59dd37eb3`.
The evaluated chat source SHA-256 is
`d693b2ed2e9399c362af3a7420c4be2da2640bb897cd2d931bd2a461473801ee`.
Both `code-7384af4f` (live/full suite) and `code-7384af4f-en0ma3`
(documented preparation command/final deterministic matrix) contain that
same repaired source. The latter's `snapshot.json` records its overlay.

The final cohort starts at `2026-09-08T15:22:00.000Z`. Ten live scenarios run
five times each. **45/50 completed runs passed; 5 failed**, plus one interrupted
attempt retained separately. Each scenario checks real files against an independent
answer key, unchanged inputs, one write per output, and saved session/plan.

| Scenario | Live passes | Failures | Median elapsed |
| --- | ---: | ---: | ---: |
| Control | 5 | 0 | 27.9 s |
| Explicit compaction | 5 | 0 | 43.3 s |
| Automatic compaction | 5 | 0 | 67.5 s |
| Transient failure | 5 | 0 | 29.4 s |
| Cancellation | 5 | 0 | 30.2 s |
| Clean restart | 5 | 0 | 28.4 s |
| Crash after file effect | 5 | 0 | 33.4 s |
| Permission denial | 5 | 0 | 47.7 s |
| Changed instruction | 5 | 0 | 50.9 s |
| Combined interruption | 0 | 5 | 54.2 s* |

\*Combined median mixes the original 346.9-second timeout run with four
51.6–60.4-second fail-fast runs. It is not a performance comparison. One
control run overlapped the full unit suite and took 119.2 seconds; inference
contention is another reason not to interpret these timings as benchmarks.

Independent audit: **69/69 completed passing runs passed re-scoring**
(45 live, 20 deterministic matrix, 4 additional UI interactions), with no
orphan tool results, missing final completion, or recorded cleanup errors.
Across the 45 passing live runs, observed provider usage totals 4,855,192
prompt tokens and 165,676 completion tokens, including repeated context and
compaction calls. These are local inference counts, not API charges; they
exclude failed/interrupted runs. The 28 actual compaction requests contain
197,316 input characters and 59,785 summary output characters in aggregate.
That measures summarizer input/output size, not a universal context-saving
percentage or evidence of task correctness.

The complete retained development inventory contains **115 attempts: 95
passed, 18 failed, 2 incomplete**. It includes before-fix reproductions,
harness-development failures, exploratory passes and the final cohorts.
These are not 115 identically configured trials. The final UI cohort includes
four passes and two initial setup failures; neither is hidden in the 20/20
deterministic matrix figure.

## Evidence and interpretation

Run directories retain input/output contents, answer keys, actual IPC file
effects, database calls, provider requests/chunks, tool results, isolation
assertions and console logs. `report.mjs` aggregates every attempt into
`all-results.json`, preserving failures and incomplete attempts. `audit.mjs`
independently re-scores completed artifacts and audits provider tool pairing,
final lifecycle state, token totals and compaction character counts.

Initial development attempts exposed harness issues as well: premature
restart caused by an async wait predicate, a compaction fixture too short to
compact, a missing approval UI, and an unbounded Electron close. Those were
repaired and fresh runs were performed; their artifacts remain. The first UI
Stop probe sent directly through the service, which does not activate the
input widget's streaming button. UI cancellation now submits through the
actual input before clicking Stop. This setup error is distinct from a
production cancellation failure.

This is evidence for a bounded synthetic local-file task on one installed
model. It does not establish reliability for arbitrary shell commands,
external side effects, all providers, or unlimited task lengths. The crash
case reconciles a readable local file; it does not promise exactly-once
execution for arbitrary external operations. Isolation uses relocated roots,
guarded IPC and disabled capabilities; it is not an OS security sandbox.

See [reproduction commands](../../../tests/agent-reliability/README.md).
