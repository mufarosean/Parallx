# Parallx OpenClaw Execution Phase - Context Reporting Slice

**Status date:** 2026-03-24

## Goal

Implement the first missing OpenClaw runtime-owned reporting surface on the live OpenClaw default chat lane so Parallx can expose a user-facing context breakdown instead of only internal debug state.

## Upstream evidence

- `openclaw/openclaw/src/auto-reply/reply/commands-context-report.ts`
  - `/context` supports `list`, `detail`, and `json`
  - the report prefers a stored run-built system prompt report and falls back to an estimate
  - output reports sizes and major contributors instead of dumping the full prompt
- `openclaw/openclaw/src/agents/system-prompt-report.ts`
  - the system prompt report is a structured runtime artifact with system prompt size, project-context size, injected workspace files, skills, and tools
- `openclaw/openclaw/src/auto-reply/reply/commands-system-prompt.ts`
  - report generation is grounded in the same runtime-owned bootstrap, skills, and tool inputs used to build the prompt
- `openclaw/openclaw/docs/concepts/context.md`
  - `/context list` and `/context detail` are explicitly user-facing runtime transparency surfaces

## Local implementation target

1. Add a Parallx runtime report object aligned to the OpenClaw structure.
2. Persist the latest report in the chat runtime debug snapshot so later `/context` calls can prefer run-built data.
3. Add `/context list`, `/context detail`, and `/context json` handling to the live OpenClaw default lane.
4. Build the report from the OpenClaw lane's real bootstrap, skills, and tool prompt inputs.

## Why this slice is first

The current Parallx OpenClaw lane already injects bootstrap files, but the user-facing surface is mostly hidden behind internal debug state. OpenClaw exposes this as a runtime-owned command surface, and that transparency is needed before larger AI-eval parity work because it gives a verifiable contract for what the model actually sees.