# Interrupted-task reliability

This harness drives the real Electron chat service, OpenClaw runtime, file
tools, permission service, and SQLite persistence in newly generated workspaces.
No existing workspace, app profile, extension installation, or credentials
are copied. It does not invoke the older AI/E2E fixtures, which share app data.

## Run

From the repository root, with the existing dependencies installed:

```powershell
node tests/agent-reliability/prepare.mjs
node --test tests/agent-reliability/isolation.test.mjs
node tests/agent-reliability/run.mjs --scenarios=control,compact,automatic,failure,cancel,restart,crash,denial,instruction,combined --repeats=2
node tests/agent-reliability/run.mjs --live --model=qwen3.8:27b --scenarios=control,compact,automatic,failure,cancel,restart,crash,denial,instruction,combined --repeats=5
node tests/agent-reliability/run.mjs --ui --scenarios=cancel,restart,denial,combined
node tests/agent-reliability/report.mjs
node tests/agent-reliability/audit.mjs --since=2026-09-08T15:22:00.000Z
```

`prepare.mjs` archives tracked source into a separate code directory under
`test-results/agent-reliability/`, overlays the chat repair and its two regression
test files, and typechecks/builds there. The shared checkout's `dist` stays
untouched. `prepared.json` identifies that build; `snapshot.json` records its
revision and overlay. Dependencies are read through a junction to the installed
`node_modules`. No dependencies or models are downloaded.

The live command is opt-in. Select an already-installed tool-capable Ollama
model; the runtime checks its capabilities and records its model info, effective
request options, and usage. Calls are serial. Scripted mode tests runtime
contracts; it is not evidence that a real model can solve the task.

## Isolation and evidence

Each scenario/repetition gets an exclusive directory, an ownership marker,
synthetic CSV inputs, a protected file, and an answer key outside the workspace.
App data, Chromium/session storage, temp files, database, and transcripts stay
under that run. Boot verifies actual runtime paths, not just the saved pointer.
A test-only main-process wrapper rejects wrong workspace/database roots and
out-of-scope filesystem operations before the production handlers execute.
Unrelated shell and integration tools are disabled; external browser/fetch
traffic is blocked. This is a bounded test fixture, not an OS security sandbox.

The launcher uses the existing production `PARALLX_APP_ROOT`,
`PARALLX_USER_DATA`, and `PARALLX_HIDDEN_PROBE` seams. Windows GPU rendering is
disabled in this fixture. The direct launcher follows the repository's hidden
probe pattern and [Playwright's Electron API](https://playwright.dev/docs/api/class-electron);
it does not change production window behavior.

Evidence lives in each run's `evidence/` directory: provider requests, tool
results, observed file effects, SQLite calls, isolation checks, console logs,
output contents, and verdict. The crash scenario kills only its own Electron
process after a real file write and before its IPC reply. The continuation
must reconcile the file already on disk; duplicate output writes fail.

Clean restart waits for actual saved session messages and the latest plan.
Do not replace this with an async `waitForFunction` predicate: the installed
Playwright implementation treats that Promise as truthy. The host polls an
awaited `page.evaluate` result instead.

Runs are retained, including failures. `latest-results.json` is a convenience
view for the most recent invocation; individual `result.json` files are the
durable record. No automatic cleanup touches workspace directories. A failure
is never retried invisibly or treated as a pass because the model said "done".
`report.mjs` retains all attempts, including incomplete runs. Its optional
`--since=<ISO timestamp>` filters the displayed cohort. `audit.mjs` independently
re-scores completed outputs, checks final lifecycle state and tool call/result
pairing, and totals unique provider requests across restarts. It preserves the
original verdicts and writes `audit-results.json`. `--ui` adds screenshots and
submits the cancellation turn through the chat input before clicking Stop.
`--start-repetition=N --repeats=M` resumes the requested seed range in fresh
roots. In combined scenarios, replaying the cancelled wait after restart is
an immediate failed verdict. The original unbounded replay is retained as a
timeout failure; fail-fast detection does not convert it into a success.

The answer-key canaries cover wrong/missing artifacts, duplicate rows, changed
protected inputs, and a bare success claim. Task completion additionally
requires persisted state. Explicit/automatic compaction count only actual
compaction prompts, not unrelated memory summaries.
The report must label its correct total; merely containing that number
somewhere is insufficient. Deliberately wrong totals with incidental correct
numbers are rejected by the canaries.

## Scope

The task builds a small inventory and a verified report. Perturbations cover
compaction, a failed tool result, cancellation, clean and abrupt restart,
permission rejection, and a changed instruction. This establishes evidence
for these local-file scenarios; it does not certify arbitrary shell commands,
external side effects, every model, or unlimited task lengths.

Problem Bank/Worksheets are excluded from implementation and fixtures.
